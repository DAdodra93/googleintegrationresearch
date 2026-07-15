import type { AppContext } from '../../app.js';
import type { GbpGateway } from './gateway.js';
import type { GbpStore } from './store.js';
import type { GbpProfile, InfoPatch, PostInput, PrefillInput } from './types.js';
import { prefillLocation } from './ai.js';

/**
 * GBP module service. Reads are autonomous; every write to Google
 * (info update, post, media, review reply, location create) is
 * propose-then-approve via the shared approval engine.
 */
export class GbpService {
  constructor(
    private ctx: AppContext,
    private store: GbpStore,
    private gateway: GbpGateway,
  ) {}

  get gatewayIsStub() {
    return this.gateway.stub;
  }

  // ─── Flow A: connect an existing profile ────────────────────────────────

  /** Requires the merchant's gbp OAuth connection (made in the Connections tab). */
  async discover(merchantId: string) {
    const conn = await this.ctx.store.getConnection(merchantId, 'gbp');
    if (!conn || conn.status !== 'active') throw new Error('connect the merchant\'s Google account (GBP module) first');
    const accounts = await this.gateway.listAccounts(merchantId);
    const result = [];
    for (const account of accounts) {
      const locations = await this.gateway.listLocations(merchantId, account.name);
      result.push({ account, locations });
    }
    return result;
  }

  async connectExisting(input: { merchantId: string; accountName: string; locationName: string; title: string }) {
    const profile = await this.store.createProfile({
      merchantId: input.merchantId,
      flow: 'existing',
      accountName: input.accountName,
      locationName: input.locationName,
      title: input.title,
      status: 'connected',
    });
    await this.ctx.store.audit({ merchantId: input.merchantId, module: 'gbp', event: 'gbp.profile_connected', detail: { locationName: input.locationName } });
    return profile;
  }

  async listProfiles(merchantId: string) {
    return this.store.listProfiles(merchantId);
  }
  async getProfile(id: string) {
    const p = await this.store.getProfile(id);
    if (!p) throw Object.assign(new Error('profile not found'), { statusCode: 404 });
    return p;
  }

  // ─── Management surface (Flow A + verified Flow B) ──────────────────────

  private managed(p: GbpProfile): { accountName: string; locationName: string } {
    if (!p.locationName || !p.accountName) throw new Error('profile has no location yet');
    if (!['connected', 'verified'].includes(p.status)) throw new Error(`profile is ${p.status} — not manageable yet`);
    return { accountName: p.accountName, locationName: p.locationName };
  }

  async info(profileId: string) {
    const p = await this.getProfile(profileId);
    return this.gateway.getLocation(p.merchantId, this.managed(p).locationName);
  }

  async proposeInfoUpdate(profileId: string, patch: InfoPatch) {
    const p = await this.getProfile(profileId);
    this.managed(p);
    const fields = Object.keys(patch);
    return this.ctx.approvals.propose({
      merchantId: p.merchantId,
      module: 'gbp',
      actionType: 'gbp.info.update',
      payload: { profileId, patch, updateMask: fields },
      summary: `Update ${p.title}: ${fields.join(', ')}`,
      proposedBy: 'operator',
    });
  }

  /** Executor: gbp.info.update */
  async executeInfoUpdate(payload: { profileId: string; patch: InfoPatch; updateMask: string[] }) {
    const p = await this.getProfile(payload.profileId);
    const { locationName } = this.managed(p);
    await this.gateway.updateLocation(p.merchantId, locationName, payload.patch as any, payload.updateMask);
    if (payload.patch.title) await this.store.updateProfile(p.id, { title: payload.patch.title });
  }

  async reviews(profileId: string) {
    const p = await this.getProfile(profileId);
    const { accountName, locationName } = this.managed(p);
    return this.gateway.listReviews(p.merchantId, accountName, locationName);
  }

  async proposeReviewReply(profileId: string, reviewName: string, reply: string) {
    const p = await this.getProfile(profileId);
    this.managed(p);
    const review = (await this.reviews(profileId)).find((r) => r.reviewName === reviewName);
    if (!review) throw new Error('review not found');
    return this.ctx.approvals.propose({
      merchantId: p.merchantId,
      module: 'gbp',
      actionType: 'gbp.review.reply',
      payload: { profileId, reviewName, reply },
      summary: `Reply to ${review.starRating}★ review by ${review.reviewer}: "${reply.slice(0, 80)}${reply.length > 80 ? '…' : ''}"`,
      proposedBy: 'operator',
    });
  }

