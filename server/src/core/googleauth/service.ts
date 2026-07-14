import { randomUUID } from 'node:crypto';
import { decryptSecret, encryptSecret, signPayload, verifyPayload } from '../crypto.js';
import type { Module, Store } from '../store/types.js';
import { MODULE_SCOPES } from './scopes.js';
import type { TokenExchanger } from './exchanger.js';

interface OAuthState {
  merchantId: string;
  module: Module;
  nonce: string;
  exp: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Shared OAuth plumbing. Modules stay independent: each merchant×module pair
 * has its own connection, scopes, and encrypted refresh token.
 */
export class GoogleAuthService {
  private accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private deps: {
      store: Store;
      exchanger: TokenExchanger;
      encKey: Buffer;
      publicBaseUrl: string;
    },
  ) {}

  redirectUri(module: Module): string {
    return `${this.deps.publicBaseUrl}/auth/google/${module}/callback`;
  }

  async startConnect(merchantId: string, module: Module): Promise<string> {
    const merchant = await this.deps.store.getMerchant(merchantId);
    if (!merchant) throw new Error(`merchant ${merchantId} not found`);
    const state = signPayload(
      { merchantId, module, nonce: randomUUID(), exp: Date.now() + STATE_TTL_MS } satisfies OAuthState,
      this.deps.encKey,
    );
    return this.deps.exchanger.buildAuthUrl({
      redirectUri: this.redirectUri(module),
      scopes: MODULE_SCOPES[module],
      state,
    });
  }

  async handleCallback(module: Module, query: { code?: string; state?: string; error?: string }) {
    if (query.error) throw new Error(`Google returned error: ${query.error}`);
    if (!query.code || !query.state) throw new Error('missing code/state');
    const state = verifyPayload<OAuthState>(query.state, this.deps.encKey);
    if (state.module !== module) throw new Error('state/module mismatch');
    if (Date.now() > state.exp) throw new Error('state expired — restart the connect flow');

    const result = await this.deps.exchanger.exchangeCode({
      code: query.code,
      redirectUri: this.redirectUri(module),
    });
    const conn = await this.deps.store.upsertConnection({
      merchantId: state.merchantId,
      module,
      googleEmail: result.email,
      refreshTokenEnc: encryptSecret(result.refreshToken, this.deps.encKey),
      scopes: MODULE_SCOPES[module],
    });
    await this.deps.store.audit({
      merchantId: state.merchantId,
      module,
      event: 'google.connected',
      detail: { email: result.email, stub: this.deps.exchanger.stub },
    });
    return conn;
  }

  /** What Phase 2/3 module clients call to authenticate every Google API request. */
  async getAccessToken(merchantId: string, module: Module): Promise<string> {
    const cacheKey = `${merchantId}:${module}`;
    const cached = this.accessTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const conn = await this.deps.store.getConnection(merchantId, module);
    if (!conn || conn.status !== 'active') throw new Error(`no active ${module} connection for merchant ${merchantId}`);
    const refreshToken = decryptSecret(conn.refreshTokenEnc, this.deps.encKey);
    try {
      const { accessToken, expiresInSec } = await this.deps.exchanger.refreshAccessToken(refreshToken);
      this.accessTokenCache.set(cacheKey, { token: accessToken, expiresAt: Date.now() + expiresInSec * 1000 });
      return accessToken;
    } catch (err) {
      await this.deps.store.setConnectionStatus(conn.id, 'error');
      await this.deps.store.audit({ merchantId, module, event: 'google.token_refresh_failed', detail: { message: String(err) } });
      throw err;
    }
  }
}
