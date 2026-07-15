import type { Approval } from './api';

export interface AdsAccount {
  id: string;
  merchantId: string;
  flow: 'existing_linked' | 'provisioned';
  billingMode: string;
  customerId: string | null;
  linkStatus: string;
  funding: string | null;
}
export interface Budget {
  currency: string;
  dailyAmount: number;
  hardDailyCeiling: number;
  monthlyCap: number;
  targetCostPerLead: number;
  proposedBy?: string;
  rationale?: string;
}
export interface AdsCampaign {
  id: string;
  name: string;
  adType: string;
  status: string;
  budget: Budget;
  leadSlug: string | null;
  spec: any;
  finalUrl?: string;
  googleRefs: Record<string, string> | null;
}
export interface Insights {
  impressions: number;
  clicks: number;
  spend: number;
  currency: string;
  leads: number;
  costPerLead: number | null;
  clickThroughRate: number;
  monthToDateSpend: number;
  windowDays: number;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? res.statusText);
  return body as T;
}

export const adsApi = {
  meta: () => req<{ gatewayStub: boolean; adTypes: Array<{ key: string; implemented: boolean }> }>('/api/ads/meta'),
  accounts: (merchantId: string) => req<AdsAccount[]>(`/api/ads/accounts?merchantId=${merchantId}`),
  setupAccount: (body: object) => req<{ account: AdsAccount; approval: Approval }>('/api/ads/accounts', { method: 'POST', body: JSON.stringify(body) }),
  markFunded: (accountId: string) => req<{ status: string }>(`/api/ads/accounts/${accountId}/billing/mark-funded`, { method: 'POST', body: '{}' }),
  structure: (accountId: string) => req<Array<{ name: string; status: string; channelType: string }>>(`/api/ads/accounts/${accountId}/structure`),
  campaigns: (merchantId: string) => req<AdsCampaign[]>(`/api/ads/campaigns?merchantId=${merchantId}`),
  campaign: (id: string) => req<AdsCampaign>(`/api/ads/campaigns/${id}`),
  createCampaign: (body: object) => req<AdsCampaign>('/api/ads/campaigns', { method: 'POST', body: JSON.stringify(body) }),
  proposeLaunch: (id: string) => req<Approval>(`/api/ads/campaigns/${id}/propose-launch`, { method: 'POST', body: '{}' }),
  proposeEdit: (id: string, body: object) => req<Approval>(`/api/ads/campaigns/${id}/propose-edit`, { method: 'POST', body: JSON.stringify(body) }),
  insights: (id: string) => req<Insights>(`/api/ads/campaigns/${id}/insights`),
  tcplEvaluate: (id: string) => req<{ evaluation: { decision: string; detail: any }; insights: Insights; proposalId: string | null }>(`/api/ads/campaigns/${id}/tcpl/evaluate`, { method: 'POST', body: '{}' }),
  aiBudget: (body: object) => req<Budget>('/api/ads/ai/budget', { method: 'POST', body: JSON.stringify(body) }),
  aiAdCopy: (body: object) => req<{ headlines: string[]; descriptions: string[] }>('/api/ads/ai/ad-copy', { method: 'POST', body: JSON.stringify(body) }),
};
