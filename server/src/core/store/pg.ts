import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type {
  AccountFunding,
  Approval,
  ApprovalStatus,
  AuditEvent,
  GoogleConnection,
  Merchant,
  Module,
  Store,
} from './types.js';

const { Pool } = pg;

function merchantRow(r: any): Merchant {
  return { id: r.id, name: r.name, countryCode: r.country_code, currencyCode: r.currency_code, createdAt: r.created_at.toISOString() };
}
function connRow(r: any): GoogleConnection {
  return {
    id: r.id, merchantId: r.merchant_id, module: r.module, googleEmail: r.google_email,
    refreshTokenEnc: r.refresh_token_enc, scopes: r.scopes, status: r.status, connectedAt: r.connected_at.toISOString(),
  };
}
function approvalRow(r: any): Approval {
  return {
    id: r.id, merchantId: r.merchant_id, module: r.module, actionType: r.action_type, payload: r.payload,
    summary: r.summary, status: r.status, proposedBy: r.proposed_by, decidedBy: r.decided_by,
    decidedAt: r.decided_at?.toISOString() ?? null, executedAt: r.executed_at?.toISOString() ?? null,
    error: r.error, createdAt: r.created_at.toISOString(),
  };
}

export class PgStore implements Store {
  kind = 'postgres' as const;
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  /** Apply migrations/*.sql in filename order, tracked in schema_migrations. */
  async migrate(migrationsDir: string): Promise<string[]> {
    await this.pool.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const f of files) {
      const { rowCount } = await this.pool.query('select 1 from schema_migrations where name = $1', [f]);
      if (rowCount) continue;
      const sql = await readFile(join(migrationsDir, f), 'utf8');
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [f]);
        await client.query('commit');
        applied.push(f);
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    }
    return applied;
  }

  async createMerchant(m: { name: string; countryCode: string; currencyCode: string }) {
    const { rows } = await this.pool.query(
      'insert into merchants (name, country_code, currency_code) values ($1,$2,$3) returning *',
      [m.name, m.countryCode, m.currencyCode],
    );
    return merchantRow(rows[0]);
  }
  async listMerchants() {
    const { rows } = await this.pool.query('select * from merchants order by created_at');
    return rows.map(merchantRow);
  }
  async getMerchant(id: string) {
    const { rows } = await this.pool.query('select * from merchants where id = $1', [id]);
    return rows[0] ? merchantRow(rows[0]) : null;
  }

  async upsertConnection(c: {
    merchantId: string;
    module: Module;
    googleEmail: string | null;
    refreshTokenEnc: string;
    scopes: string[];
  }) {
    const { rows } = await this.pool.query(
      `insert into google_connections (merchant_id, module, google_email, refresh_token_enc, scopes)
       values ($1,$2,$3,$4,$5)
       on conflict (merchant_id, module) do update set
         google_email = excluded.google_email,
         refresh_token_enc = excluded.refresh_token_enc,
         scopes = excluded.scopes,
         status = 'active',
         connected_at = now()
       returning *`,
      [c.merchantId, c.module, c.googleEmail, c.refreshTokenEnc, c.scopes],
    );
    return connRow(rows[0]);
  }
  async getConnection(merchantId: string, module: Module) {
    const { rows } = await this.pool.query(
      'select * from google_connections where merchant_id = $1 and module = $2',
      [merchantId, module],
    );
    return rows[0] ? connRow(rows[0]) : null;
  }
  async listConnections(merchantId: string) {
    const { rows } = await this.pool.query('select * from google_connections where merchant_id = $1', [merchantId]);
    return rows.map(connRow);
  }
  async setConnectionStatus(id: string, status: GoogleConnection['status']) {
    await this.pool.query('update google_connections set status = $2 where id = $1', [id, status]);
  }
  async deleteConnection(id: string) {
    await this.pool.query('delete from google_connections where id = $1', [id]);
  }

  async createApproval(a: {
    merchantId: string;
    module: Module;
    actionType: string;
    payload: unknown;
    summary: string;
    proposedBy: string;
  }) {
    const { rows } = await this.pool.query(
      `insert into approvals (merchant_id, module, action_type, payload, summary, proposed_by)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [a.merchantId, a.module, a.actionType, JSON.stringify(a.payload), a.summary, a.proposedBy],
    );
    return approvalRow(rows[0]);
  }
  async getApproval(id: string) {
    const { rows } = await this.pool.query('select * from approvals where id = $1', [id]);
    return rows[0] ? approvalRow(rows[0]) : null;
  }
  async listApprovals(filter?: { merchantId?: string; status?: ApprovalStatus }) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.merchantId) {
      params.push(filter.merchantId);
      clauses.push(`merchant_id = $${params.length}`);
    }
    if (filter?.status) {
      params.push(filter.status);
      clauses.push(`status = $${params.length}`);
    }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const { rows } = await this.pool.query(`select * from approvals ${where} order by created_at desc limit 200`, params);
    return rows.map(approvalRow);
  }
  async updateApproval(id: string, patch: Partial<Approval>) {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const map: Record<string, string> = {
      status: 'status', decidedBy: 'decided_by', decidedAt: 'decided_at', executedAt: 'executed_at', error: 'error',
    };
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        params.push((patch as any)[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const { rows } = await this.pool.query(`update approvals set ${sets.join(', ')} where id = $1 returning *`, params);
    if (!rows[0]) throw new Error(`approval ${id} not found`);
    return approvalRow(rows[0]);
  }

  async upsertFunding(f: {
    merchantId: string;
    adsCustomerId: string;
    model: AccountFunding['model'];
    status: AccountFunding['status'];
  }) {
    const { rows } = await this.pool.query(
      `insert into account_funding (merchant_id, ads_customer_id, model, status)
       values ($1,$2,$3,$4)
       on conflict (merchant_id, ads_customer_id) do update set model = excluded.model, status = excluded.status, updated_at = now()
       returning *`,
      [f.merchantId, f.adsCustomerId, f.model, f.status],
    );
    const r = rows[0];
    return { merchantId: r.merchant_id, adsCustomerId: r.ads_customer_id, model: r.model, status: r.status, updatedAt: r.updated_at.toISOString() };
  }
  async getFunding(merchantId: string, adsCustomerId: string) {
    const { rows } = await this.pool.query(
      'select * from account_funding where merchant_id = $1 and ads_customer_id = $2',
      [merchantId, adsCustomerId],
    );
    const r = rows[0];
    return r ? { merchantId: r.merchant_id, adsCustomerId: r.ads_customer_id, model: r.model, status: r.status, updatedAt: r.updated_at.toISOString() } : null;
  }

  async audit(e: AuditEvent) {
    await this.pool.query(
      'insert into audit_log (merchant_id, module, event, detail) values ($1,$2,$3,$4)',
      [e.merchantId ?? null, e.module ?? null, e.event, e.detail ? JSON.stringify(e.detail) : null],
    );
  }
  async listAudit(limit = 100) {
    const { rows } = await this.pool.query('select * from audit_log order by id desc limit $1', [limit]);
    return rows.map((r: any) => ({
      merchantId: r.merchant_id ?? undefined, module: r.module ?? undefined, event: r.event,
      detail: r.detail ?? undefined, createdAt: r.created_at.toISOString(),
    }));
  }

  async close() {
    await this.pool.end();
  }
}
