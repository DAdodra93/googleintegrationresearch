import { createHash } from 'node:crypto';
import type { GbpGateway } from './gateway.js';
import type { GbpDailyMetrics, GbpMediaItem, GbpPost, GbpReview, LocationInfo, PostInput, VerificationOption } from './types.js';

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const STUB_PIN = '123456';

interface StubLocation {
  info: LocationInfo;
  verified: boolean;
  verificationState: 'none' | 'pending' | 'verified';
  pendingVerification: string | null;
  reviews: GbpReview[];
  posts: GbpPost[];
  media: GbpMediaItem[];
}

/**
 * Simulated GBP environment. Each merchant gets one pre-existing verified
 * location (Flow A) on first discovery; Flow B creations start unverified and
 * verify with PIN 123456 (logged), mirroring the real PIN-method lifecycle.
 */
export class StubGbpGateway implements GbpGateway {
  readonly stub = true;
  private byMerchant = new Map<string, Map<string, StubLocation>>();
  private counter = 100;

  private locations(merchantId: string): Map<string, StubLocation> {
    let m = this.byMerchant.get(merchantId);
    if (!m) {
      m = new Map();
      const name = `locations/stub-${++this.counter}`;
      m.set(name, {
        info: {
          name,
          title: 'Existing Demo Business',
          primaryCategory: 'Cafe',
          phone: '+91 98765 43210',
          websiteUri: 'https://example.in',
          description: 'A cosy neighbourhood cafe serving chai and snacks.',
          address: { lines: ['12 MG Road'], locality: 'Bengaluru', administrativeArea: 'KA', postalCode: '560001', regionCode: 'IN' },
          serviceItems: [{ label: 'Masala chai', priceText: '₹30' }],
        },
        verified: true,
        verificationState: 'verified',
        pendingVerification: null,
        reviews: seedReviews(name),
        posts: [],
        media: [],
      });
      this.byMerchant.set(merchantId, m);
    }
    return m;
  }
  private loc(merchantId: string, locationName: string): StubLocation {
    const l = this.locations(merchantId).get(locationName);
    if (!l) throw new Error(`stub: unknown location ${locationName}`);
    return l;
  }

  async listAccounts(merchantId: string) {
    void this.locations(merchantId);
    return [{ name: 'accounts/stub-1', accountName: 'Stub Merchant Account', type: 'PERSONAL' }];
  }
  async listLocations(merchantId: string) {
    return [...this.locations(merchantId).values()].map((l) => ({ name: l.info.name, title: l.info.title, verified: l.verified }));
  }
  async getLocation(merchantId: string, locationName: string) {
    return this.loc(merchantId, locationName).info;
  }
  async updateLocation(merchantId: string, locationName: string, patch: Partial<LocationInfo>, updateMask: string[]) {
    const l = this.loc(merchantId, locationName);
    for (const field of updateMask) {
      if (field in patch) (l.info as any)[field] = (patch as any)[field];
    }
    return l.info;
  }
  async createLocation(merchantId: string, _accountName: string, location: Partial<LocationInfo>) {
    const name = `locations/stub-${++this.counter}`;
    this.locations(merchantId).set(name, {
      info: { name, title: location.title ?? 'New Business', ...location } as LocationInfo,
      verified: false,
      verificationState: 'none',
      pendingVerification: null,
      reviews: [],
      posts: [],
      media: [],
    });
    return { locationName: name };
  }

  async listReviews(merchantId: string, _a: string, locationName: string) {
    return this.loc(merchantId, locationName).reviews;
  }
  async replyToReview(merchantId: string, reviewName: string, comment: string) {
    for (const l of this.locations(merchantId).values()) {
      const r = l.reviews.find((x) => x.reviewName === reviewName);
      if (r) {
        r.reply = { comment, updateTime: new Date().toISOString() };
        return;
      }
    }
    throw new Error(`stub: unknown review ${reviewName}`);
  }

  async listPosts(merchantId: string, _a: string, locationName: string) {
    return this.loc(merchantId, locationName).posts;
  }
  async createPost(merchantId: string, accountName: string, locationName: string, post: PostInput) {
    const l = this.loc(merchantId, locationName);
    const created: GbpPost = {
      name: `${accountName}/${locationName}/localPosts/${l.posts.length + 1}`,
      summary: post.summary,
      topicType: post.topicType,
      ctaType: post.ctaType,
      ctaUrl: post.ctaUrl,
      state: 'LIVE',
      createTime: new Date().toISOString(),
    };
    l.posts.unshift(created);
    return created;
  }

