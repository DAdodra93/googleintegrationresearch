export interface GbpProfile {
  id: string;
  flow: 'existing' | 'created';
  title: string;
  status: string;
  locationName: string | null;
  verification: { method?: string; state?: string; note?: string } | null;
  prefill: any;
}
export interface GbpReview {
  reviewName: string;
  reviewer: string;
  starRating: number;
  comment: string;
  createTime: string;
  reply: { comment: string } | null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? res.statusText);
  return body as T;
}
export const gbpApi = {
  discover: (merchantId: string) =>
    req<Array<{ account: { name: string; accountName: string }; locations: Array<{ name: string; title: string; verified: boolean }> }>>(
      `/api/gbp/discover?merchantId=${merchantId}`,
    ),
  profiles: (merchantId: string) => req<GbpProfile[]>(`/api/gbp/profiles?merchantId=${merchantId}`),
  profile: (id: string) => req<GbpProfile>(`/api/gbp/profiles/${id}`),
  connectExisting: (body: object) => req<GbpProfile>('/api/gbp/profiles', { method: 'POST', body: JSON.stringify(body) }),
  createDraft: (body: object) => req<GbpProfile>('/api/gbp/profiles/draft', { method: 'POST', body: JSON.stringify(body) }),
  proposeCreate: (id: string) => req<unknown>(`/api/gbp/profiles/${id}/propose-create`, { method: 'POST', body: '{}' }),
  verificationOptions: (id: string) => req<Array<{ method: string; detail?: string }>>(`/api/gbp/profiles/${id}/verification/options`),
  startVerification: (id: string, method: string) =>
    req<GbpProfile>(`/api/gbp/profiles/${id}/verification/start`, { method: 'POST', body: JSON.stringify({ method }) }),
  completeVerification: (id: string, pin: string) =>
    req<GbpProfile>(`/api/gbp/profiles/${id}/verification/complete`, { method: 'POST', body: JSON.stringify({ pin }) }),
  info: (id: string) => req<any>(`/api/gbp/profiles/${id}/info`),
  proposeInfoUpdate: (id: string, patch: object) =>
    req<unknown>(`/api/gbp/profiles/${id}/propose-info-update`, { method: 'POST', body: JSON.stringify(patch) }),
  reviews: (id: string) => req<GbpReview[]>(`/api/gbp/profiles/${id}/reviews`),
  proposeReviewReply: (id: string, reviewName: string, reply: string) =>
    req<unknown>(`/api/gbp/profiles/${id}/propose-review-reply`, { method: 'POST', body: JSON.stringify({ reviewName, reply }) }),
  posts: (id: string) => req<any[]>(`/api/gbp/profiles/${id}/posts`),
  proposePost: (id: string, body: object) => req<unknown>(`/api/gbp/profiles/${id}/propose-post`, { method: 'POST', body: JSON.stringify(body) }),
  media: (id: string) => req<any[]>(`/api/gbp/profiles/${id}/media`),
  proposeMedia: (id: string, body: object) => req<unknown>(`/api/gbp/profiles/${id}/propose-media`, { method: 'POST', body: JSON.stringify(body) }),
  performance: (id: string, days = 28) => req<any>(`/api/gbp/profiles/${id}/performance?days=${days}`),
  keywords: (id: string) => req<Array<{ keyword: string; impressions: number }>>(`/api/gbp/profiles/${id}/keywords`),
  aiRewrite: (body: object) => req<{ suggestion: string }>('/api/gbp/ai/rewrite', { method: 'POST', body: JSON.stringify(body) }),
  aiReviewReply: (body: object) => req<{ suggestion: string }>('/api/gbp/ai/review-reply', { method: 'POST', body: JSON.stringify(body) }),
  aiPost: (body: object) => req<{ summary: string; ctaType?: string; ctaUrl?: string }>('/api/gbp/ai/post', { method: 'POST', body: JSON.stringify(body) }),
};
