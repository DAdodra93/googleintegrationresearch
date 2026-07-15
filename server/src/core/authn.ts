import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { signPayload, verifyPayload } from './crypto.js';
import type { Store, User } from './store/types.js';

/**
 * SaaS auth: email+password users with signed-cookie sessions, and
 * tenant authorization (merchant users see only their own merchants;
 * operators see everything). No external dependencies — scrypt for
 * passwords, our HMAC layer for session tokens.
 */

const SESSION_COOKIE = 'gge_session';
const SESSION_TTL_MS = 7 * 24 * 3600_000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt.${salt.toString('base64url')}.${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('.');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSessionCookie(userId: string, key: Buffer): string {
  const token = signPayload({ uid: userId, exp: Date.now() + SESSION_TTL_MS }, key);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function userIdFromCookieHeader(cookieHeader: string | undefined, key: Buffer): string | null {
  if (!cookieHeader) return null;
  const raw = cookieHeader
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const { uid, exp } = verifyPayload<{ uid: string; exp: number }>(raw, key);
    return Date.now() < exp ? uid : null;
  } catch {
    return null;
  }
}

/** Paths reachable without a session. */
export function isPublicPath(url: string): boolean {
  const path = url.split('?')[0];
  if (path.startsWith('/api/auth/')) return true;
  if (path.startsWith('/r/')) return true; // ad-click lead redirects
  if (/^\/auth\/google\/[^/]+\/callback$/.test(path)) return true; // state is HMAC-authenticated
  if (path === '/api/health') return true;
  // Everything that is not API/auth is the static console shell (login screen included).
  return !path.startsWith('/api') && !path.startsWith('/auth');
}

export class AuthzError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class Authz {
  constructor(private store: Store) {}

  user(req: FastifyRequest): User {
    const user = (req as any).user as User | undefined;
    if (!user) throw new AuthzError('authentication required', 401);
    return user;
  }

  requireOperator(req: FastifyRequest): User {
    const user = this.user(req);
    if (user.role !== 'operator') throw new AuthzError('operator role required');
    return user;
  }

  async assertMerchant(req: FastifyRequest, merchantId: string): Promise<User> {
    const user = this.user(req);
    if (user.role === 'operator') return user;
    const allowed = await this.store.listMerchantIdsForUser(user.id);
    if (!allowed.includes(merchantId)) throw new AuthzError('no access to this merchant');
    return user;
  }

  /** 'all' for operators, else the caller's bound merchant IDs. */
  async merchantScope(req: FastifyRequest): Promise<'all' | string[]> {
    const user = this.user(req);
    return user.role === 'operator' ? 'all' : this.store.listMerchantIdsForUser(user.id);
  }
}

export interface AuthDeps {
  store: Store;
  encKey: Buffer;
  operatorEmails: string[];
}

export class AuthService {
  constructor(private deps: AuthDeps) {}

  private async roleFor(email: string): Promise<'operator' | 'merchant'> {
    if (this.deps.operatorEmails.includes(email.toLowerCase())) return 'operator';
    // Bootstrap: the very first account becomes the operator.
    return (await this.deps.store.countUsers()) === 0 ? 'operator' : 'merchant';
  }

  async signup(input: { email: string; password: string; businessName?: string; countryCode: string; currencyCode: string }) {
    const email = input.email.toLowerCase().trim();
    if (input.password.length < 8) throw new AuthzError('password must be at least 8 characters', 400);
    if (await this.deps.store.getUserByEmail(email)) throw new AuthzError('email already registered', 409);
    const user = await this.deps.store.createUser({ email, passwordHash: hashPassword(input.password), role: await this.roleFor(email) });
    let merchant = null;
    if (input.businessName) {
      merchant = await this.deps.store.createMerchant({
        name: input.businessName,
        countryCode: input.countryCode,
        currencyCode: input.currencyCode,
      });
      await this.deps.store.bindUserMerchant(user.id, merchant.id);
    }
    await this.deps.store.audit({ event: 'user.signup', detail: { email, role: user.role } });
    return { user, merchant, cookie: createSessionCookie(user.id, this.deps.encKey) };
  }

  async login(email: string, password: string) {
    const user = await this.deps.store.getUserByEmail(email.toLowerCase().trim());
    if (!user || !verifyPassword(password, user.passwordHash)) throw new AuthzError('invalid email or password', 401);
    return { user, cookie: createSessionCookie(user.id, this.deps.encKey) };
  }
}

export function registerAuthGuard(
  app: { addHook: Function },
  deps: { store: Store; encKey: Buffer },
): void {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(req.url)) return;
    const uid = userIdFromCookieHeader(req.headers.cookie, deps.encKey);
    const user = uid ? await deps.store.getUser(uid) : null;
    if (!user) return reply.status(401).send({ error: 'authentication required' });
    (req as any).user = user;
  });
}
