export interface Merchant {
  id: string;
  name: string;
  countryCode: string;
  currencyCode: string;
}
export interface Connection {
  id: string;
  module: 'gbp' | 'ads';
  googleEmail: string | null;
  status: string;
  connectedAt: string;
  scopes: string[];
}
export interface Approval {
  id: string;
  merchantId: string;
  module: 'gbp' | 'ads';
  actionType: string;
  summary: string;
  payload: unknown;
  status: string;
  proposedBy: string;
  createdAt: string;
  error: string | null;
}
export interface SystemStatus {
  store: string;
  google: { stub: boolean; clientConfigured: boolean };
  ads: { mccConfigured: boolean; mccCustomerId: string | null };
  ai: { provider: string; stub: boolean };
  billing: { model: string };
  defaults: { country: string; currency: string };
  encKeyEphemeral: boolean;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  return res.status === 204 ? (undefined as T) : res.json();
}

export interface SessionUser {
  id: string;
  email: string;
  role: 'operator' | 'merchant';
}

export const api = {
  me: () => req<{ user: SessionUser }>('/api/auth/me'),
  signup: (email: string, password: string, businessName?: string) =>
    req<{ user: SessionUser }>('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, businessName }) }),
  login: (email: string, password: string) =>
    req<{ user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' }),
  status: () => req<SystemStatus>('/api/system/status'),
  merchants: () => req<Merchant[]>('/api/merchants'),
  createMerchant: (name: string) => req<Merchant>('/api/merchants', { method: 'POST', body: JSON.stringify({ name }) }),
  connections: (merchantId: string) => req<Connection[]>(`/api/merchants/${merchantId}/connections`),
  disconnect: (connectionId: string) => req<void>(`/api/connections/${connectionId}`, { method: 'DELETE' }),
  approvals: (status?: string) => req<Approval[]>(`/api/approvals${status ? `?status=${status}` : ''}`),
  approve: (id: string) => req<Approval>(`/api/approvals/${id}/approve`, { method: 'POST', body: '{}' }),
  reject: (id: string) => req<Approval>(`/api/approvals/${id}/reject`, { method: 'POST', body: '{}' }),
  demoApproval: (merchantId: string) =>
    req<Approval>('/api/dev/approvals/demo', { method: 'POST', body: JSON.stringify({ merchantId, summary: 'Demo action: prove the approve→execute pipeline' }) }),
  aiComplete: (prompt: string) => req<{ provider: string; stub: boolean; output: string }>('/api/dev/ai/complete', { method: 'POST', body: JSON.stringify({ prompt }) }),
  audit: () => req<Array<{ event: string; module?: string; detail?: unknown; createdAt: string }>>('/api/system/audit'),
};
