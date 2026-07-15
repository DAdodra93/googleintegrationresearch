import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import { draftReviewReply, generatePost, rewriteField } from './ai.js';
import type { GbpGateway } from './gateway.js';
import { RealGbpGateway } from './gateway-real.js';
import { StubGbpGateway } from './gateway-stub.js';
import { GbpService } from './service.js';
import { MemoryGbpStore, PgGbpStore, type GbpStore } from './store.js';
import { InfoPatchSchema, PostInputSchema, PrefillInputSchema } from './types.js';

/**
 * GBP module — fully independent of the Ads module. Real gateway activates
 * automatically when Google OAuth is real (per-merchant tokens via the shared
 * auth service); GBP quota approval is the only additional gate (429s surface
 * a clear message until then).
 */
export function registerGbpModule(app: FastifyInstance, ctx: AppContext): GbpService {
  const store: GbpStore =
    ctx.store.kind === 'postgres' && ctx.config.databaseUrl ? new PgGbpStore(ctx.config.databaseUrl) : new MemoryGbpStore();

  const gateway: GbpGateway = ctx.config.google.stub
    ? new StubGbpGateway()
    : new RealGbpGateway((merchantId) => ctx.googleAuth.getAccessToken(merchantId, 'gbp'));

  const service = new GbpService(ctx, store, gateway);

  // ── approval executors: the ONLY paths that write to Google ─────────────
  ctx.approvals.registerExecutor('gbp.info.update', (a) => service.executeInfoUpdate(a.payload as any));
  ctx.approvals.registerExecutor('gbp.review.reply', (a) => service.executeReviewReply(a.payload as any));
  ctx.approvals.registerExecutor('gbp.post.publish', (a) => service.executePost(a.payload as any));
  ctx.approvals.registerExecutor('gbp.media.upload', (a) => service.executeMedia(a.payload as any));
  ctx.approvals.registerExecutor('gbp.location.create', (a) => service.executeCreate(a.payload as any));

  // ── routes ────────────────────────────────────────────────────────────────
  app.get('/api/gbp/meta', async () => ({
    gatewayStub: service.gatewayIsStub,
    capabilities: ['info', 'reviews', 'posts', 'media', 'performance', 'keywords', 'create+verify'],
    removed: [{ capability: 'qna', reason: 'Google shut the Q&A API down Nov 3, 2025' }],
  }));

  const MerchantQ = z.object({ merchantId: z.string().uuid() });

  app.get('/api/gbp/discover', async (req) => service.discover(MerchantQ.parse(req.query).merchantId));

  app.post('/api/gbp/profiles', async (req, reply) => {
    const body = z
      .object({ merchantId: z.string().uuid(), accountName: z.string(), locationName: z.string(), title: z.string() })
      .parse(req.body);
    reply.status(201);
    return service.connectExisting(body);
  });

  app.get('/api/gbp/profiles', async (req) => service.listProfiles(MerchantQ.parse(req.query).merchantId));
  app.get('/api/gbp/profiles/:id', async (req) => service.refreshVerification((req.params as any).id));

  // Flow B
  app.post('/api/gbp/profiles/draft', async (req, reply) => {
    const body = z.object({ merchantId: z.string().uuid() }).and(PrefillInputSchema).parse(req.body);
    reply.status(201);
    return service.createDraft(body.merchantId, body);
  });
  app.post('/api/gbp/profiles/:id/propose-create', async (req, reply) => {
    reply.status(201);
    return service.proposeCreate((req.params as any).id);
  });
  app.get('/api/gbp/profiles/:id/verification/options', async (req) => service.verificationOptions((req.params as any).id));
  app.post('/api/gbp/profiles/:id/verification/start', async (req) => {
    const body = z
      .object({ method: z.string(), languageCode: z.string().default('en'), phoneNumber: z.string().optional(), emailAddress: z.string().optional() })
      .parse(req.body);
    return service.startVerification((req.params as any).id, body);
  });
  app.post('/api/gbp/profiles/:id/verification/complete', async (req) => {
    const { pin } = z.object({ pin: z.string().min(3) }).parse(req.body);
    return service.completeVerification((req.params as any).id, pin);
  });

  // Management surface
  app.get('/api/gbp/profiles/:id/info', async (req) => service.info((req.params as any).id));
  app.post('/api/gbp/profiles/:id/propose-info-update', async (req, reply) => {
    reply.status(201);
    return service.proposeInfoUpdate((req.params as any).id, InfoPatchSchema.parse(req.body));
  });

  app.get('/api/gbp/profiles/:id/reviews', async (req) => service.reviews((req.params as any).id));
  app.post('/api/gbp/profiles/:id/propose-review-reply', async (req, reply) => {
    const body = z.object({ reviewName: z.string(), reply: z.string().min(5).max(4000) }).parse(req.body);
    reply.status(201);
    return service.proposeReviewReply((req.params as any).id, body.reviewName, body.reply);
  });

  app.get('/api/gbp/profiles/:id/posts', async (req) => service.posts((req.params as any).id));
  app.post('/api/gbp/profiles/:id/propose-post', async (req, reply) => {
    reply.status(201);
    return service.proposePost((req.params as any).id, PostInputSchema.parse(req.body));
  });

  app.get('/api/gbp/profiles/:id/media', async (req) => service.media((req.params as any).id));
  app.post('/api/gbp/profiles/:id/propose-media', async (req, reply) => {
    const body = z
      .object({ sourceUrl: z.string().url(), category: z.enum(['COVER', 'PROFILE', 'ADDITIONAL']).default('ADDITIONAL') })
      .parse(req.body);
    reply.status(201);
    return service.proposeMedia((req.params as any).id, body.sourceUrl, body.category);
  });

  app.get('/api/gbp/profiles/:id/performance', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(180).default(28) }).parse(req.query ?? {});
    return service.performance((req.params as any).id, days);
  });
  app.get('/api/gbp/profiles/:id/keywords', async (req) => service.keywords((req.params as any).id));

  // AI assists (drafts only — writes go through approvals)
  app.post('/api/gbp/ai/rewrite', async (req) => {
    const body = z
      .object({
        profileId: z.string().uuid(),
        field: z.enum(['description', 'post', 'serviceDescription']),
        current: z.string().default(''),
        tone: z.string().optional(),
      })
      .parse(req.body);
    const profile = await service.getProfile(body.profileId);
    return { suggestion: await rewriteField(ctx.ai, { ...body, businessName: profile.title }) };
  });

  app.post('/api/gbp/ai/review-reply', async (req) => {
    const body = z.object({ profileId: z.string().uuid(), reviewName: z.string() }).parse(req.body);
    const profile = await service.getProfile(body.profileId);
    const review = (await service.reviews(body.profileId)).find((r) => r.reviewName === body.reviewName);
    if (!review) throw new Error('review not found');
    return { suggestion: await draftReviewReply(ctx.ai, { businessName: profile.title, review }) };
  });

  app.post('/api/gbp/ai/post', async (req) => {
    const body = z.object({ profileId: z.string().uuid(), topic: z.string().min(3), ctaUrl: z.string().url().optional() }).parse(req.body);
    const profile = await service.getProfile(body.profileId);
    return generatePost(ctx.ai, { businessName: profile.title, topic: body.topic, ctaUrl: body.ctaUrl });
  });

  return service;
}
