import { AdsAccessError, type AdsGateway, type DailyMetric, type ExternalCampaignSummary, type LaunchResult } from './gateway.js';
import type { Budget, SearchCampaignSpec } from './types.js';

/**
 * Real Google Ads gateway — REST interface of the Google Ads API, authorized
 * as our MCC (login-customer-id) with the developer token.
 *
 * STATUS: written to spec, UNTESTED until the developer token + MCC OAuth
 * exist (flagged in docs/PHASE3-ADS.md). The seam is the AdsGateway
 * interface; if we later prefer the Opteo google-ads-api client, only this
 * file's internals change.
 *
 * Auth model: manager-authorized operations need an OAuth token for a user on
 * OUR MCC — supplied by `getAccessToken` (operator credential), NOT merchant
 * tokens. Merchant OAuth is only used in GBP-style per-merchant reads or a
 * future merchant-side link acceptance; all Phase 3 operations run as the MCC.
 */
const API_VERSION = 'v23'; // pinned; bump deliberately (monthly release cadence since 2026)
const BASE = `https://googleads.googleapis.com/${API_VERSION}`;

// Google Ads geo target constant IDs for countries we launch in first.
// Free-text locations resolve via geoTargetConstants:suggest at launch time.
const COUNTRY_GEO_IDS: Record<string, number> = { IN: 2356, US: 2840, GB: 2826, AE: 2784, SG: 2702, AU: 2036 };
const LANGUAGE_IDS: Record<string, number> = { en: 1000, hi: 1023 };

const DAY_ENUM: Record<string, string> = {
  MON: 'MONDAY', TUE: 'TUESDAY', WED: 'WEDNESDAY', THU: 'THURSDAY', FRI: 'FRIDAY', SAT: 'SATURDAY', SUN: 'SUNDAY',
};

export class RealAdsGateway implements AdsGateway {
  readonly stub = false;

  constructor(
    private cfg: {
      developerToken: string;
      mccCustomerId: string;
      /** Bearer token for the MCC operator Google account (adwords scope). */
      getAccessToken: () => Promise<string>;
    },
  ) {}

