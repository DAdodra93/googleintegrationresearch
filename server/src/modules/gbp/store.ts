import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { GbpFlow, GbpProfile, GbpProfileStatus } from './types.js';

export interface GbpStore {
  createProfile(p: {
    merchantId: string;
    flow: GbpFlow;
    accountName: string | null;
    locationName: string | null;
    title: string;
    status: GbpProfileStatus;
    prefill?: Record<string, unknown> | null;
  }): Promise<GbpProfile>;
  getProfile(id: string): Promise<GbpProfile | null>;
  listProfiles(merchantId: string): Promise<GbpProfile[]>;
  updateProfile(
    id: string,
    patch: Partial<Pick<GbpProfile, 'accountName' | 'locationName' | 'title' | 'status' | 'prefill' | 'verification'>>,
  ): Promise<GbpProfile>;
}

const now = () => new Date().toISOString();

export class MemoryGbpStore implements GbpStore {
  private profiles = new Map<string, GbpProfile>();

  async createProfile(p: any) {
    const profile: GbpProfile = {
      id: randomUUID(),
      merchantId: p.merchantId,
      flow: p.flow,
      accountName: p.accountName,
      locationName: p.locationName,
      title: p.title,
      status: p.status,
      prefill: p.prefill ?? null,
      verification: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }
  async getProfile(id: string) {
    return this.profiles.get(id) ?? null;
  }
  async listProfiles(merchantId: string) {
    return [...this.profiles.values()].filter((p) => p.merchantId === merchantId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async updateProfile(id: string, patch: any) {
    const p = this.profiles.get(id);
    if (!p) throw new Error(`gbp profile ${id} not found`);
    const updated = { ...p, ...patch, updatedAt: now() };
    this.profiles.set(id, updated);
    return updated;
  }
}

const { Pool } = pg;

function row(r: any): GbpProfile {
  return {
    id: r.id, merchantId: r.merchant_id, flow: r.flow, accountName: r.account_name, locationName: r.location_name,
    title: r.title, status: r.status, prefill: r.prefill, verification: r.verification,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

export class PgGbpStore implements GbpStore {
  private pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async createProfile(p: any) {
    const { rows } = await this.pool.query(
      `insert into gbp_profiles (merchant_id, flow, account_name, location_name, title, status, prefill)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [p.merchantId, p.flow, p.accountName, p.locationName, p.title, p.status, p.prefill ? JSON.stringify(p.prefill) : null],
    );
    return row(rows[0]);
  }
  async getProfile(id: string) {
    const { rows } = await this.pool.query('select * from gbp_profiles where id = $1', [id]);
    return rows[0] ? row(rows[0]) : null;
  }
  async listProfiles(merchantId: string) {
    const { rows } = await this.pool.query('select * from gbp_profiles where merchant_id = $1 order by created_at', [merchantId]);
    return rows.map(row);
  }
  async updateProfile(id: string, patch: any) {
    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [id];
    const jsonCols = new Set(['prefill', 'verification']);
    const map: Record<string, string> = {
      accountName: 'account_name', locationName: 'location_name', title: 'title', status: 'status',
      prefill: 'prefill', verification: 'verification',
    };
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        params.push(jsonCols.has(k) && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const { rows } = await this.pool.query(`update gbp_profiles set ${sets.join(', ')} where id = $1 returning *`, params);
    if (!rows[0]) throw new Error(`gbp profile ${id} not found`);
    return row(rows[0]);
  }
}
