import type { AppConfig } from '../config.js';
import type { Store } from '../store/types.js';
import type { BillingProvider } from './provider.js';
import { InterimBillingProvider } from './interim.js';
import { InvoicedBillingProvider } from './invoiced.js';

export type { BillingProvider } from './provider.js';

export function createBillingProvider(config: AppConfig, store: Store): BillingProvider {
  return config.billingModel === 'interim' ? new InterimBillingProvider(store) : new InvoicedBillingProvider();
}
