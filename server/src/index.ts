import { loadConfig } from './core/config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const { app, ctx } = await buildApp(config);

if (ctx.config.encKeyIsEphemeral) {
  app.log.warn('TOKEN_ENC_KEY not set — using an EPHEMERAL key; stored tokens will not survive a restart');
}
if (ctx.store.kind === 'memory') {
  app.log.warn('DATABASE_URL not set — using in-memory store (stub development only)');
}
if (ctx.config.google.stub) {
  app.log.warn('GOOGLE STUB MODE — OAuth flows run against the stub exchanger, no real Google calls');
}

await app.listen({ port: config.port, host: '0.0.0.0' });
