import type { GbpGateway } from './gateway.js';
import type { GbpDailyMetrics, GbpMediaItem, GbpPost, GbpReview, LocationInfo, PostInput, VerificationOption } from './types.js';

/**
 * Real GBP gateway — REST against the split v1 APIs + legacy v4 (reviews,
 * posts, media). STATUS: written to spec, UNTESTED until project quota is
 * granted (0 QPM before approval — every call 429s/403s until then).
 * Per-merchant OAuth token resolved via the injected provider.
 */
const ACCT = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const VERIF = 'https://mybusinessverifications.googleapis.com/v1';
const PERF = 'https://businessprofileperformance.googleapis.com/v1';
const V4 = 'https://mybusiness.googleapis.com/v4';

const READ_MASK =
  'name,title,categories,phoneNumbers,websiteUri,profile,storefrontAddress,regularHours,serviceItems';

const DAILY_METRICS: Array<[string, keyof Omit<GbpDailyMetrics, 'date'>]> = [
  ['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'impressionsSearch'],
  ['BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'impressionsSearch'],
  ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'impressionsMaps'],
  ['BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'impressionsMaps'],
  ['CALL_CLICKS', 'callClicks'],
  ['WEBSITE_CLICKS', 'websiteClicks'],
  ['BUSINESS_DIRECTION_REQUESTS', 'directionRequests'],
  ['BUSINESS_CONVERSATIONS', 'conversations'],
];

export class RealGbpGateway implements GbpGateway {
  readonly stub = false;

  constructor(private getAccessToken: (merchantId: string) => Promise<string>) {}

  private async call<T>(merchantId: string, url: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const token = await this.getAccessToken(merchantId);
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 429) {
      throw new Error('GBP API quota is 0 or exhausted — project not approved yet? (docs/PHASE0-PREREQUISITES.md #6)');
    }
    if (!res.ok) throw new Error(`gbp api ${res.status} on ${url}: ${await res.text()}`);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async listAccounts(merchantId: string) {
    const out = await this.call<{ accounts?: any[] }>(merchantId, `${ACCT}/accounts`);
    return (out.accounts ?? []).map((a) => ({ name: a.name, accountName: a.accountName ?? a.name, type: a.type ?? 'PERSONAL' }));
  }

  async listLocations(merchantId: string, accountName: string) {
    const out = await this.call<{ locations?: any[] }>(
      merchantId,
      `${INFO}/${accountName}/locations?readMask=name,title,metadata&pageSize=100`,
    );
    return (out.locations ?? []).map((l) => ({
      name: l.name,
      title: l.title,
      verified: Boolean(l.metadata?.hasVoiceOfMerchant ?? true),
    }));
  }

  async getLocation(merchantId: string, locationName: string): Promise<LocationInfo> {
    const l = await this.call<any>(merchantId, `${INFO}/${locationName}?readMask=${READ_MASK}`);
    return fromApiLocation(l);
  }

  async updateLocation(merchantId: string, locationName: string, patch: Partial<LocationInfo>, updateMask: string[]) {
    const { body, mask } = toApiLocationPatch(patch, updateMask);
    const l = await this.call<any>(
      merchantId,
      `${INFO}/${locationName}?updateMask=${mask.join(',')}&validateOnly=false`,
      { method: 'PATCH', body },
    );
    return fromApiLocation(l);
  }

  async createLocation(merchantId: string, accountName: string, location: Partial<LocationInfo>) {
    const { body } = toApiLocationPatch(location, Object.keys(location));
    const created = await this.call<any>(
      merchantId,
      `${INFO}/${accountName}/locations?requestId=${crypto.randomUUID()}&validateOnly=false`,
      { method: 'POST', body },
    );
    return { locationName: created.name };
  }

  // ── v4 (reviews / posts / media): paths need accounts/{a}/locations/{l} ──
  private v4Path(accountName: string, locationName: string) {
    return `${accountName}/${locationName}`;
  }

  async listReviews(merchantId: string, accountName: string, locationName: string): Promise<GbpReview[]> {
    const out = await this.call<{ reviews?: any[] }>(merchantId, `${V4}/${this.v4Path(accountName, locationName)}/reviews?pageSize=50`);
    const stars: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    return (out.reviews ?? []).map((r) => ({
      reviewName: r.name,
      reviewer: r.reviewer?.displayName ?? 'anonymous',
      starRating: stars[r.starRating] ?? 0,
      comment: r.comment ?? '',
      createTime: r.createTime,
      reply: r.reviewReply ? { comment: r.reviewReply.comment, updateTime: r.reviewReply.updateTime } : null,
    }));
  }

  async replyToReview(merchantId: string, reviewName: string, comment: string) {
    await this.call(merchantId, `${V4}/${reviewName}/reply`, { method: 'PUT', body: { comment } });
  }

  async listPosts(merchantId: string, accountName: string, locationName: string): Promise<GbpPost[]> {
    const out = await this.call<{ localPosts?: any[] }>(merchantId, `${V4}/${this.v4Path(accountName, locationName)}/localPosts?pageSize=20`);
    return (out.localPosts ?? []).map(fromApiPost);
  }

  async createPost(merchantId: string, accountName: string, locationName: string, post: PostInput): Promise<GbpPost> {
    const body: any = { languageCode: 'en', summary: post.summary, topicType: post.topicType };
    if (post.ctaType) body.callToAction = { actionType: post.ctaType, url: post.ctaUrl };
    const created = await this.call<any>(merchantId, `${V4}/${this.v4Path(accountName, locationName)}/localPosts`, {
      method: 'POST',
      body,
    });
    return fromApiPost(created);
  }

  async listMedia(merchantId: string, accountName: string, locationName: string): Promise<GbpMediaItem[]> {
    const out = await this.call<{ mediaItems?: any[] }>(merchantId, `${V4}/${this.v4Path(accountName, locationName)}/media?pageSize=50`);
    return (out.mediaItems ?? []).map((m) => ({
      name: m.name,
      category: m.locationAssociation?.category ?? 'ADDITIONAL',
      sourceUrl: m.sourceUrl,
      googleUrl: m.googleUrl,
      createTime: m.createTime,
    }));
  }

  async uploadMediaFromUrl(merchantId: string, accountName: string, locationName: string, sourceUrl: string, category: string) {
    const created = await this.call<any>(merchantId, `${V4}/${this.v4Path(accountName, locationName)}/media`, {
      method: 'POST',
      body: { mediaFormat: 'PHOTO', locationAssociation: { category }, sourceUrl },
    });
    return { name: created.name, category, sourceUrl, googleUrl: created.googleUrl, createTime: created.createTime };
  }

  async getDailyMetrics(merchantId: string, locationName: string, days: number): Promise<GbpDailyMetrics[]> {
    const end = new Date();
    const start = new Date(Date.now() - days * 86400_000);
    const params = new URLSearchParams();
    for (const [metric] of DAILY_METRICS) params.append('dailyMetrics', metric);
    params.set('dailyRange.start_date.year', String(start.getUTCFullYear()));
    params.set('dailyRange.start_date.month', String(start.getUTCMonth() + 1));
    params.set('dailyRange.start_date.day', String(start.getUTCDate()));
    params.set('dailyRange.end_date.year', String(end.getUTCFullYear()));
    params.set('dailyRange.end_date.month', String(end.getUTCMonth() + 1));
    params.set('dailyRange.end_date.day', String(end.getUTCDate()));
    const out = await this.call<{ multiDailyMetricTimeSeries?: any[] }>(
      merchantId,
      `${PERF}/${locationName}:fetchMultiDailyMetricsTimeSeries?${params}`,
    );
    const byDate = new Map<string, GbpDailyMetrics>();
    for (const series of out.multiDailyMetricTimeSeries ?? []) {
      for (const m of series.dailyMetricTimeSeries ?? []) {
        const field = DAILY_METRICS.find(([apiName]) => apiName === m.dailyMetric)?.[1];
        if (!field) continue;
        for (const point of m.timeSeries?.datedValues ?? []) {
          const d = point.date;
          const date = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
          const row =
            byDate.get(date) ??
            ({ date, impressionsSearch: 0, impressionsMaps: 0, callClicks: 0, websiteClicks: 0, directionRequests: 0, conversations: 0 } as GbpDailyMetrics);
          row[field] += Number(point.value ?? 0);
          byDate.set(date, row);
        }
      }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async getKeywordImpressions(merchantId: string, locationName: string) {
    const out = await this.call<{ searchKeywordsCounts?: any[] }>(
      merchantId,
      `${PERF}/${locationName}/searchkeywords/impressions/monthly?pageSize=50`,
    );
    return (out.searchKeywordsCounts ?? []).map((k) => ({
      keyword: k.searchKeyword,
      impressions: Number(k.insightsValue?.value ?? k.insightsValue?.threshold ?? 0),
    }));
  }

  async getVerificationState(merchantId: string, locationName: string) {
    const out = await this.call<any>(merchantId, `${VERIF}/${locationName}/VoiceOfMerchantState`);
    return {
      hasVoiceOfMerchant: Boolean(out.hasVoiceOfMerchant),
      verify: Boolean(out.verify),
      state: out.hasVoiceOfMerchant ? 'VERIFIED' : out.verify ? 'NEEDS_VERIFICATION' : 'IN_REVIEW',
    };
  }

  async fetchVerificationOptions(merchantId: string, locationName: string, languageCode: string): Promise<VerificationOption[]> {
    const out = await this.call<{ options?: any[] }>(merchantId, `${VERIF}/${locationName}:fetchVerificationOptions`, {
      method: 'POST',
      body: { languageCode },
    });
    return (out.options ?? []).map((o) => ({
      method: o.verificationMethod,
      detail: o.phoneNumber ?? o.emailData?.emailAddress ?? o.addressData?.address?.addressLines?.join(', '),
    }));
  }

  async startVerification(
    merchantId: string,
    locationName: string,
    input: { method: string; languageCode: string; phoneNumber?: string; emailAddress?: string },
  ) {
    const body: any = { method: input.method, languageCode: input.languageCode };
    if (input.method === 'PHONE_CALL' || input.method === 'SMS') body.phoneNumber = input.phoneNumber;
    if (input.method === 'EMAIL') body.emailAddress = input.emailAddress;
    const out = await this.call<{ verification: { name: string; state: string } }>(
      merchantId,
      `${VERIF}/${locationName}:verify`,
      { method: 'POST', body },
    );
    return { verificationName: out.verification.name, state: out.verification.state };
  }

  async completeVerification(merchantId: string, verificationName: string, pin: string) {
    await this.call(merchantId, `${VERIF}/${verificationName}:complete`, { method: 'POST', body: { pin } });
    return { state: 'COMPLETED' };
  }
}

function fromApiPost(p: any): GbpPost {
  return {
    name: p.name,
    summary: p.summary ?? '',
    topicType: p.topicType ?? 'STANDARD',
    ctaType: p.callToAction?.actionType,
    ctaUrl: p.callToAction?.url,
    state: p.state ?? 'LIVE',
    createTime: p.createTime,
  };
}

function fromApiLocation(l: any): LocationInfo {
  return {
    name: l.name,
    title: l.title,
    primaryCategory: l.categories?.primaryCategory?.displayName,
    phone: l.phoneNumbers?.primaryPhone,
    websiteUri: l.websiteUri,
    description: l.profile?.description,
    address: l.storefrontAddress
      ? {
          lines: l.storefrontAddress.addressLines ?? [],
          locality: l.storefrontAddress.locality,
          administrativeArea: l.storefrontAddress.administrativeArea,
          postalCode: l.storefrontAddress.postalCode,
          regionCode: l.storefrontAddress.regionCode,
        }
      : undefined,
    serviceItems: (l.serviceItems ?? []).map((s: any) => ({
      label: s.structuredServiceItem?.description ?? s.freeFormServiceItem?.label?.displayName ?? 'service',
      description: s.freeFormServiceItem?.label?.description,
      priceText: s.price ? `${s.price.units ?? 0} ${s.price.currencyCode ?? ''}`.trim() : undefined,
    })),
  };
}

/** Map our simplified patch to API field paths + payload. */
function toApiLocationPatch(patch: Partial<LocationInfo>, fields: string[]): { body: any; mask: string[] } {
  const body: any = {};
  const mask: string[] = [];
  for (const f of fields) {
    switch (f) {
      case 'title':
        body.title = patch.title;
        mask.push('title');
        break;
      case 'description':
        body.profile = { description: patch.description };
        mask.push('profile.description');
        break;
      case 'phone':
        body.phoneNumbers = { primaryPhone: patch.phone };
        mask.push('phoneNumbers.primaryPhone');
        break;
      case 'websiteUri':
        body.websiteUri = patch.websiteUri;
        mask.push('websiteUri');
        break;
      case 'primaryCategory':
        body.categories = { primaryCategory: { displayName: patch.primaryCategory } };
        mask.push('categories');
        break;
      case 'address':
        body.storefrontAddress = {
          addressLines: patch.address?.lines,
          locality: patch.address?.locality,
          administrativeArea: patch.address?.administrativeArea,
          postalCode: patch.address?.postalCode,
          regionCode: patch.address?.regionCode,
        };
        mask.push('storefrontAddress');
        break;
      case 'serviceItems':
        body.serviceItems = (patch.serviceItems ?? []).map((s) => ({
          freeFormServiceItem: { label: { displayName: s.label, description: s.description } },
        }));
        mask.push('serviceItems');
        break;
      default:
        break;
    }
  }
  return { body, mask };
}
