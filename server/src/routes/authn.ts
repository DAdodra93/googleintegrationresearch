import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { clearSessionCookie } from '../core/authn.js';

const Credentials = z.object({ email: z.string().email(), password: z.string().min(1) });

export function registerAuthnRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/auth/signup', async (req, reply) => {
    const body = Credentials.extend({ businessName: z.string().min(1).max(200).optional() }).parse(req.body);
    const { user, merchant, cookie } = await ctx.authService.signup({
      ...body,
      countryCode: ctx.config.defaults.country,
      currencyCode: ctx.config.defaults.currency,
    });
    reply.header('set-cookie', cookie).status(201);
    return { user: { id: user.id, email: user.email, role: user.role }, merchant };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = Credentials.parse(req.body);
    const { user, cookie } = await ctx.authService.login(body.email, body.password);
    reply.header('set-cookie', cookie);
    return { user: { id: user.id, email: user.email, role: user.role } };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', clearSessionCookie());
    return { ok: true };
  });

  // Authenticated (guard lets /api/auth/* through, so check explicitly).
  app.get('/api/auth/me', async (req, reply) => {
    const user = (req as any).user ?? null;
    if (!user) {
      const uid = (await import('../core/authn.js')).userIdFromCookieHeader(req.headers.cookie, ctx.config.encKey);
      const u = uid ? await ctx.store.getUser(uid) : null;
      if (!u) return reply.status(401).send({ error: 'not signed in' });
      return { user: { id: u.id, email: u.email, role: u.role } };
    }
    return { user: { id: user.id, email: user.email, role: user.role } };
  });
}
