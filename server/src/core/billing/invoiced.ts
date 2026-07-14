import type { FundingStatus } from '../store/types.js';
import type { BillingProvider } from './provider.js';

/**
 * FUTURE SEAM — consolidated invoicing / credit line. Requires a Google-granted
 * credit line, monthly-invoicing eligibility, and Basic+ API access; then this
 * becomes BillingSetupService + AccountBudgetProposalService calls.
 * Deliberately not implemented in this build (per Phase 0 decision).
 */
export class InvoicedBillingProvider implements BillingProvider {
  readonly model = 'invoiced' as const;

  private unimplemented(): never {
    throw new Error('InvoicedBillingProvider is a documented future seam — use BILLING_MODEL=interim');
  }
  async ensureAccountFunding(): Promise<FundingStatus> {
    this.unimplemented();
  }
  async getFundingStatus(): Promise<FundingStatus> {
    this.unimplemented();
  }
  async markFunded(): Promise<FundingStatus> {
    this.unimplemented();
  }
}
