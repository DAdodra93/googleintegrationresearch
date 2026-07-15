import { randomUUID } from 'node:crypto';
import type {
  AccountFunding,
  Approval,
  ApprovalStatus,
  AuditEvent,
  GoogleConnection,
  Merchant,
  Module,
  Store,
  User,
  UserRole,
} from './types.js';

const now = () => new Date().toISOString();

/** In-memory store for stub-mode development and tests. Nothing persists. */
export class MemoryStore implements Store {
  kind = 'memory' as const;
  private users = new Map<string, User>();
  private userMerchants = new Map<string, Set<string>>();
  private merchants = new Map<string, Merchant>();
  private connections = new Map<string, GoogleConnection>();
  private approvals = new Map<string, Approval>();
  private funding = new Map<string, AccountFunding>();
  private auditLog: Array<AuditEvent & { createdAt: string }> = [];

  async createUser(u: { email: string; passwordHash: string; role: UserRole }): Promise<User> {
    if ([...this.users.values()].some((x) => x.email === u.email)) throw new Error('email already registered');
    const user: User = { id: randomUUID(), ...u, createdAt: now() };
    this.users.set(user.id, user);
    return user;
  }
  async getUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async getUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async countUsers() {
    return this.users.size;
  }
  async bindUserMerchant(userId: string, merchantId: string) {
    if (!this.userMerchants.has(userId)) this.userMerchants.set(userId, new Set());
    this.userMerchants.get(userId)!.add(merchantId);
  }
  async listMerchantIdsForUser(userId: string) {
    return [...(this.userMerchants.get(userId) ?? [])];
  }

  async createMerchant(m: { name: string; countryCode: string; currencyCode: string }): Promise<Merchant> {
    const merchant: Merchant = { id: randomUUID(), name: m.name, countryCode: m.countryCode, currencyCode: m.currencyCode, createdAt: now() };
    this.merchants.set(merchant.id, merchant);
    return merchant;
  }
  async listMerchants() {
    return [...this.merchants.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async getMerchant(id: string) {
    return this.merchants.get(id) ?? null;
  }

  async upsertConnection(c: {
    merchantId: string;
    module: Module;
    googleEmail: string | null;
    refreshTokenEnc: string;
    scopes: string[];
  }): Promise<GoogleConnection> {
    const existing = [...this.connections.values()].find((x) => x.merchantId === c.merchantId && x.module === c.module);
    const conn: GoogleConnection = {
      id: existing?.id ?? randomUUID(),
      merchantId: c.merchantId,
      module: c.module,
      googleEmail: c.googleEmail,
      refreshTokenEnc: c.refreshTokenEnc,
      scopes: c.scopes,
      status: 'active',
      connectedAt: now(),
    };
    this.connections.set(conn.id, conn);
    return conn;
  }
  async getConnection(merchantId: string, module: Module) {
    return [...this.connections.values()].find((x) => x.merchantId === merchantId && x.module === module) ?? null;
  }
  async getConnectionById(id: string) {
    return this.connections.get(id) ?? null;
  }
  async listConnections(merchantId: string) {
    return [...this.connections.values()].filter((x) => x.merchantId === merchantId);
  }
  async setConnectionStatus(id: string, status: GoogleConnection['status']) {
    const c = this.connections.get(id);
    if (c) this.connections.set(id, { ...c, status });
  }
  async deleteConnection(id: string) {
    this.connections.delete(id);
  }

  async createApproval(a: {
    merchantId: string;
    module: Module;
    actionType: string;
    payload: unknown;
    summary: string;
    proposedBy: string;
  }): Promise<Approval> {
    const approval: Approval = {
      id: randomUUID(),
      ...a,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      executedAt: null,
      error: null,
      createdAt: now(),
    };
    this.approvals.set(approval.id, approval);
    return approval;
  }
  async getApproval(id: string) {
    return this.approvals.get(id) ?? null;
  }
  async listApprovals(filter?: { merchantId?: string; status?: ApprovalStatus }) {
    return [...this.approvals.values()]
      .filter((a) => (filter?.merchantId ? a.merchantId === filter.merchantId : true))
      .filter((a) => (filter?.status ? a.status === filter.status : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async updateApproval(id: string, patch: Partial<Approval>) {
    const a = this.approvals.get(id);
    if (!a) throw new Error(`approval ${id} not found`);
    const updated = { ...a, ...patch };
    this.approvals.set(id, updated);
    return updated;
  }

  async upsertFunding(f: {
    merchantId: string;
    adsCustomerId: string;
    model: AccountFunding['model'];
    status: AccountFunding['status'];
  }): Promise<AccountFunding> {
    const rec: AccountFunding = { ...f, updatedAt: now() };
    this.funding.set(`${f.merchantId}:${f.adsCustomerId}`, rec);
    return rec;
  }
  async getFunding(merchantId: string, adsCustomerId: string) {
    return this.funding.get(`${merchantId}:${adsCustomerId}`) ?? null;
  }

  async audit(e: AuditEvent) {
    this.auditLog.push({ ...e, createdAt: now() });
  }
  async listAudit(limit = 100) {
    return this.auditLog.slice(-limit).reverse();
  }

  async close() {}
}
