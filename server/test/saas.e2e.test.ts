import { describe, expect, it } from 'vitest';
import { freshApp, signup, withAuth } from './helpers.js';

/**
 * SaaS multi-tenancy: sign-up/sign-in, per-tenant isolation, and the
 * operator/merchant role split.
 */
describe('SaaS auth & tenant isolation', () => {
  it('unauthenticated API access is rejected; signup sets a session', async () => {
    const app = await freshApp();
    expect((await app.inject({ method: 'GET', url: '/api/merchants' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/system/status' })).statusCode).toBe(401);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'owner@cafe.in', password: 'secret-password-123', businessName: 'Cafe Owner Co' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.role).toBe('operator'); // first user bootstraps as operator
    expect(body.merchant.name).toBe('Cafe Owner Co');
    expect(res.headers['set-cookie']).toContain('gge_session=');
  });

  it('login works with right password, fails with wrong; weak/duplicate signups rejected', async () => {
    const app = await freshApp();
    await signup(app, 'a@x.dev');
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@x.dev', password: 'wrong-wrong' } });
    expect(bad.statusCode).toBe(401);
    const good = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@x.dev', password: 'secret-password-123' } });
    expect(good.statusCode).toBe(200);
    const dup = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'a@x.dev', password: 'secret-password-123' } });
    expect(dup.statusCode).toBe(409);
    const weak = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'b@x.dev', password: 'short' } });
    expect(weak.statusCode).toBe(400);
  });

  it('merchant users cannot see or touch another tenant\'s data', async () => {
    const app = await freshApp();
    await signup(app, 'operator@platform.dev'); // consumes the operator bootstrap
    const a = withAuth(app, (await signup(app, 'alice@shop.in', 'Alice Sarees')).cookie);
    const b = withAuth(app, (await signup(app, 'bob@store.in', 'Bob Electronics')).cookie);

    const aMerchants = (await a.inject({ method: 'GET', url: '/api/merchants' })).json();
    const bMerchants = (await b.inject({ method: 'GET', url: '/api/merchants' })).json();
    expect(aMerchants.map((m: any) => m.name)).toEqual(['Alice Sarees']);
    expect(bMerchants.map((m: any) => m.name)).toEqual(['Bob Electronics']);
    const aliceId = aMerchants[0].id;

    // Bob cannot read Alice's merchant, connections, or start OAuth for her.
    expect((await b.inject({ method: 'GET', url: `/api/merchants/${aliceId}` })).statusCode).toBe(403);
    expect((await b.inject({ method: 'GET', url: `/api/merchants/${aliceId}/connections` })).statusCode).toBe(403);
    expect((await b.inject({ method: 'GET', url: `/auth/google/gbp/start?merchantId=${aliceId}` })).statusCode).toBe(403);
    expect((await b.inject({ method: 'GET', url: `/api/ads/accounts?merchantId=${aliceId}` })).statusCode).toBe(403);
    expect((await b.inject({ method: 'GET', url: `/api/gbp/profiles?merchantId=${aliceId}` })).statusCode).toBe(403);
  });

  it('approvals are tenant-scoped; merchants approve their own actions but not operator-only ones', async () => {
    const app = await freshApp();
    const op = withAuth(app, (await signup(app, 'operator@platform.dev')).cookie);
    const alice = withAuth(app, (await signup(app, 'alice@shop.in', 'Alice Sarees')).cookie);
    const bob = withAuth(app, (await signup(app, 'bob@store.in', 'Bob Electronics')).cookie);
    const aliceMerchant = (await alice.inject({ method: 'GET', url: '/api/merchants' })).json()[0];

    // Alice provisions an Ads account → approval is operator-only (our money).
    await alice.inject({
      method: 'POST',
      url: '/api/ads/accounts',
      payload: { merchantId: aliceMerchant.id, flow: 'provisioned', billingMode: 'we_pay_provisioned', name: 'Alice Ads' },
    });
    const alicePending = (await alice.inject({ method: 'GET', url: '/api/approvals?status=pending' })).json();
    expect(alicePending).toHaveLength(1); // she can SEE her own approval

    // Bob sees nothing of it.
    expect((await bob.inject({ method: 'GET', url: '/api/approvals?status=pending' })).json()).toHaveLength(0);
    // Bob cannot decide it either.
    expect((await bob.inject({ method: 'POST', url: `/api/approvals/${alicePending[0].id}/approve`, payload: {} })).statusCode).toBe(403);
    // Alice cannot approve it herself — provisioning spends platform money.
    expect((await alice.inject({ method: 'POST', url: `/api/approvals/${alicePending[0].id}/approve`, payload: {} })).statusCode).toBe(403);
    // The operator can.
    const decided = (await op.inject({ method: 'POST', url: `/api/approvals/${alicePending[0].id}/approve`, payload: {} })).json();
    expect(decided.status).toBe('executed');
    expect(decided.decidedBy).toBe('operator@platform.dev');

    // Funding confirmation is operator-only too.
    const [account] = (await alice.inject({ method: 'GET', url: `/api/ads/accounts?merchantId=${aliceMerchant.id}` })).json();
    expect((await alice.inject({ method: 'POST', url: `/api/ads/accounts/${account.id}/billing/mark-funded` })).statusCode).toBe(403);
    expect((await op.inject({ method: 'POST', url: `/api/ads/accounts/${account.id}/billing/mark-funded` })).statusCode).toBe(200);

    // But Alice CAN approve her own campaign launch (her ad, her call).
    const budget = (
      await alice.inject({
        method: 'POST',
        url: '/api/ads/ai/budget',
        payload: { merchantId: aliceMerchant.id, targetCostPerLead: 50, hardDailyCeiling: 400, monthlyCap: 8000 },
      })
    ).json();
    const campaign = (
      await alice.inject({
        method: 'POST',
        url: '/api/ads/campaigns',
        payload: {
          merchantId: aliceMerchant.id,
          adsAccountId: account.id,
          adType: 'search',
          name: 'Alice WhatsApp leads',
          budget,
          spec: {
            geo: { countryCodes: ['IN'], locations: [] },
            keywords: [{ text: 'sarees bangalore', matchType: 'PHRASE' }],
            adCopy: { headlines: ['Alice Sarees', 'Chat on WhatsApp', 'Handloom classics'], descriptions: ['Message us to order.', 'Fast WhatsApp replies.'] },
            leadDestination: { strategy: 's1_redirect', channel: 'whatsapp', whatsappNumber: '919812345678' },
          },
        },
      })
    ).json();
    await alice.inject({ method: 'POST', url: `/api/ads/campaigns/${campaign.id}/propose-launch` });
    const launch = (await alice.inject({ method: 'GET', url: '/api/approvals?status=pending' })).json()[0];
    const launched = (await alice.inject({ method: 'POST', url: `/api/approvals/${launch.id}/approve`, payload: {} })).json();
    expect(launched.status).toBe('executed');

    // Bob cannot read Alice's campaign or its insights.
    expect((await bob.inject({ method: 'GET', url: `/api/ads/campaigns/${campaign.id}` })).statusCode).toBe(403);
    expect((await bob.inject({ method: 'GET', url: `/api/ads/campaigns/${campaign.id}/insights` })).statusCode).toBe(403);
  });

  it('dev routes and audit are operator-only; lead redirects stay public', async () => {
    const app = await freshApp();
    await signup(app, 'operator@platform.dev');
    const alice = withAuth(app, (await signup(app, 'alice@shop.in', 'Alice Sarees')).cookie);
    expect((await alice.inject({ method: 'POST', url: '/api/dev/ai/complete', payload: { prompt: 'x' } })).statusCode).toBe(403);
    expect((await alice.inject({ method: 'GET', url: '/api/system/audit' })).statusCode).toBe(403);
    // Public lead redirect requires no session (ad clicks are anonymous).
    expect((await app.inject({ method: 'GET', url: '/r/unknown-slug' })).statusCode).toBe(404);
  });
});
