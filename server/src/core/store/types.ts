export type Module = 'gbp' | 'ads';

export type UserRole = 'operator' | 'merchant';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
}

export interface Merchant {
  id: string;
  name: string;
  countryCode: string;
  currencyCode: string;
  createdAt: string;
}

export interface GoogleConnection {
  id: string;
  merchantId: string;
  module: Module;
  googleEmail: string | null;
  refreshTokenEnc: string;
  scopes: string[];
  status: 'active' | 'revoked' | 'error';
  connectedAt: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface Approval {
  id: string;
  merchantId: string;
  module: Module;
  actionType: string;
  payload: unknown;
  summary: string;
  status: ApprovalStatus;
  proposedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  error: string | null;
  createdAt: string;
}

export type FundingStatus = 'unfunded' | 'pending_manual_billing_setup' | 'funded';

export interface AccountFunding {
  merchantId: string;
  adsCustomerId: string;
  model: 'interim' | 'invoiced';
  status: FundingStatus;
  updatedAt: string;
}

export interface AuditEvent {
  merchantId?: string;
  module?: Module;
  event: string;
  detail?: unknown;
}

export interface Store {
  kind: 'memory' | 'postgres';

  createUser(u: { email: string; passwordHash: string; role: UserRole }): Promise<User>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  countUsers(): Promise<number>;
  bindUserMerchant(userId: string, merchantId: string): Promise<void>;
  listMerchantIdsForUser(userId: string): Promise<string[]>;

  createMerchant(m: { name: string; countryCode: string; currencyCode: string }): Promise<Merchant>;
  listMerchants(): Promise<Merchant[]>;
  getMerchant(id: string): Promise<Merchant | null>;

  upsertConnection(c: {
    merchantId: string;
    module: Module;
    googleEmail: string | null;
    refreshTokenEnc: string;
    scopes: string[];
  }): Promise<GoogleConnection>;
  getConnection(merchantId: string, module: Module): Promise<GoogleConnection | null>;
  getConnectionById(id: string): Promise<GoogleConnection | null>;
  listConnections(merchantId: string): Promise<GoogleConnection[]>;
  setConnectionStatus(id: string, status: GoogleConnection['status']): Promise<void>;
  deleteConnection(id: string): Promise<void>;

  createApproval(a: {
    merchantId: string;
    module: Module;
    actionType: string;
    payload: unknown;
    summary: string;
    proposedBy: string;
  }): Promise<Approval>;
  getApproval(id: string): Promise<Approval | null>;
  listApprovals(filter?: { merchantId?: string; status?: ApprovalStatus }): Promise<Approval[]>;
  updateApproval(
    id: string,
    patch: Partial<Pick<Approval, 'status' | 'decidedBy' | 'decidedAt' | 'executedAt' | 'error'>>,
  ): Promise<Approval>;

  upsertFunding(f: {
    merchantId: string;
    adsCustomerId: string;
    model: AccountFunding['model'];
    status: FundingStatus;
  }): Promise<AccountFunding>;
  getFunding(merchantId: string, adsCustomerId: string): Promise<AccountFunding | null>;

  audit(e: AuditEvent): Promise<void>;
  listAudit(limit?: number): Promise<Array<AuditEvent & { createdAt: string }>>;

  close(): Promise<void>;
}
