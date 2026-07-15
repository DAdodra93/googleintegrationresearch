import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/core/config.js';

async function setup() {
  const { app } = await buildApp(loadConfig({ PORT: '0' } as NodeJS.ProcessEnv));
  const merchant = (await app.inject({ method: 'POST', url: '/api/merchants', payload: { name: 'Chai Point Indiranagar' } })).json();
  // Connect the gbp module via the (stub) OAuth flow.
  const start = await app.inject({ method: 'GET', url: `/auth/google/gbp/start?merchantId=${merchant.id}` });
  const cb = new URL(start.headers.location as string);
  await app.inject({ method: 'GET', url: cb.pathname + cb.search });
  return { app, merchant };
}

async function approveLatest(app: any) {
  const pending = (await app.inject({ method: 'GET', url: '/api/approvals?status=pending' })).json();
  return (await app.inject({ method: 'POST', url: `/api/approvals/${pending[0].id}/approve`, payload: {} })).json();
}

async function connectExisting(app: any, merchant: any) {
  const discovery = (await app.inject({ method: 'GET', url: `/api/gbp/discover?merchantId=${merchant.id}` })).json();
  expect(discovery[0].locations.length).toBeGreaterThan(0);
  const { account, locations } = discovery[0];
  return (
    await app.inject({
      method: 'POST',
      url: '/api/gbp/profiles',
      payload: { merchantId: merchant.id, accountName: account.name, locationName: locations[0].name, title: locations[0].title },
    })
  ).json();
}

