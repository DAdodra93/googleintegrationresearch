import { describe, expect, it } from 'vitest';
import { authedApp } from './helpers.js';

const SPEC = {
  geo: { countryCodes: ['IN'], locations: [] },
  languageCodes: ['en'],
  bidding: { strategy: 'MAXIMIZE_CLICKS' },
  keywords: [
    { text: 'chai delivery bangalore', matchType: 'PHRASE' },
    { text: 'tea shop near me', matchType: 'BROAD' },
  ],
  negativeKeywords: ['free'],
  adCopy: {
    headlines: ['Bangalore Chai Co', 'Chat on WhatsApp', 'Fresh chai daily'],
    descriptions: ['Order in seconds on WhatsApp.', 'Local, fast, loved by 1000s.'],
  },
  networks: { searchPartners: false },
  leadDestination: { strategy: 's1_redirect', channel: 'whatsapp', whatsappNumber: '919876543210', prefillText: 'Hi! I saw your ad' },
};

async function setup() {
  const app = await authedApp();
  const merchant = (await app.inject({ method: 'POST', url: '/api/merchants', payload: { name: 'Bangalore Chai Co' } })).json();
  return { app, merchant };
}

async function approveLatest(app: any) {
  const pending = (await app.inject({ method: 'GET', url: '/api/approvals?status=pending' })).json();
  const res = await app.inject({ method: 'POST', url: `/api/approvals/${pending[0].id}/approve`, payload: {} });
  return res.json();
}

/** Provision Flow B account through approvals and fund it; returns active account. */
async function provisionAccount(app: any, merchant: any) {
  const setupRes = (
    await app.inject({
      method: 'POST',
      url: '/api/ads/accounts',
      payload: { merchantId: merchant.id, flow: 'provisioned', billingMode: 'we_pay_provisioned', name: 'Chai Ads' },
    })
  ).json();
  expect(setupRes.approval.status).toBe('pending');
  const approved = await approveLatest(app);
  expect(approved.status).toBe('executed');
  const [account] = (await app.inject({ method: 'GET', url: `/api/ads/accounts?merchantId=${merchant.id}` })).json();
  expect(account.linkStatus).toBe('active');
  expect(account.customerId).toMatch(/^\d{10}$/);
  expect(account.funding).toBe('pending_manual_billing_setup');
  await app.inject({ method: 'POST', url: `/api/ads/accounts/${account.id}/billing/mark-funded` });
  return account;
}

async function draftCampaign(app: any, merchant: any, account: any, budgetOverrides: Record<string, number> = {}) {
  const budget = (
    await app.inject({
      method: 'POST',
      url: '/api/ads/ai/budget',
      payload: { merchantId: merchant.id, targetCostPerLead: 50, hardDailyCeiling: 400, monthlyCap: 8000, keywords: ['chai'] },
    })
  ).json();
  expect(budget.dailyAmount).toBeLessThanOrEqual(400);
  return (
    await app.inject({
      method: 'POST',
      url: '/api/ads/campaigns',
      payload: {
        merchantId: merchant.id,
        adsAccountId: account.id,
        adType: 'search',
        name: 'WhatsApp leads — search',
        spec: SPEC,
        budget: { ...budget, ...budgetOverrides },
      },
    })
  ).json();
}

