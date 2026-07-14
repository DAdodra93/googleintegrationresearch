import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/system/status', async () => ({
    ok: true,
    store: ctx.store.kind,
    google: { stub: ctx.config.google.stub, clientConfigured: Boolean(ctx.config.google.clientId) },
    ads: {
      mccConfigured: ctx.config.ads.configured,
      mccCustomerId: ctx.config.ads.mccCustomerId ?? null,
    },
    ai: { provider: ctx.ai.name, stub: ctx.ai.stub },
    billing: { model: ctx.billing.model },
    defaults: ctx.config.defaults,
    encKeyEphemeral: ctx.config.encKeyIsEphemeral,
  }));

  app.get('/api/system/audit', async (req) => {
    const { limit } = req.query as { limit?: string };
    return ctx.store.listAudit(limit ? Number(limit) : 50);
  });
}
