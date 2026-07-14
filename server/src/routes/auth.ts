import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Module } from '../core/store/types.js';

function parseModule(raw: string): Module {
  if (raw !== 'gbp' && raw !== 'ads') throw Object.assign(new Error('unknown module'), { statusCode: 404 });
  return raw;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Browser entrypoint: redirects to Google consent (or straight back to the
  // callback in stub mode).
  app.get('/auth/google/:module/start', async (req, reply) => {
    const module = parseModule((req.params as { module: string }).module);
    const { merchantId } = req.query as { merchantId?: string };
    if (!merchantId) return reply.status(400).send({ error: 'merchantId required' });
    const url = await ctx.googleAuth.startConnect(merchantId, module);
    return reply.redirect(url);
  });

  app.get('/auth/google/:module/callback', async (req, reply) => {
    const module = parseModule((req.params as { module: string }).module);
    try {
      const conn = await ctx.googleAuth.handleCallback(module, req.query as Record<string, string>);
      return reply.redirect(`/?connected=${module}&merchantId=${conn.merchantId}`);
    } catch (err) {
      req.log.error(err);
      return reply.redirect(`/?connect_error=${encodeURIComponent(String(err))}`);
    }
  });
}
