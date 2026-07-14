import type { FundingStatus, Store } from '../store/types.js';
import type { BillingProvider } from './provider.js';

export class InterimBillingProvider implements BillingProvider {
  readonly model = 'interim' as const;

  constructor(private store: Store) {}

  async ensureAccountFunding({ merchantId, adsCustomerId }: { merchantId: string; adsCustomerId: string }): Promise<FundingStatus> {
    const existing = await this.store.getFunding(merchantId, adsCustomerId);
    if (existing) return existing.status;
    const rec = await this.store.upsertFunding({
      merchantId,
      adsCustomerId,
      model: 'interim',
      status: 'pending_manual_billing_setup',
    });
    await this.store.audit({
      merchantId,
      module: 'ads',
      event: 'billing.manual_setup_required',
      detail: {
        adsCustomerId,
        runbook: 'Ads UI → account → Billing → attach company payments profile (interim model; API cannot do this)',
      },
    });
    return rec.status;
  }

  async getFundingStatus({ merchantId, adsCustomerId }: { merchantId: string; adsCustomerId: string }): Promise<FundingStatus> {
    return (await this.store.getFunding(merchantId, adsCustomerId))?.status ?? 'unfunded';
  }

  async markFunded({ merchantId, adsCustomerId, by }: { merchantId: string; adsCustomerId: string; by: string }): Promise<FundingStatus> {
    const rec = await this.store.upsertFunding({ merchantId, adsCustomerId, model: 'interim', status: 'funded' });
    await this.store.audit({ merchantId, module: 'ads', event: 'billing.marked_funded', detail: { adsCustomerId, by } });
    return rec.status;
  }
}
