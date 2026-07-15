import type {
  GbpDailyMetrics,
  GbpMediaItem,
  GbpPost,
  GbpReview,
  KeywordImpressions,
  LocationInfo,
  PostInput,
  VerificationOption,
} from './types.js';

/**
 * Seam to the GBP API family (5 split v1 APIs + legacy v4 for reviews/posts/
 * media — see docs/PHASE0-RESEARCH.md §1.1). All calls are per-merchant: the
 * gateway resolves the merchant's OAuth token internally.
 *  - StubGbpGateway: simulated profile environment (default until quota lands).
 *  - RealGbpGateway: REST against the six base URLs.
 */
export interface GbpGateway {
  readonly stub: boolean;

  listAccounts(merchantId: string): Promise<Array<{ name: string; accountName: string; type: string }>>;
  listLocations(merchantId: string, accountName: string): Promise<Array<{ name: string; title: string; verified: boolean }>>;
  getLocation(merchantId: string, locationName: string): Promise<LocationInfo>;
  updateLocation(merchantId: string, locationName: string, patch: Partial<LocationInfo>, updateMask: string[]): Promise<LocationInfo>;
  /** Flow B: create an (unverified) location under the merchant's account. */
  createLocation(merchantId: string, accountName: string, location: Partial<LocationInfo>): Promise<{ locationName: string }>;

  listReviews(merchantId: string, accountName: string, locationName: string): Promise<GbpReview[]>;
  replyToReview(merchantId: string, reviewName: string, comment: string): Promise<void>;

  listPosts(merchantId: string, accountName: string, locationName: string): Promise<GbpPost[]>;
  createPost(merchantId: string, accountName: string, locationName: string, post: PostInput): Promise<GbpPost>;

  listMedia(merchantId: string, accountName: string, locationName: string): Promise<GbpMediaItem[]>;
  uploadMediaFromUrl(merchantId: string, accountName: string, locationName: string, sourceUrl: string, category: string): Promise<GbpMediaItem>;

  getDailyMetrics(merchantId: string, locationName: string, days: number): Promise<GbpDailyMetrics[]>;
  getKeywordImpressions(merchantId: string, locationName: string): Promise<KeywordImpressions[]>;

  getVerificationState(merchantId: string, locationName: string): Promise<{ hasVoiceOfMerchant: boolean; verify: boolean; state: string }>;
  fetchVerificationOptions(merchantId: string, locationName: string, languageCode: string): Promise<VerificationOption[]>;
  startVerification(
    merchantId: string,
    locationName: string,
    input: { method: string; languageCode: string; phoneNumber?: string; emailAddress?: string },
  ): Promise<{ verificationName: string; state: string }>;
  completeVerification(merchantId: string, verificationName: string, pin: string): Promise<{ state: string }>;
}
