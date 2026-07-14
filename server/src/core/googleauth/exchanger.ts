import { randomUUID } from 'node:crypto';

export interface CodeExchangeResult {
  refreshToken: string;
  accessToken: string;
  expiresInSec: number;
  email: string | null;
}

export interface AccessTokenResult {
  accessToken: string;
  expiresInSec: number;
}

/**
 * The seam between our OAuth flow and Google's token endpoint.
 * RealTokenExchanger talks to oauth2.googleapis.com; StubTokenExchanger lets
 * every flow run end to end before real credentials/quota exist.
 */
export interface TokenExchanger {
  readonly stub: boolean;
  buildAuthUrl(input: { redirectUri: string; scopes: string[]; state: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<CodeExchangeResult>;
  refreshAccessToken(refreshToken: string): Promise<AccessTokenResult>;
}

export class RealTokenExchanger implements TokenExchanger {
  readonly stub = false;
  constructor(private clientId: string, private clientSecret: string) {}

  buildAuthUrl({ redirectUri, scopes, state }: { redirectUri: string; scopes: string[]; state: string }): string {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', this.clientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', scopes.join(' '));
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent'); // always mint a refresh token
    u.searchParams.set('state', state);
    return u.toString();
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<CodeExchangeResult> {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      refresh_token?: string;
      access_token: string;
      expires_in: number;
      id_token?: string;
    };
    if (!json.refresh_token) throw new Error('Google did not return a refresh token (re-consent required)');
    return {
      refreshToken: json.refresh_token,
      accessToken: json.access_token,
      expiresInSec: json.expires_in,
      email: json.id_token ? emailFromIdToken(json.id_token) : null,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<AccessTokenResult> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    return { accessToken: json.access_token, expiresInSec: json.expires_in };
  }
}

/** Display-only claim read; the token came directly from Google over TLS. */
function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

export class StubTokenExchanger implements TokenExchanger {
  readonly stub = true;

  /** Skips Google entirely: "consent" bounces straight back to our callback. */
  buildAuthUrl({ redirectUri, state }: { redirectUri: string; scopes: string[]; state: string }): string {
    const u = new URL(redirectUri);
    u.searchParams.set('code', `stub-code-${randomUUID()}`);
    u.searchParams.set('state', state);
    return u.toString();
  }

  async exchangeCode(): Promise<CodeExchangeResult> {
    return {
      refreshToken: `stub-refresh-${randomUUID()}`,
      accessToken: `stub-access-${randomUUID()}`,
      expiresInSec: 3600,
      email: 'stub-merchant@example.com',
    };
  }

  async refreshAccessToken(): Promise<AccessTokenResult> {
    return { accessToken: `stub-access-${randomUUID()}`, expiresInSec: 3600 };
  }
}
