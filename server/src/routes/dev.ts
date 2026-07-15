import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';

/**
 * Dev/pipeline-proof routes — operator-only diagnostics.
 */
export function registerDevRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/dev/')) ctx.authz.requireOperator(req);
  });
  // Proves the AI seam: prompt → provider (stub or OpenAI) → response.
  app.post('/api/dev/ai/complete', async (req) => {
    const body = z.object({ prompt: z.string().min(1), system: z.string().optional(), json: z.boolean().optional() }).parse(req.body);
    const output = await ctx.ai.complete(body);
    return { provider: ctx.ai.name, stub: ctx.ai.stub, output };
  });

  // Proves the propose→approve→execute pipeline with the demo executor.
  app.post('/api/dev/approvals/demo', async (req, reply) => {
    const body = z
      .object({ merchantId: z.string().uuid(), summary: z.string().default('Demo action (echo)'), payload: z.unknown().optional() })
      .parse(req.body);
    const approval = await ctx.approvals.propose({
      merchantId: body.merchantId,
      module: 'gbp',
      actionType: 'demo.echo',
      payload: body.payload ?? { demo: true },
      summary: body.summary,
      proposedBy: 'operator',
    });
    reply.status(201);
    return approval;
  });

  // Proves token storage + refresh: returns a masked access token for a connection.
  app.get('/api/dev/token/:merchantId/:module', async (req) => {
    const { merchantId, module } = req.params as { merchantId: string; module: 'gbp' | 'ads' };
    const token = await ctx.googleAuth.getAccessToken(merchantId, module);
    return { module, accessTokenPreview: `${token.slice(0, 12)}…`, length: token.length };
  });

  // Proves the interim billing pipeline: ensure funding → pending manual step → mark funded.
  app.post('/api/dev/billing/ensure', async (req) => {
    const body = z.object({ merchantId: z.string().uuid(), adsCustomerId: z.string().min(3) }).parse(req.body);
    const status = await ctx.billing.ensureAccountFunding(body);
    return { model: ctx.billing.model, status };
  });
  app.post('/api/dev/billing/mark-funded', async (req) => {
    const body = z.object({ merchantId: z.string().uuid(), adsCustomerId: z.string().min(3) }).parse(req.body);
    const status = await ctx.billing.markFunded({ ...body, by: 'operator' });
    return { model: ctx.billing.model, status };
  });
}