  async listMedia(merchantId: string, _a: string, locationName: string) {
    return this.loc(merchantId, locationName).media;
  }
  async uploadMediaFromUrl(merchantId: string, accountName: string, locationName: string, sourceUrl: string, category: string) {
    const l = this.loc(merchantId, locationName);
    const item: GbpMediaItem = {
      name: `${accountName}/${locationName}/media/${l.media.length + 1}`,
      category,
      sourceUrl,
      googleUrl: sourceUrl,
      createTime: new Date().toISOString(),
    };
    l.media.unshift(item);
    return item;
  }

  async getDailyMetrics(_merchantId: string, locationName: string, days: number): Promise<GbpDailyMetrics[]> {
    const out: GbpDailyMetrics[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = day(Date.now() - i * 86400_000);
      const h = parseInt(createHash('sha1').update(`${locationName}:${date}`).digest('hex').slice(0, 6), 16);
      out.push({
        date,
        impressionsSearch: 40 + (h % 60),
        impressionsMaps: 25 + (h % 40),
        callClicks: h % 4,
        websiteClicks: 1 + (h % 5),
        directionRequests: h % 6,
        conversations: h % 3,
      });
    }
    return out;
  }
  async getKeywordImpressions(_merchantId: string, locationName: string) {
    const base = parseInt(createHash('sha1').update(locationName).digest('hex').slice(0, 4), 16);
    return [
      { keyword: 'cafe near me', impressions: 400 + (base % 200) },
      { keyword: 'chai shop', impressions: 220 + (base % 100) },
      { keyword: 'breakfast bengaluru', impressions: 120 + (base % 80) },
      { keyword: 'best masala chai', impressions: 60 + (base % 50) },
    ];
  }

  async getVerificationState(merchantId: string, locationName: string) {
    const l = this.loc(merchantId, locationName);
    return {
      hasVoiceOfMerchant: l.verificationState === 'verified',
      verify: l.verificationState !== 'verified',
      state: l.verificationState.toUpperCase(),
    };
  }
  async fetchVerificationOptions(_merchantId: string, _locationName: string, _lang: string): Promise<VerificationOption[]> {
    return [
      { method: 'SMS', detail: '+91 •••••• 3210' },
      { method: 'ADDRESS', detail: 'postcard to 12 MG Road (≈14 days)' },
      { method: 'VIDEO', detail: 'video walkthrough via Google UI (not completable by API)' },
    ];
  }
  async startVerification(merchantId: string, locationName: string, input: { method: string }) {
    const l = this.loc(merchantId, locationName);
    if (input.method === 'VIDEO') {
      l.verificationState = 'pending';
      l.pendingVerification = `${locationName}/verifications/video-1`;
      return { verificationName: l.pendingVerification, state: 'PENDING_REVIEW' };
    }
    l.verificationState = 'pending';
    l.pendingVerification = `${locationName}/verifications/pin-1`;
    // Real flow: Google sends the PIN out-of-band. Stub logs it via detail.
    return { verificationName: l.pendingVerification, state: `PENDING (stub PIN: ${STUB_PIN})` };
  }
  async completeVerification(merchantId: string, verificationName: string, pin: string) {
    for (const l of this.locations(merchantId).values()) {
      if (l.pendingVerification === verificationName) {
        if (pin !== STUB_PIN) throw new Error('wrong PIN');
        l.verificationState = 'verified';
        l.verified = true;
        l.pendingVerification = null;
        return { state: 'COMPLETED' };
      }
    }
    throw new Error(`stub: unknown verification ${verificationName}`);
  }
}

function seedReviews(locationName: string): GbpReview[] {
  const mk = (n: number, reviewer: string, stars: number, comment: string, daysAgo: number): GbpReview => ({
    reviewName: `accounts/stub-1/${locationName}/reviews/${n}`,
    reviewer,
    starRating: stars,
    comment,
    createTime: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
    reply: null,
  });
  return [
    mk(1, 'Ananya R', 5, 'Lovely chai and quick service. My go-to place!', 2),
    mk(2, 'Vikram S', 4, 'Good snacks, slightly crowded on weekends.', 6),
    mk(3, 'Priya M', 2, 'Waited 20 minutes for my order. Chai was good but service needs work.', 9),
  ];
}
