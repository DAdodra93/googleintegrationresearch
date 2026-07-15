import type { Budget, SearchCampaignSpec } from './types.js';

/**
 * Seam to the Google Ads API. Everything the module does against Google goes
 * through this interface:
 *  - StubAdsGateway: in-memory simulated Ads environment (default until real
 *    access lands) with deterministic metrics.
 *  - RealAdsGateway: Opteo google-ads-api client under our MCC credentials.
 *
 * Access-level notes baked into the design (Phase 0 §2.2): under Explorer,
 * createCustomerClient and billing services are blocked — the real gateway
 * surfaces that as a typed AdsAccessError so flows degrade with a clear
 * message instead of a mystery failure.
 */

export interface DailyMetric {
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  /** Spend in currency units (not micros). */
  cost: number;
  conversions: number;
}

export interface ExternalCampaignSummary {
  resourceName: string;
  name: string;
  status: string;
  channelType: string;
}

export interface LaunchResult {
  /** Google resource names keyed by entity (campaignBudget, campaign, adGroup, ad, ...). */
  refs: Record<string, string>;
}

export class AdsAccessError extends Error {
  constructor(operation: string, requiredLevel: string) {
    super(`Google Ads API access level too low for ${operation} (requires ${requiredLevel}). Apply per docs/PHASE0-PREREQUISITES.md.`);
    this.name = 'AdsAccessError';
  }
}

export interface AdsGateway {
  readonly stub: boolean;

  /** Flow B: provision a new client account under our MCC (Basic access required). */
  createCustomerClient(input: { name: string; currencyCode: string; countryCode: string; timeZone?: string }): Promise<{ customerId: string }>;

  /** Flow A: send a manager-link invitation to an existing account (merchant accepts in their UI). */
  inviteLink(customerId: string): Promise<{ invitationSent: boolean }>;

  /** Flow A: poll whether the merchant accepted the link. */
  getLinkStatus(customerId: string): Promise<'pending' | 'active' | 'none'>;

  /** Flow A context read: existing campaign structure of a linked account. */
  listCampaigns(customerId: string): Promise<ExternalCampaignSummary[]>;

  launchSearchCampaign(input: {
    customerId: string;
    name: string;
    spec: SearchCampaignSpec;
    budget: Budget;
    finalUrl: string;
  }): Promise<LaunchResult>;

  setCampaignStatus(customerId: string, campaignResourceName: string, status: 'ENABLED' | 'PAUSED'): Promise<void>;

  updateCampaignDailyBudget(customerId: string, budgetResourceName: string, dailyAmount: number): Promise<void>;

  getDailyMetrics(customerId: string, campaignResourceName: string, sinceDate: string): Promise<DailyMetric[]>;
}
