import type { FundingStatus } from '../store/types.js';

/**
 * Billing seam. Two implementations:
 *  - InterimBillingProvider (NOW): we fund spend via our payments profile on
 *    each MCC-managed account. Card billing cannot be configured via the Ads
 *    API, so activation requires a one-time manual step in the Ads UI — this
 *    provider tracks that step as an explicit pending state.
 *  - InvoicedBillingProvider (FUTURE SEAM, stub): consolidated invoicing /
 *    credit line via BillingSetupService + AccountBudgetProposalService.
 *    Deliberately unimplemented in this build.
 */
export interface BillingProvider {
  readonly model: 'interim' | 'invoiced';
  /** Idempotently ensure a funding record exists for an ads account; returns current status. */
  ensureAccountFunding(input: { merchantId: string; adsCustomerId: string }): Promise<FundingStatus>;
  getFundingStatus(input: { merchantId: string; adsCustomerId: string }): Promise<FundingStatus>;
  /** Operator confirms the manual Ads-UI billing step is done (interim model only). */
  markFunded(input: { merchantId: string; adsCustomerId: string; by: string }): Promise<FundingStatus>;
}
