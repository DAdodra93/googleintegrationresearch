import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/core/config.js';

export interface AuthedApp {
  inject: (opts: InjectOptions) => ReturnType<FastifyInstance['inject']>;
  raw: FastifyInstance;
  cookie: string;
}

export async function freshApp(env: Record<string, string> = {}) {
  const { app } = await buildApp(loadConfig({ PORT: '0', ...env } as NodeJS.ProcessEnv));
  return app;
}

export async function signup(app: FastifyInstance, email: string, businessName?: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email, password: 'secret-password-123', ...(businessName ? { businessName } : {}) },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  const cookie = (res.headers['set-cookie'] as string).split(';')[0];
  return { cookie, body: res.json() };
}

export function withAuth(app: FastifyInstance, cookie: string): AuthedApp {
  return {
    raw: app,
    cookie,
    inject: (opts: InjectOptions) =>
      app.inject({ ...opts, headers: { ...((opts.headers as object) ?? {}), cookie } }),
  };
}

/** App + signed-in user (first signup → operator role, matching pre-SaaS test behavior). */
export async function authedApp(env: Record<string, string> = {}, email = 'operator@test.dev'): Promise<AuthedApp> {
  const app = await freshApp(env);
  const { cookie } = await signup(app, email);
  return withAuth(app, cookie);
}
