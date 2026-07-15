import { describe, expect, it } from 'vitest';
import { authedApp } from './helpers.js';

/**
 * Full stub-mode pipeline: merchant → OAuth connect (stub exchanger, both
 * modules independently) → token refresh → AI seam → billing seam →
 * approvals. This is exactly what runs the instant real credentials land —
 * only the exchanger/provider implementations swap.
 */
async function stubApp() {
  return { app: await authedApp() };
}

describe('foundation E2E (stub mode)', () => {
  it('connects GBP and Ads independently via the OAuth flow', async () => {
    const { app } = await stubApp();
    const merchantRes = await app.inject({ method: 'POST', url: '/api/merchants', payload: { name: 'Chai Point' } });
    expect(merchantRes.statusCode).toBe(201);
    const merchant = merchantRes.json();
    expect(merchant.countryCode).toBe('IN');
    expect(merchant.currencyCode).toBe('INR');

    for (const module of ['gbp', 'ads'] as const) {
      const start = await app.inject({ method: 'GET', url: `/auth/google/${module}/start?merchantId=${merchant.id}` });
      expect(start.statusCode).toBe(302);
      const authUrl = new URL(start.headers.location as string);
      // Stub mode bounces straight back to our callback.
      expect(authUrl.pathname).toBe(`/auth/google/${module}/callback`);

      const cb = await app.inject({ method: 'GET', url: authUrl.pathname + authUrl.search });
      expect(cb.statusCode).toBe(302);
      expect(cb.headers.location).toContain(`connected=${module}`);
    }

    const conns = (await app.inject({ method: 'GET', url: `/api/merchants/${merchant.id}/connections` })).json();
    expect(conns).toHaveLength(2);
    expect(conns.map((c: any) => c.module).sort()).toEqual(['ads', 'gbp']);
    expect(JSON.stringify(conns)).not.toContain('refreshToken');

    // Token pipeline works per module.
    const tok = (await app.inject({ method: 'GET', url: `/api/dev/token/${merchant.id}/gbp` })).json();
    expect(tok.accessTokenPreview).toContain('stub-access');
  });

  it('GBP-only merchant works with Ads absent (module independence)', async () => {
    const { app } = await stubApp();
    const merchant = (await app.inject({ method: 'POST', url: '/api/merchants', payload: { name: 'Solo GBP' } })).json();
    const start = await app.inject({ method: 'GET', url: `/auth/google/gbp/start?merchantId=${merchant.id}` });
    const authUrl = new URL(start.headers.location as string);
    await app.inject({ method: 'GET', url: authUrl.pathname + authUrl.search });

    const gbpToken = await app.inject({ method: 'GET', url: `/api/dev/token/${merchant.id}/gbp` });
    expect(gbpToken.statusCode).toBe(200);
    const adsToken = await app.inject({ method: 'GET', url: `/api/dev/token/${merchant.id}/ads` });
    expect(adsToken.statusCode).toBe(500); // no ads connection — and gbp unaffected
  });

  it('rejects a tampered OAuth state', async () => {
    const { app } = await stubApp();
    const merchant = (await app.inject({ method: 'POST', url: '/api/merchants', payload: { name: 'M' } })).json();
    const start = await app.inject({ method: 'GET', url: `/auth/google/gbp/start?merchantId=${merchant.id}` });
    const authUrl = new URL(start.headers.location as string);
    authUrl.searchParams.set('state', authUrl.searchParams.get('state')!.slice(0, -4) + 'AAAA');
    const cb = await app.inject({ method: 'GET', url: authUrl.pathname + authUrl.search });
    expect(cb.headers.location).toContain('connect_error');
  });

  it('AI seam responds via stub provider', async () => {
    const { app } = await stubApp();
    const res = (
      await app.inject({ method: 'POST', url: '/api/dev/ai/complete', payload: { prompt: 'Rewrite my description' } })
    ).json();
    expect(res.stub).toBe(true);
    expect(res.output).toContain('Rewrite my description');
  });

  it('interim billing: ensure → pending manual step → mark funded', async () => {
    const { app } = await stubApp();
    const merchant = (await app.inject({ method: 'POST', url: '/api/merchants', payload: { name: 'Ads Co' } })).json();
    const ensure = (
      await app.inject({ method: 'POST', url: '/api/dev/billing/ensure', payload: { merchantId: merchant.id, adsCustomerId: '1234567890' } })
    ).json();
    expect(ensure).toEqual({ model: 'interim', status: 'pending_manual_billing_setup' });
    const funded = (
      await app.inject({ method: 'POST', url: '/api/dev/billing/mark-funded', payload: { merchantId: merchant.id, adsCustomerId: '1234567890' } })
    ).json();
    expect(funded.status).toBe('funded');
  });

  it('approval queue over HTTP: propose → list pending → approve → executed', async () => {
    const { app } = await stubApp();
    const merchant = (await app.inject({ method: 'POST', url: '/api/merchants', payload: { name: 'Q' } })).json();
    const proposed = (
      await app.inject({ method: 'POST', url: '/api/dev/approvals/demo', payload: { merchantId: merchant.id, summary: 'Demo publish' } })
    ).json();
    expect(proposed.status).toBe('pending');

    const pending = (await app.inject({ method: 'GET', url: '/api/approvals?status=pending' })).json();
    expect(pending.some((a: any) => a.id === proposed.id)).toBe(true);

    const decided = (
      await app.inject({ method: 'POST', url: `/api/approvals/${proposed.id}/approve`, payload: { decidedBy: 'operator' } })
    ).json();
    expect(decided.status).toBe('executed');
  });
});