describe('ads module E2E (stub gateway)', () => {
  it('Flow B: provision → fund → draft → AI budget → launch approval → live', async () => {
    const { app, merchant } = await setup();
    const account = await provisionAccount(app, merchant);
    const campaign = await draftCampaign(app, merchant, account);
    expect(campaign.status).toBe('draft');
    expect(campaign.leadSlug).toBeTruthy();

    const launchApproval = (await app.inject({ method: 'POST', url: `/api/ads/campaigns/${campaign.id}/propose-launch` })).json();
    expect(launchApproval.summary).toContain('LAUNCH');
    const executed = await approveLatest(app);
    expect(executed.status).toBe('executed');

    const live = (await app.inject({ method: 'GET', url: `/api/ads/campaigns/${campaign.id}` })).json();
    expect(live.status).toBe('launched');
    expect(live.googleRefs.campaign).toContain('/campaigns/');
    expect(live.finalUrl).toContain('/r/');
  });

  it('refuses to launch an unfunded account (interim billing gate)', async () => {
    const { app, merchant } = await setup();
    const setupRes = (
      await app.inject({
        method: 'POST',
        url: '/api/ads/accounts',
        payload: { merchantId: merchant.id, flow: 'provisioned', billingMode: 'we_pay_provisioned', name: 'Unfunded' },
      })
    ).json();
    await approveLatest(app);
    const [account] = (await app.inject({ method: 'GET', url: `/api/ads/accounts?merchantId=${merchant.id}` })).json();
    const campaign = await draftCampaign(app, merchant, account);
    const res = await app.inject({ method: 'POST', url: `/api/ads/campaigns/${campaign.id}/propose-launch` });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('pending_manual_billing_setup');
    void setupRes;
  });

  it('Flow A: link existing account → invited → active → reads pre-existing structure', async () => {
    const { app, merchant } = await setup();
    const { approval } = (
      await app.inject({
        method: 'POST',
        url: '/api/ads/accounts',
        payload: { merchantId: merchant.id, flow: 'existing_linked', billingMode: 'we_pay_transfer', customerId: '5551234567' },
      })
    ).json();
    expect(approval.summary).toContain('link invitation');
    await approveLatest(app);
    // First refresh polls the stub, which flips pending→active.
    await new Promise((r) => setTimeout(r, 5));
    const [account] = (await app.inject({ method: 'GET', url: `/api/ads/accounts?merchantId=${merchant.id}` })).json();
    expect(account.linkStatus).toBe('active');

    const structure = (await app.inject({ method: 'GET', url: `/api/ads/accounts/${account.id}/structure` })).json();
    expect(structure.length).toBeGreaterThan(0);
    expect(structure[0].name).toContain('Legacy');
  });

  it('S1 redirect logs a lead and CPL appears in insights', async () => {
    const { app, merchant } = await setup();
    const account = await provisionAccount(app, merchant);
    const campaign = await draftCampaign(app, merchant, account);
    await app.inject({ method: 'POST', url: `/api/ads/campaigns/${campaign.id}/propose-launch` });
    await approveLatest(app);

    const slug = (await app.inject({ method: 'GET', url: `/api/ads/campaigns/${campaign.id}` })).json().leadSlug;
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: 'GET', url: `/r/${slug}` });
      expect(r.statusCode).toBe(302);
      expect(r.headers.location).toContain('wa.me/919876543210');
      expect(r.headers.location).toContain('text=');
    }

    const ins = (await app.inject({ method: 'GET', url: `/api/ads/campaigns/${campaign.id}/insights` })).json();
    expect(ins.leads).toBe(3);
    expect(ins.spend).toBeGreaterThan(0);
    expect(ins.costPerLead).toBeCloseTo(ins.spend / 3, 1);
  });

  it('budget edits above the hard ceiling are refused', async () => {
    const { app, merchant } = await setup();
    const account = await provisionAccount(app, merchant);
    const campaign = await draftCampaign(app, merchant, account);
    await app.inject({ method: 'POST', url: `/api/ads/campaigns/${campaign.id}/propose-launch` });
    await approveLatest(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/ads/campaigns/${campaign.id}/propose-edit`,
      payload: { action: 'set_daily_budget', dailyAmount: 999999 },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('hard daily ceiling');
  });

  it('TCPL loop: cheap leads → raise proposal (queued, not executed); monthly cap breach → emergency pause', async () => {
    const { app, merchant } = await setup();
    const account = await provisionAccount(app, merchant);
    const campaign = await draftCampaign(app, merchant, account);
    await app.inject({ method: 'POST', url: `/api/ads/campaigns/${campaign.id}/propose-launch` });
    await approveLatest(app);
    const slug = (await app.inject({ method: 'GET', url: `/api/ads/campaigns/${campaign.id}` })).json().leadSlug;
    // Lots of leads → CPL far below target → raise-budget proposal.
    for (let i = 0; i < 30; i++) await app.inject({ method: 'GET', url: `/r/${slug}` });

    const evalRes = (await app.inject({ method: 'POST', url: `/api/ads/campaigns/${campaign.id}/tcpl/evaluate`, payload: {} })).json();
    expect(evalRes.evaluation.decision).toBe('propose_raise_budget');
    expect(evalRes.proposalId).toBeTruthy();
    // Still launched at the OLD budget — the raise sits in the approval queue.
    const after = (await app.inject({ method: 'GET', url: `/api/ads/campaigns/${campaign.id}` })).json();
    expect(after.status).toBe('launched');

    // Now shrink the monthly cap below spent amount → emergency auto-pause.
    const ins = (await app.inject({ method: 'GET', url: `/api/ads/campaigns/${campaign.id}/insights` })).json();
    void ins;
    // Recreate scenario via a new campaign with a tiny monthly cap:
    const tiny = await draftCampaign(app, merchant, account, { monthlyCap: 0.01 });
    await app.inject({ method: 'POST', url: `/api/ads/campaigns/${tiny.id}/propose-launch` });
    await approveLatest(app);
    const tinyEval = (await app.inject({ method: 'POST', url: `/api/ads/campaigns/${tiny.id}/tcpl/evaluate`, payload: {} })).json();
    expect(tinyEval.evaluation.decision).toBe('emergency_pause');
    const paused = (await app.inject({ method: 'GET', url: `/api/ads/campaigns/${tiny.id}` })).json();
    expect(paused.status).toBe('paused');
  });

  it('module independence: full ads lifecycle with zero GBP connection', async () => {
    const { app, merchant } = await setup();
    const conns = (await app.inject({ method: 'GET', url: `/api/merchants/${merchant.id}/connections` })).json();
    expect(conns).toHaveLength(0); // no GBP (or any) OAuth connection exists
    const account = await provisionAccount(app, merchant);
    expect(account.linkStatus).toBe('active');
  });

  it('unimplemented ad types are rejected as reserved slots', async () => {
    const { app, merchant } = await setup();
    const account = await provisionAccount(app, merchant);
    const res = await app.inject({
      method: 'POST',
      url: '/api/ads/campaigns',
      payload: {
        merchantId: merchant.id, adsAccountId: account.id, adType: 'performance_max', name: 'x', spec: SPEC,
        budget: { currency: 'INR', dailyAmount: 100, hardDailyCeiling: 200, monthlyCap: 5000, targetCostPerLead: 50 },
      },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('reserved future slot');
  });
});