  /** Executor: gbp.review.reply */
  async executeReviewReply(payload: { profileId: string; reviewName: string; reply: string }) {
    const p = await this.getProfile(payload.profileId);
    this.managed(p);
    await this.gateway.replyToReview(p.merchantId, payload.reviewName, payload.reply);
  }

  async posts(profileId: string) {
    const p = await this.getProfile(profileId);
    const { accountName, locationName } = this.managed(p);
    return this.gateway.listPosts(p.merchantId, accountName, locationName);
  }

  async proposePost(profileId: string, post: PostInput) {
    const p = await this.getProfile(profileId);
    this.managed(p);
    return this.ctx.approvals.propose({
      merchantId: p.merchantId,
      module: 'gbp',
      actionType: 'gbp.post.publish',
      payload: { profileId, post },
      summary: `Publish ${post.topicType} post on ${p.title}: "${post.summary.slice(0, 80)}${post.summary.length > 80 ? '…' : ''}"`,
      proposedBy: 'operator',
    });
  }

  /** Executor: gbp.post.publish */
  async executePost(payload: { profileId: string; post: PostInput }) {
    const p = await this.getProfile(payload.profileId);
    const { accountName, locationName } = this.managed(p);
    await this.gateway.createPost(p.merchantId, accountName, locationName, payload.post);
  }

  async media(profileId: string) {
    const p = await this.getProfile(profileId);
    const { accountName, locationName } = this.managed(p);
    return this.gateway.listMedia(p.merchantId, accountName, locationName);
  }

  async proposeMedia(profileId: string, sourceUrl: string, category: string) {
    const p = await this.getProfile(profileId);
    this.managed(p);
    return this.ctx.approvals.propose({
      merchantId: p.merchantId,
      module: 'gbp',
      actionType: 'gbp.media.upload',
      payload: { profileId, sourceUrl, category },
      summary: `Upload ${category} photo to ${p.title} (${sourceUrl.slice(0, 60)}…)`,
      proposedBy: 'operator',
    });
  }

  /** Executor: gbp.media.upload */
  async executeMedia(payload: { profileId: string; sourceUrl: string; category: string }) {
    const p = await this.getProfile(payload.profileId);
    const { accountName, locationName } = this.managed(p);
    await this.gateway.uploadMediaFromUrl(p.merchantId, accountName, locationName, payload.sourceUrl, payload.category);
  }

  async performance(profileId: string, days: number) {
    const p = await this.getProfile(profileId);
    const { locationName } = this.managed(p);
    const daily = await this.gateway.getDailyMetrics(p.merchantId, locationName, days);
    const sum = (f: (d: (typeof daily)[number]) => number) => daily.reduce((a, d) => a + f(d), 0);
    const half = Math.floor(daily.length / 2);
    const firstHalf = daily.slice(0, half);
    const secondHalf = daily.slice(half);
    const trend = (f: (d: (typeof daily)[number]) => number) => {
      const a = firstHalf.reduce((x, d) => x + f(d), 0);
      const b = secondHalf.reduce((x, d) => x + f(d), 0);
      return a === 0 ? null : Math.round(((b - a) / a) * 100);
    };
    return {
      days,
      daily,
      totals: {
        impressionsSearch: sum((d) => d.impressionsSearch),
        impressionsMaps: sum((d) => d.impressionsMaps),
        callClicks: sum((d) => d.callClicks),
        websiteClicks: sum((d) => d.websiteClicks),
        directionRequests: sum((d) => d.directionRequests),
        conversations: sum((d) => d.conversations),
      },
      beforeAfterTrendPct: {
        impressions: trend((d) => d.impressionsSearch + d.impressionsMaps),
        calls: trend((d) => d.callClicks),
        websiteClicks: trend((d) => d.websiteClicks),
      },
    };
  }

  async keywords(profileId: string) {
    const p = await this.getProfile(profileId);
    const { locationName } = this.managed(p);
    return this.gateway.getKeywordImpressions(p.merchantId, locationName);
  }

  // ─── Flow B: guided net-new creation + verification ──────────────────────

