import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from './core/config.js';
import { createAiProvider, type AiProvider } from './core/ai/index.js';
import { createBillingProvider, type BillingProvider } from './core/billing/index.js';
import { ApprovalService } from './core/approvals/service.js';
import { GoogleAuthService } from './core/googleauth/service.js';
import { RealTokenExchanger, StubTokenExchanger } from './core/googleauth/exchanger.js';
import { MemoryStore } from './core/store/memory.js';
import { PgStore } from './core/store/pg.js';
import type { Store } from './core/store/types.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerMerchantRoutes } from './routes/merchants.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerDevRoutes } from './routes/dev.js';

export interface AppContext {
  config: AppConfig;
  store: Store;
  ai: AiProvider;
  billing: BillingProvider;
  approvals: ApprovalService;
  googleAuth: GoogleAuthService;
}

export async function createStore(config: AppConfig): Promise<Store> {
  if (!config.databaseUrl) return new MemoryStore();
  const store = new PgStore(config.databaseUrl);
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  await store.migrate(migrationsDir);
  return store;
}

export async function buildApp(config: AppConfig, storeOverride?: Store): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const store = storeOverride ?? (await createStore(config));
  const exchanger =
    config.google.stub || !config.google.clientId || !config.google.clientSecret
      ? new StubTokenExchanger()
      : new RealTokenExchanger(config.google.clientId, config.google.clientSecret);

  const ctx: AppContext = {
    config,
    store,
    ai: createAiProvider(config),
    billing: createBillingProvider(config, store),
    approvals: new ApprovalService(store),
    googleAuth: new GoogleAuthService({ store, exchanger, encKey: config.encKey, publicBaseUrl: config.publicBaseUrl }),
  };

  // Phase 1 demo executor: exercises the propose→approve→execute pipeline end
  // to end. Phase 2/3 modules register real executors (publish post, reply to
  // review, launch campaign, ...) exactly like this.
  ctx.approvals.registerExecutor('demo.echo', async (approval) => {
    await store.audit({
      merchantId: approval.merchantId,
      module: approval.module,
      event: 'demo.echo.executed',
      detail: approval.payload,
    });
  });

  const app = Fastify({ logger: { level: 'info' } });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    app.log.error(err);
    reply.status(err.statusCode && err.statusCode >= 400 ? err.statusCode : 500).send({ error: err.message });
  });

  registerSystemRoutes(app, ctx);
  registerMerchantRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerApprovalRoutes(app, ctx);
  registerDevRoutes(app, ctx);

  // Serve the built console when present (console/dist); dev uses Vite's proxy.
  const consoleDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'console', 'dist');
  if (existsSync(consoleDist)) {
    await app.register(fastifyStatic, { root: consoleDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/auth')) {
        return reply.sendFile('index.html');
      }
      reply.status(404).send({ error: 'not found' });
    });
  }

  return { app, ctx };
}