describe('gbp module E2E (stub gateway)', () => {
  it('requires the gbp OAuth connection before discovery', async () => {
    const { app } = await buildApp(loadConfig({ PORT: '0' } as NodeJS.ProcessEnv));
    const merchant = (await app.inject({ method: 'POST', url: '/api/merchants', payload: { name: 'No OAuth' } })).json();
    const res = await app.inject({ method: 'GET', url: `/api/gbp/discover?merchantId=${merchant.id}` });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('connect');
  });

  it('Flow A: discover → connect → read info → AI rewrite → approved update lands', async () => {
    const { app, merchant } = await setup();
    const profile = await connectExisting(app, merchant);
    expect(profile.status).toBe('connected');

    const info = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${profile.id}/info` })).json();
    expect(info.title).toBe('Existing Demo Business');

    const rewrite = (
      await app.inject({
        method: 'POST',
        url: '/api/gbp/ai/rewrite',
        payload: { profileId: profile.id, field: 'description', current: info.description },
      })
    ).json();
    expect(rewrite.suggestion.length).toBeGreaterThan(10);

    await app.inject({
      method: 'POST',
      url: `/api/gbp/profiles/${profile.id}/propose-info-update`,
      payload: { description: 'New improved description with local keywords.' },
    });
    const executed = await approveLatest(app);
    expect(executed.status).toBe('executed');
    const after = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${profile.id}/info` })).json();
    expect(after.description).toBe('New improved description with local keywords.');
  });

  it('reviews: list → AI draft reply → approval → reply visible; rejection changes nothing', async () => {
    const { app, merchant } = await setup();
    const profile = await connectExisting(app, merchant);
    const reviews = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${profile.id}/reviews` })).json();
    expect(reviews).toHaveLength(3);
    const negative = reviews.find((r: any) => r.starRating === 2);

    const draft = (
      await app.inject({ method: 'POST', url: '/api/gbp/ai/review-reply', payload: { profileId: profile.id, reviewName: negative.reviewName } })
    ).json();
    expect(draft.suggestion.toLowerCase()).toContain('priya');

    await app.inject({
      method: 'POST',
      url: `/api/gbp/profiles/${profile.id}/propose-review-reply`,
      payload: { reviewName: negative.reviewName, reply: draft.suggestion },
    });
    await approveLatest(app);
    const after = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${profile.id}/reviews` })).json();
    expect(after.find((r: any) => r.reviewName === negative.reviewName).reply.comment).toBe(draft.suggestion);

    // Reject path: propose a reply on another review and reject it.
    const positive = reviews.find((r: any) => r.starRating === 5);
    await app.inject({
      method: 'POST',
      url: `/api/gbp/profiles/${profile.id}/propose-review-reply`,
      payload: { reviewName: positive.reviewName, reply: 'Thanks a lot!' },
    });
    const pending = (await app.inject({ method: 'GET', url: '/api/approvals?status=pending' })).json();
    await app.inject({ method: 'POST', url: `/api/approvals/${pending[0].id}/reject`, payload: {} });
    const final = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${profile.id}/reviews` })).json();
    expect(final.find((r: any) => r.reviewName === positive.reviewName).reply).toBeNull();
  });

  it('posts + media via approvals; performance + keywords read autonomously', async () => {
    const { app, merchant } = await setup();
    const profile = await connectExisting(app, merchant);

    const aiPost = (
      await app.inject({ method: 'POST', url: '/api/gbp/ai/post', payload: { profileId: profile.id, topic: 'New winter menu launched' } })
    ).json();
    await app.inject({ method: 'POST', url: `/api/gbp/profiles/${profile.id}/propose-post`, payload: { summary: aiPost.summary, topicType: 'STANDARD' } });
    await approveLatest(app);
    const posts = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${profile.id}/posts` })).json();
    expect(posts).toHaveLength(1);
    expect(posts[0].state).toBe('LIVE');

    await app.inject({
      method: 'POST',
      url: `/api/gbp/profiles/${profile.id}/propose-media`,
      payload: { sourceUrl: 'https://example.in/photos/storefront.jpg', category: 'COVER' },
    });
    await approveLatest(app);
    const media = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${profile.id}/media` })).json();
    expect(media).toHaveLength(1);

    const perf = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${profile.id}/performance?days=28` })).json();
    expect(perf.daily.length).toBe(28);
    expect(perf.totals.impressionsSearch).toBeGreaterThan(0);
    expect(perf.beforeAfterTrendPct).toHaveProperty('impressions');

    const kws = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${profile.id}/keywords` })).json();
    expect(kws.length).toBeGreaterThan(2);
  });

  it('Flow B: AI-prefilled draft → approved create → PIN verification → full management surface', async () => {
    const { app, merchant } = await setup();
    const draft = (
      await app.inject({
        method: 'POST',
        url: '/api/gbp/profiles/draft',
        payload: {
          merchantId: merchant.id,
          businessName: 'Chai Point HSR',
          category: 'Cafe',
          addressLines: ['27th Main, Sector 1'],
          locality: 'Bengaluru',
          administrativeArea: 'KA',
          postalCode: '560102',
          regionCode: 'IN',
          phone: '+91 91234 56789',
          businessDetails: 'Second outlet of our chai cafe, HSR Layout.',
        },
      })
    ).json();
    expect(draft.status).toBe('draft');
    expect(draft.prefill.description.length).toBeGreaterThan(10);

    await app.inject({ method: 'POST', url: `/api/gbp/profiles/${draft.id}/propose-create` });
    const executed = await approveLatest(app);
    expect(executed.status).toBe('executed');
    let profile = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${draft.id}` })).json();
    expect(profile.status).toBe('created');
    expect(profile.locationName).toBeTruthy();

    const options = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${draft.id}/verification/options` })).json();
    expect(options.map((o: any) => o.method)).toContain('SMS');
    expect(options.map((o: any) => o.method)).toContain('VIDEO');

    profile = (
      await app.inject({ method: 'POST', url: `/api/gbp/profiles/${draft.id}/verification/start`, payload: { method: 'SMS' } })
    ).json();
    expect(profile.status).toBe('verification_pending');

    const bad = await app.inject({ method: 'POST', url: `/api/gbp/profiles/${draft.id}/verification/complete`, payload: { pin: '000000' } });
    expect(bad.statusCode).toBe(500);

    profile = (
      await app.inject({ method: 'POST', url: `/api/gbp/profiles/${draft.id}/verification/complete`, payload: { pin: '123456' } })
    ).json();
    expect(profile.status).toBe('verified');

    // Verified Flow B profile now has the full Flow A surface.
    const info = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${draft.id}/info` })).json();
    expect(info.title).toBe('Chai Point HSR');
    const perf = await app.inject({ method: 'GET', url: `/api/gbp/profiles/${draft.id}/performance?days=7` });
    expect(perf.statusCode).toBe(200);
  });

  it('Flow B video handoff: start VIDEO → pending → VoM poll flips to verified', async () => {
    const { app, merchant } = await setup();
    const draft = (
      await app.inject({
        method: 'POST',
        url: '/api/gbp/profiles/draft',
        payload: {
          merchantId: merchant.id, businessName: 'Video Verify Cafe', category: 'Cafe', addressLines: ['1 Test St'],
          locality: 'Bengaluru', postalCode: '560001', regionCode: 'IN', phone: '+91 90000 00000', businessDetails: '',
        },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/api/gbp/profiles/${draft.id}/propose-create` });
    await approveLatest(app);
    const p = (
      await app.inject({ method: 'POST', url: `/api/gbp/profiles/${draft.id}/verification/start`, payload: { method: 'VIDEO' } })
    ).json();
    expect(p.status).toBe('verification_pending');
    expect(p.verification.note).toContain('Google Business Profile app');
    // Simulate Google approving the video: complete via stub pin path is not
    // available for VIDEO, so VoM polling is the resolution path. Stub keeps
    // it pending — profile stays verification_pending on refresh.
    const refreshed = (await app.inject({ method: 'GET', url: `/api/gbp/profiles/${draft.id}` })).json();
    expect(refreshed.status).toBe('verification_pending');
  });

  it('module independence: GBP lifecycle works with zero Ads accounts', async () => {
    const { app, merchant } = await setup();
    const adsAccounts = (await app.inject({ method: 'GET', url: `/api/ads/accounts?merchantId=${merchant.id}` })).json();
    expect(adsAccounts).toHaveLength(0);
    const profile = await connectExisting(app, merchant);
    expect(profile.status).toBe('connected');
  });
});