  async createDraft(merchantId: string, input: PrefillInput) {
    const conn = await this.ctx.store.getConnection(merchantId, 'gbp');
    if (!conn || conn.status !== 'active') throw new Error('connect the merchant\'s Google account (GBP module) first');
    const prefill = await prefillLocation(this.ctx.ai, input);
    return this.store.createProfile({
      merchantId,
      flow: 'created',
      accountName: null,
      locationName: null,
      title: input.businessName,
      status: 'draft',
      prefill,
    });
  }

  async proposeCreate(profileId: string) {
    const p = await this.getProfile(profileId);
    if (p.status !== 'draft' || !p.prefill) throw new Error(`profile is ${p.status}, expected draft`);
    const approval = await this.ctx.approvals.propose({
      merchantId: p.merchantId,
      module: 'gbp',
      actionType: 'gbp.location.create',
      payload: { profileId },
      summary: `Create NEW Google Business Profile "${p.title}" (${(p.prefill as any).address?.locality}) — unverified until Google verification completes`,
      proposedBy: 'operator',
    });
    await this.store.updateProfile(profileId, { status: 'create_proposed' });
    return approval;
  }

  /** Executor: gbp.location.create */
  async executeCreate(payload: { profileId: string }) {
    const p = await this.getProfile(payload.profileId);
    if (!p.prefill) throw new Error('no prefill data');
    const accounts = await this.gateway.listAccounts(p.merchantId);
    const accountName = accounts[0]?.name;
    if (!accountName) throw new Error('merchant has no GBP account');
    const { locationName } = await this.gateway.createLocation(p.merchantId, accountName, p.prefill as any);
    await this.store.updateProfile(p.id, { accountName, locationName, status: 'created' });
  }

  async verificationOptions(profileId: string, languageCode = 'en') {
    const p = await this.getProfile(profileId);
    if (!p.locationName) throw new Error('location not created yet');
    return this.gateway.fetchVerificationOptions(p.merchantId, p.locationName, languageCode);
  }

  /**
   * Initiating verification triggers a Google-side external action (postcard/
   * SMS/call/email) — deliberately NOT approval-gated: the create was
   * approved, and verification only reaches the merchant's own contact data.
   * VIDEO cannot be completed by API → explicit UI handoff state.
   */
  async startVerification(profileId: string, input: { method: string; languageCode?: string; phoneNumber?: string; emailAddress?: string }) {
    const p = await this.getProfile(profileId);
    if (!p.locationName) throw new Error('location not created yet');
    if (!['created', 'verification_pending'].includes(p.status)) throw new Error(`profile is ${p.status}`);
    const result = await this.gateway.startVerification(p.merchantId, p.locationName, { languageCode: 'en', ...input });
    const note =
      input.method === 'VIDEO'
        ? 'Video verification must be completed in the Google Business Profile app/UI — state is polled here.'
        : input.method === 'ADDRESS'
          ? 'Postcard on its way (typically ~14 days). Enter the PIN below when it arrives.'
          : 'PIN sent. Enter it below to complete verification.';
    const updated = await this.store.updateProfile(profileId, {
      status: 'verification_pending',
      verification: { method: input.method, verificationName: result.verificationName, state: result.state, note },
    });
    await this.ctx.store.audit({ merchantId: p.merchantId, module: 'gbp', event: 'gbp.verification_started', detail: { method: input.method } });
    return updated;
  }

  async completeVerification(profileId: string, pin: string) {
    const p = await this.getProfile(profileId);
    if (!p.verification?.verificationName) throw new Error('no pending verification');
    await this.gateway.completeVerification(p.merchantId, p.verification.verificationName, pin);
    const updated = await this.store.updateProfile(profileId, {
      status: 'verified',
      verification: { ...p.verification, state: 'COMPLETED' },
    });
    await this.ctx.store.audit({ merchantId: p.merchantId, module: 'gbp', event: 'gbp.verified', detail: { profileId } });
    return updated;
  }

  /** Poll Google (VoiceOfMerchant) — the path video verifications resolve through. */
  async refreshVerification(profileId: string) {
    const p = await this.getProfile(profileId);
    if (!p.locationName || !['created', 'verification_pending'].includes(p.status)) return p;
    const state = await this.gateway.getVerificationState(p.merchantId, p.locationName);
    if (state.hasVoiceOfMerchant) {
      return this.store.updateProfile(profileId, { status: 'verified', verification: { ...p.verification, state: 'COMPLETED' } });
    }
    return p;
  }
}
