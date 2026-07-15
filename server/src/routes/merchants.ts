import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';

const CreateMerchant = z.object({
  name: z.string().min(1).max(200),
  countryCode: z.string().length(2).optional(),
  currencyCode: z.string().length(3).optional(),
});

export function registerMerchantRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Scoped: merchant users see only their own businesses; operators see all.
  app.get('/api/merchants', async (req) => {
    const scope = await ctx.authz.merchantScope(req);
    const all = await ctx.store.listMerchants();
    return scope === 'all' ? all : all.filter((m) => scope.includes(m.id));
  });

  app.post('/api/merchants', async (req, reply) => {
    const user = ctx.authz.user(req);
    const body = CreateMerchant.parse(req.body);
    const merchant = await ctx.store.createMerchant({
      name: body.name,
      countryCode: (body.countryCode ?? ctx.config.defaults.country).toUpperCase(),
      currencyCode: (body.currencyCode ?? ctx.config.defaults.currency).toUpperCase(),
    });
    await ctx.store.bindUserMerchant(user.id, merchant.id);
    await ctx.store.audit({ merchantId: merchant.id, event: 'merchant.created', detail: { name: merchant.name, by: user.email } });
    reply.status(201);
    return merchant;
  });

  app.get('/api/merchants/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await ctx.authz.assertMerchant(req, id);
    const merchant = await ctx.store.getMerchant(id);
    if (!merchant) return reply.status(404).send({ error: 'merchant not found' });
    return merchant;
  });

  app.get('/api/merchants/:id/connections', async (req) => {
    const { id } = req.params as { id: string };
    await ctx.authz.assertMerchant(req, id);
    const connections = await ctx.store.listConnections(id);
    // Never expose the encrypted token blob to the console.
    return connections.map(({ refreshTokenEnc: _hidden, ...rest }) => rest);
  });

  app.delete('/api/connections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conn = await ctx.store.getConnectionById(id);
    if (!conn) return reply.status(404).send({ error: 'connection not found' });
    await ctx.authz.assertMerchant(req, conn.merchantId);
    await ctx.store.deleteConnection(id);
    reply.status(204).send();
  });
}