  private async call<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
    const token = await this.cfg.getAccessToken();
    const res = await fetch(`${BASE}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'developer-token': this.cfg.developerToken,
        'login-customer-id': this.cfg.mccCustomerId,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 403) {
      const text = await res.text();
      if (/ACCESS_LEVEL|DEVELOPER_TOKEN/i.test(text)) throw new AdsAccessError(path, 'Basic or Standard');
      throw new Error(`ads api 403 on ${path}: ${text}`);
    }
    if (!res.ok) throw new Error(`ads api ${res.status} on ${path}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  private async gaql(customerId: string, query: string): Promise<any[]> {
    const out = await this.call<{ results?: any[] }>(`customers/${customerId}/googleAds:search`, { query });
    return out.results ?? [];
  }

  async createCustomerClient(input: { name: string; currencyCode: string; countryCode: string; timeZone?: string }) {
    const res = await this.call<{ resourceName: string }>(`customers/${this.cfg.mccCustomerId}:createCustomerClient`, {
      customerClient: {
        descriptiveName: input.name,
        currencyCode: input.currencyCode,
        timeZone: input.timeZone ?? (input.countryCode === 'IN' ? 'Asia/Kolkata' : 'UTC'),
      },
    });
    const customerId = res.resourceName.split('/')[1];
    return { customerId };
  }

  async inviteLink(customerId: string) {
    await this.call(`customers/${this.cfg.mccCustomerId}/customerClientLinks:mutate`, {
      operation: {
        create: { clientCustomer: `customers/${customerId}`, status: 'PENDING' },
      },
    });
    return { invitationSent: true };
  }

  async getLinkStatus(customerId: string): Promise<'pending' | 'active' | 'none'> {
    const rows = await this.gaql(
      this.cfg.mccCustomerId,
      `SELECT customer_client_link.status FROM customer_client_link WHERE customer_client_link.client_customer = 'customers/${customerId}'`,
    );
    const status = rows[0]?.customerClientLink?.status;
    if (status === 'ACTIVE') return 'active';
    if (status === 'PENDING') return 'pending';
    return 'none';
  }

  async listCampaigns(customerId: string): Promise<ExternalCampaignSummary[]> {
    const rows = await this.gaql(
      customerId,
      `SELECT campaign.resource_name, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign ORDER BY campaign.id`,
    );
    return rows.map((r) => ({
      resourceName: r.campaign.resourceName,
      name: r.campaign.name,
      status: r.campaign.status,
      channelType: r.campaign.advertisingChannelType,
    }));
  }

  async launchSearchCampaign(input: {
    customerId: string;
    name: string;
    spec: SearchCampaignSpec;
    budget: Budget;
    finalUrl: string;
  }): Promise<LaunchResult> {
    const { customerId, name, spec, budget, finalUrl } = input;
    const cid = customerId;
    const tmp = (n: number, kind: string) => `customers/${cid}/${kind}/-${n}`;
    const micros = (amount: number) => Math.round(amount * 1_000_000);

    const bidding =
      spec.bidding.strategy === 'MAXIMIZE_CONVERSIONS'
        ? { maximizeConversions: spec.bidding.targetCpa ? { targetCpaMicros: String(micros(spec.bidding.targetCpa)) } : {} }
        : spec.bidding.strategy === 'MANUAL_CPC'
          ? { manualCpc: { enhancedCpcEnabled: false } }
          : { targetSpend: {} }; // MAXIMIZE_CLICKS

    const ops: any[] = [
      {
        campaignBudgetOperation: {
          create: {
            resourceName: tmp(1, 'campaignBudgets'),
            name: `${name} budget`,
            amountMicros: String(micros(budget.dailyAmount)),
            deliveryMethod: 'STANDARD',
            explicitlyShared: false,
          },
        },
      },
      {
        campaignOperation: {
          create: {
            resourceName: tmp(2, 'campaigns'),
            name,
            advertisingChannelType: 'SEARCH',
            status: 'ENABLED',
            campaignBudget: tmp(1, 'campaignBudgets'),
            networkSettings: {
              targetGoogleSearch: true,
              targetSearchNetwork: spec.networks.searchPartners,
              targetContentNetwork: false,
              targetPartnerSearchNetwork: false,
            },
            containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
            ...bidding,
          },
        },
      },
    ];

    for (const cc of spec.geo.countryCodes) {
      const geoId = COUNTRY_GEO_IDS[cc.toUpperCase()];
      if (!geoId) throw new Error(`no geo constant mapped for country ${cc} — extend COUNTRY_GEO_IDS or use locations suggest`);
      ops.push({
        campaignCriterionOperation: {
          create: { campaign: tmp(2, 'campaigns'), location: { geoTargetConstant: `geoTargetConstants/${geoId}` } },
        },
      });
    }
    for (const loc of spec.geo.locations) {
      const suggestions = await this.call<{ geoTargetConstantSuggestions?: any[] }>('geoTargetConstants:suggest', {
        locationNames: { names: [loc] },
        countryCode: spec.geo.countryCodes[0],
        locale: 'en',
      });
      const constant = suggestions.geoTargetConstantSuggestions?.[0]?.geoTargetConstant?.resourceName;
      if (constant) {
        ops.push({ campaignCriterionOperation: { create: { campaign: tmp(2, 'campaigns'), location: { geoTargetConstant: constant } } } });
      }
    }
    for (const lang of spec.languageCodes) {
      const id = LANGUAGE_IDS[lang] ?? LANGUAGE_IDS.en;
      ops.push({ campaignCriterionOperation: { create: { campaign: tmp(2, 'campaigns'), language: { languageConstant: `languageConstants/${id}` } } } });
    }
    if (spec.schedule) {
      for (const d of spec.schedule.days) {
        ops.push({
          campaignCriterionOperation: {
            create: {
              campaign: tmp(2, 'campaigns'),
              adSchedule: {
                dayOfWeek: DAY_ENUM[d],
                startHour: spec.schedule.startHour,
                startMinute: 'ZERO',
                endHour: spec.schedule.endHour,
                endMinute: 'ZERO',
              },
            },
          },
        });
      }
    }

    ops.push({
      adGroupOperation: {
        create: { resourceName: tmp(3, 'adGroups'), name: `${name} — ad group 1`, campaign: tmp(2, 'campaigns'), type: 'SEARCH_STANDARD', status: 'ENABLED' },
      },
    });
    for (const kw of spec.keywords) {
      ops.push({
        adGroupCriterionOperation: {
          create: { adGroup: tmp(3, 'adGroups'), status: 'ENABLED', keyword: { text: kw.text, matchType: kw.matchType } },
        },
      });
    }
    for (const neg of spec.negativeKeywords) {
      ops.push({
        campaignCriterionOperation: {
          create: { campaign: tmp(2, 'campaigns'), negative: true, keyword: { text: neg, matchType: 'BROAD' } },
        },
      });
    }
    ops.push({
      adGroupAdOperation: {
        create: {
          adGroup: tmp(3, 'adGroups'),
          status: 'ENABLED',
          ad: {
            finalUrls: [finalUrl],
            responsiveSearchAd: {
              headlines: spec.adCopy.headlines.map((text) => ({ text })),
              descriptions: spec.adCopy.descriptions.map((text) => ({ text })),
              path1: spec.adCopy.path1,
              path2: spec.adCopy.path2,
            },
          },
        },
      },
    });

    const res = await this.call<{ mutateOperationResponses: any[] }>(`customers/${cid}/googleAds:mutate`, {
      mutateOperations: ops,
      partialFailure: false,
    });
    const refs: Record<string, string> = {};
    for (const r of res.mutateOperationResponses) {
      if (r.campaignBudgetResult) refs.campaignBudget = r.campaignBudgetResult.resourceName;
      if (r.campaignResult) refs.campaign = r.campaignResult.resourceName;
      if (r.adGroupResult) refs.adGroup = r.adGroupResult.resourceName;
      if (r.adGroupAdResult) refs.ad = r.adGroupAdResult.resourceName;
    }
    return { refs };
  }

  async setCampaignStatus(customerId: string, campaignResourceName: string, status: 'ENABLED' | 'PAUSED') {
    await this.call(`customers/${customerId}/campaigns:mutate`, {
      operations: [{ update: { resourceName: campaignResourceName, status }, updateMask: 'status' }],
    });
  }

  async updateCampaignDailyBudget(customerId: string, budgetResourceName: string, dailyAmount: number) {
    await this.call(`customers/${customerId}/campaignBudgets:mutate`, {
      operations: [
        { update: { resourceName: budgetResourceName, amountMicros: String(Math.round(dailyAmount * 1_000_000)) }, updateMask: 'amount_micros' },
      ],
    });
  }

  async getDailyMetrics(customerId: string, campaignResourceName: string, sinceDate: string): Promise<DailyMetric[]> {
    const rows = await this.gaql(
      customerId,
      `SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
       FROM campaign
       WHERE campaign.resource_name = '${campaignResourceName}' AND segments.date >= '${sinceDate}'
       ORDER BY segments.date`,
    );
    return rows.map((r) => ({
      date: r.segments.date,
      impressions: Number(r.metrics.impressions ?? 0),
      clicks: Number(r.metrics.clicks ?? 0),
      cost: Number(r.metrics.costMicros ?? 0) / 1_000_000,
      conversions: Number(r.metrics.conversions ?? 0),
    }));
  }
}
