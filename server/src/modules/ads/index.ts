import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import { RealTokenExchanger } from '../../core/googleauth/exchanger.js';
import { generateAdCopy, proposeBudget } from './ai.js';
import type { AdsGateway } from './gateway.js';
import { RealAdsGateway } from './gateway-real.js';
import { StubAdsGateway } from './gateway-stub.js';
import { AdsService } from './service.js';
import { MemoryAdsStore, type AdsStore } from './store.js';
import { PgAdsStore } from './store-pg.js';
import { AD_TYPES, BudgetSchema, IMPLEMENTED_AD_TYPES } from './types.js';

/**
 * Ads module — fully independent of the GBP module. Registers its own
 * routes, stores, gateway, and approval executors. Removing this call leaves
 * the rest of the app fully functional (and vice versa for GBP).
 */
export function registerAdsModule(app: FastifyInstance, ctx: AppContext): AdsService {
  const store: AdsStore = ctx.store.kind === 'postgres' && ctx.config.databaseUrl ? new PgAdsStore(ctx.config.databaseUrl) : new MemoryAdsStore();

  // Real gateway activates when ADS_DEVELOPER_TOKEN + ADS_MCC_CUSTOMER_ID +
  // ADS_MCC_REFRESH_TOKEN (operator OAuth for the MCC user, adwords scope)
  // and the Google OAuth client are all configured; otherwise stub (flagged
  // in /api/system/status). All operations run AS THE MCC — merchant OAuth
  // is not used for manager operations.
  let gateway: AdsGateway;
  if (ctx.config.ads.configured && !ctx.config.google.stub) {
    const exchanger = new RealTokenExchanger(ctx.config.google.clientId!, ctx.config.google.clientSecret!);
    let cached: { token: string; expiresAt: number } | null = null;
    gateway = new RealAdsGateway({
      developerToken: ctx.config.ads.developerToken!,
      mccCustomerId: ctx.config.ads.mccCustomerId!,
      getAccessToken: async () => {
        if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
        const { accessToken, expiresInSec } = await exchanger.refreshAccessToken(ctx.config.ads.mccRefreshToken!);
        cached = { token: accessToken, expiresAt: Date.now() + expiresInSec * 1000 };
        return accessToken;
      },
    });
  } else {
    gateway = new StubAdsGateway();
  }

  const service = new AdsService(ctx, store, gateway);

  // ── approval executors: the ONLY paths that touch Google externally ──────
  ctx.approvals.registerExecutor('ads.account.link', (a) => service.executeLink(a.payload as any));
  ctx.approvals.registerExecutor('ads.account.provision', (a) => service.executeProvision(a.payload as any));
  ctx.approvals.registerExecutor('ads.campaign.launch', (a) => service.executeLaunch(a.payload as any));
  ctx.approvals.registerExecutor('ads.campaign.edit', (a) => service.executeEdit(a.payload as any));

  // ── routes ────────────────────────────────────────────────────────────────
  app.get('/api/ads/meta', async () => ({
    gatewayStub: service.gatewayIsStub,
    adTypes: AD_TYPES.map((t) => ({ key: t, implemented: IMPLEMENTED_AD_TYPES.includes(t) })),
    leadStrategies: [
      { key: 's1_redirect', implemented: true, note: 'tracked redirect page (default)' },
      { key: 's3_direct', implemented: true, note: 'direct wa.me / ig.me final URL (weak tracking)' },
      { key: 's2_message_asset', implemented: false, note: 'native message asset — API allowlist-gated (future)' },
      { key: 's4_lead_form', implemented: false, note: 'lead form + webhook (future)' },
    ],
  }));

  app.post('/api/ads/accounts', async (req, reply) => {
    const body = z
      .object({
        merchantId: z.string().uuid(),
        flow: z.enum(['existing_linked', 'provisioned']),
        billingMode: z.enum(['manage_only', 'we_pay_transfer', 'we_pay_provisioned']),
        customerId: z.string().regex(/^\d{10}$/).optional(),
        name: z.string().optional(),
      })
      .parse(req.body);
    reply.status(201);
    return service.setupAccount(body);
  });

  app.get('/api/ads/accounts', async (req) => {
    const { merchantId } = z.object({ merchantId: z.string().uuid() }).parse(req.query);
    return service.listAccounts(merchantId);
  });

  app.post('/api/ads/accounts/:id/refresh', async (req) => service.refreshAccount((req.params as any).id));

  app.get('/api/ads/accounts/:id/structure', async (req) => service.accountStructure((req.params as any).id));

  // Interim-billing ops action: operator confirms the manual Ads-UI billing step.
  app.post('/api/ads/accounts/:id/billing/mark-funded', async (req) => {
    const account = await service.refreshAccount((req.params as any).id);
    if (!account.customerId) throw new Error('no customerId yet');
    const status = await ctx.billing.markFunded({ merchantId: account.merchantId, adsCustomerId: account.customerId, by: 'operator' });
    return { status };
  });

  app.post('/api/ads/campaigns', async (req, reply) => {
    const body = z
      .object({
        merchantId: z.string().uuid(),
        adsAccountId: z.string().uuid(),
        adType: z.string().default('search'),
        name: z.string().min(1).max(120),
        spec: z.unknown(),
        budget: BudgetSchema,
      })
      .parse(req.body);
    reply.status(201);
    return service.createDraft({ ...body, spec: body.spec ?? {} });
  });

  app.get('/api/ads/campaigns', async (req) => {
    const { merchantId } = z.object({ merchantId: z.string().uuid() }).parse(req.query);
    return service.listCampaigns(merchantId);
  });

  app.get('/api/ads/campaigns/:id', async (req) => {
    const campaign = await service.getCampaign((req.params as any).id);
    if (!campaign) throw Object.assign(new Error('campaign not found'), { statusCode: 404 });
    return { ...campaign, finalUrl: service.finalUrl(campaign) };
  });

  app.post('/api/ads/campaigns/:id/propose-launch', async (req, reply) => {
    reply.status(201);
    return service.proposeLaunch((req.params as any).id);
  });

  app.post('/api/ads/campaigns/:id/propose-edit', async (req, reply) => {
    const body = z
      .object({ action: z.enum(['pause', 'resume', 'set_daily_budget']), dailyAmount: z.number().positive().optional() })
      .parse(req.body);
    reply.status(201);
    return service.proposeEdit((req.params as any).id, body);
  });

  app.get('/api/ads/campaigns/:id/insights', async (req) => {
    const { windowDays } = z.object({ windowDays: z.coerce.number().int().min(1).max(90).default(7) }).parse(req.query ?? {});
    return service.insights((req.params as any).id, windowDays);
  });

  app.post('/api/ads/campaigns/:id/tcpl/evaluate', async (req) => {
    const { windowDays } = z.object({ windowDays: z.coerce.number().int().min(1).max(90).default(7) }).parse((req.body as any) ?? {});
    return service.evaluateTcpl((req.params as any).id, windowDays);
  });

  app.get('/api/ads/campaigns/:id/tcpl/history', async (req) => service.listTcplEvaluations((req.params as any).id));

  // AI assists (internal reads/generation — autonomous by design; outputs
  // only reach Google through the approval-gated launch/edit paths).
  app.post('/api/ads/ai/budget', async (req) => {
    const body = z
      .object({
        merchantId: z.string().uuid(),
        targetCostPerLead: z.number().positive(),
        hardDailyCeiling: z.number().positive(),
        monthlyCap: z.number().positive(),
        keywords: z.array(z.string()).default([]),
      })
      .parse(req.body);
    const merchant = await ctx.store.getMerchant(body.merchantId);
    if (!merchant) throw new Error('merchant not found');
    return proposeBudget(ctx.ai, {
      merchantName: merchant.name,
      country: merchant.countryCode,
      currency: merchant.currencyCode,
      ...body,
    });
  });

  app.post('/api/ads/ai/ad-copy', async (req) => {
    const body = z
      .object({
        merchantId: z.string().uuid(),
        business: z.string().default(''),
        channel: z.enum(['whatsapp', 'instagram_dm']),
        keywords: z.array(z.string()).default([]),
      })
      .parse(req.body);
    const merchant = await ctx.store.getMerchant(body.merchantId);
    if (!merchant) throw new Error('merchant not found');
    return generateAdCopy(ctx.ai, { merchantName: merchant.name, ...body });
  });

  // ── S1 lead redirect (public; this URL is the ad's final URL) ────────────
  app.get('/r/:slug', async (req, reply) => {
    const destination = await service.handleLeadRedirect((req.params as any).slug, req.headers['user-agent']);
    if (!destination) return reply.status(404).send({ error: 'unknown link' });
    return reply.redirect(destination);
  });

  return service;
}
