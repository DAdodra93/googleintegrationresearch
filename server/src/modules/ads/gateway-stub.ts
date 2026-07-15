import { createHash } from 'node:crypto';
import type { AdsGateway, DailyMetric, ExternalCampaignSummary, LaunchResult } from './gateway.js';
import type { Budget, SearchCampaignSpec } from './types.js';

interface StubCampaign {
  resourceName: string;
  budgetResourceName: string;
  name: string;
  status: 'ENABLED' | 'PAUSED';
  dailyAmount: number;
  launchedAt: string; // YYYY-MM-DD
  statusLog: Array<{ date: string; status: 'ENABLED' | 'PAUSED' }>;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Deterministic simulated Ads environment: campaigns "serve" from launch day,
 * producing plausible daily metrics derived from a hash of (campaign, date)
 * scaled by the daily budget — so insights, spend caps, and the TCPL loop are
 * all exercisable before real API access exists.
 */
export class StubAdsGateway implements AdsGateway {
  readonly stub = true;
  private nextCustomer = 1111111111;
  private customers = new Map<string, { linkState: 'pending' | 'active' | 'none'; campaigns: Map<string, StubCampaign> }>();

  private customer(id: string) {
    let c = this.customers.get(id);
    if (!c) {
      c = { linkState: 'none', campaigns: new Map() };
      this.customers.set(id, c);
    }
    return c;
  }

  async createCustomerClient(input: { name: string }): Promise<{ customerId: string }> {
    const customerId = String(this.nextCustomer++);
    this.customer(customerId).linkState = 'active';
    // Pre-seed nothing: a freshly provisioned account is empty.
    void input;
    return { customerId };
  }

  async inviteLink(customerId: string): Promise<{ invitationSent: boolean }> {
    const c = this.customer(customerId);
    c.linkState = 'pending';
    // Simulated merchant accepts on next poll — lets the console show the full
    // invited → active transition without a real counterparty.
    setTimeout(() => {
      c.linkState = 'active';
    }, 0);
    if (c.campaigns.size === 0) {
      // Existing accounts arrive with history — seed a legacy campaign for Flow A context reads.
      const res = `customers/${customerId}/campaigns/legacy-1`;
      c.campaigns.set(res, {
        resourceName: res,
        budgetResourceName: `customers/${customerId}/campaignBudgets/legacy-1`,
        name: 'Legacy brand campaign (pre-existing)',
        status: 'PAUSED',
        dailyAmount: 200,
        launchedAt: day(new Date(Date.now() - 90 * 86400_000)),
        statusLog: [],
      });
    }
    return { invitationSent: true };
  }

  async getLinkStatus(customerId: string) {
    return this.customer(customerId).linkState;
  }

  async listCampaigns(customerId: string): Promise<ExternalCampaignSummary[]> {
    return [...this.customer(customerId).campaigns.values()].map((c) => ({
      resourceName: c.resourceName,
      name: c.name,
      status: c.status,
      channelType: 'SEARCH',
    }));
  }

  async launchSearchCampaign(input: {
    customerId: string;
    name: string;
    spec: SearchCampaignSpec;
    budget: Budget;
    finalUrl: string;
  }): Promise<LaunchResult> {
    const c = this.customer(input.customerId);
    const n = c.campaigns.size + 1;
    const refs = {
      campaignBudget: `customers/${input.customerId}/campaignBudgets/${n}`,
      campaign: `customers/${input.customerId}/campaigns/${n}`,
      adGroup: `customers/${input.customerId}/adGroups/${n}`,
      ad: `customers/${input.customerId}/adGroupAds/${n}~1`,
    };
    const today = day(new Date());
    c.campaigns.set(refs.campaign, {
      resourceName: refs.campaign,
      budgetResourceName: refs.campaignBudget,
      name: input.name,
      status: 'ENABLED',
      dailyAmount: input.budget.dailyAmount,
      launchedAt: today,
      statusLog: [{ date: today, status: 'ENABLED' }],
    });
    return { refs };
  }

  async setCampaignStatus(customerId: string, campaignResourceName: string, status: 'ENABLED' | 'PAUSED') {
    const camp = this.customer(customerId).campaigns.get(campaignResourceName);
    if (!camp) throw new Error(`stub: unknown campaign ${campaignResourceName}`);
    camp.status = status;
    camp.statusLog.push({ date: day(new Date()), status });
  }

  async updateCampaignDailyBudget(customerId: string, budgetResourceName: string, dailyAmount: number) {
    const camp = [...this.customer(customerId).campaigns.values()].find((x) => x.budgetResourceName === budgetResourceName);
    if (!camp) throw new Error(`stub: unknown budget ${budgetResourceName}`);
    camp.dailyAmount = dailyAmount;
  }

  async getDailyMetrics(customerId: string, campaignResourceName: string, sinceDate: string): Promise<DailyMetric[]> {
    const camp = this.customer(customerId).campaigns.get(campaignResourceName);
    if (!camp) return [];
    const out: DailyMetric[] = [];
    const start = new Date(Math.max(new Date(sinceDate).getTime(), new Date(camp.launchedAt).getTime()));
    for (let t = start.getTime(); t <= Date.now(); t += 86400_000) {
      const date = day(new Date(t));
      if (this.pausedOn(camp, date)) continue;
      const h = parseInt(createHash('sha1').update(`${campaignResourceName}:${date}`).digest('hex').slice(0, 6), 16);
      const clicks = 4 + (h % 9); // 4–12 clicks/day
      const impressions = clicks * (18 + (h % 10));
      const avgCpc = camp.dailyAmount / (10 + (h % 5)); // spends 60–120% of budget
      const cost = Math.min(Math.round(clicks * avgCpc * 100) / 100, camp.dailyAmount * 2); // Google's 2× daily overdelivery bound
      out.push({ date, impressions, clicks, cost, conversions: Math.floor(clicks / 4) });
    }
    return out;
  }

  /** A campaign yields no metrics on days it was paused (approximation: last status change wins per day). */
  private pausedOn(camp: StubCampaign, date: string): boolean {
    let status: 'ENABLED' | 'PAUSED' = 'ENABLED';
    for (const entry of camp.statusLog) {
      if (entry.date <= date) status = entry.status;
    }
    return status === 'PAUSED';
  }
}
