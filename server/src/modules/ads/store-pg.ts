import pg from 'pg';
import type { AdsStore } from './store.js';
import type { AdsAccount, AdsCampaign, TcplEvaluation } from './types.js';

const { Pool } = pg;

function accountRow(r: any): AdsAccount {
  return {
    id: r.id, merchantId: r.merchant_id, flow: r.flow, billingMode: r.billing_mode, customerId: r.customer_id,
    linkStatus: r.link_status, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}
function campaignRow(r: any): AdsCampaign {
  return {
    id: r.id, merchantId: r.merchant_id, adsAccountId: r.ads_account_id, adType: r.ad_type, name: r.name,
    spec: r.spec, budget: r.budget, leadSlug: r.lead_slug, status: r.status, googleRefs: r.google_refs,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

export class PgAdsStore implements AdsStore {
  private pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async createAccount(a: any) {
    const { rows } = await this.pool.query(
      `insert into ads_accounts (merchant_id, flow, billing_mode, customer_id, link_status)
       values ($1,$2,$3,$4,$5) returning *`,
      [a.merchantId, a.flow, a.billingMode, a.customerId, a.linkStatus],
    );
    return accountRow(rows[0]);
  }
  async getAccount(id: string) {
    const { rows } = await this.pool.query('select * from ads_accounts where id = $1', [id]);
    return rows[0] ? accountRow(rows[0]) : null;
  }
  async listAccounts(merchantId: string) {
    const { rows } = await this.pool.query('select * from ads_accounts where merchant_id = $1 order by created_at', [merchantId]);
    return rows.map(accountRow);
  }
  async updateAccount(id: string, patch: any) {
    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [id];
    const map: Record<string, string> = { customerId: 'customer_id', linkStatus: 'link_status', billingMode: 'billing_mode' };
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        params.push(patch[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const { rows } = await this.pool.query(`update ads_accounts set ${sets.join(', ')} where id = $1 returning *`, params);
    if (!rows[0]) throw new Error(`ads account ${id} not found`);
    return accountRow(rows[0]);
  }

  async createCampaign(c: any) {
    const { rows } = await this.pool.query(
      `insert into ads_campaigns (merchant_id, ads_account_id, ad_type, name, spec, budget, lead_slug)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [c.merchantId, c.adsAccountId, c.adType, c.name, JSON.stringify(c.spec), JSON.stringify(c.budget), c.leadSlug],
    );
    return campaignRow(rows[0]);
  }
  async getCampaign(id: string) {
    const { rows } = await this.pool.query('select * from ads_campaigns where id = $1', [id]);
    return rows[0] ? campaignRow(rows[0]) : null;
  }
  async getCampaignBySlug(slug: string) {
    const { rows } = await this.pool.query('select * from ads_campaigns where lead_slug = $1', [slug]);
    return rows[0] ? campaignRow(rows[0]) : null;
  }
  async listCampaigns(merchantId: string) {
    const { rows } = await this.pool.query('select * from ads_campaigns where merchant_id = $1 order by created_at desc', [merchantId]);
    return rows.map(campaignRow);
  }
  async updateCampaign(id: string, patch: any) {
    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [id];
    const jsonCols = new Set(['spec', 'budget', 'googleRefs']);
    const map: Record<string, string> = { spec: 'spec', budget: 'budget', status: 'status', googleRefs: 'google_refs', name: 'name' };
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        params.push(jsonCols.has(k) ? JSON.stringify(patch[k]) : patch[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const { rows } = await this.pool.query(`update ads_campaigns set ${sets.join(', ')} where id = $1 returning *`, params);
    if (!rows[0]) throw new Error(`campaign ${id} not found`);
    return campaignRow(rows[0]);
  }

  async recordLead(e: { campaignId: string; destination: string; userAgent?: string }) {
    await this.pool.query('insert into ads_lead_events (campaign_id, destination, user_agent) values ($1,$2,$3)', [
      e.campaignId, e.destination, e.userAgent ?? null,
    ]);
  }
  async countLeads(campaignId: string, sinceIso?: string) {
    const { rows } = await this.pool.query(
      `select count(*)::int as n from ads_lead_events where campaign_id = $1 ${sinceIso ? 'and occurred_at >= $2' : ''}`,
      sinceIso ? [campaignId, sinceIso] : [campaignId],
    );
    return rows[0].n as number;
  }

  async recordTcplEvaluation(e: Omit<TcplEvaluation, 'createdAt'>) {
    const { rows } = await this.pool.query(
      `insert into ads_tcpl_evaluations (campaign_id, window_days, spend, leads, cost_per_lead, decision, detail)
       values ($1,$2,$3,$4,$5,$6,$7) returning created_at`,
      [e.campaignId, e.windowDays, e.spend, e.leads, e.costPerLead, e.decision, JSON.stringify(e.detail)],
    );
    return { ...e, createdAt: rows[0].created_at.toISOString() };
  }
  async listTcplEvaluations(campaignId: string, limit = 20) {
    const { rows } = await this.pool.query(
      'select * from ads_tcpl_evaluations where campaign_id = $1 order by id desc limit $2',
      [campaignId, limit],
    );
    return rows.map((r: any) => ({
      campaignId: r.campaign_id, windowDays: r.window_days, spend: Number(r.spend), leads: r.leads,
      costPerLead: r.cost_per_lead === null ? null : Number(r.cost_per_lead), decision: r.decision,
      detail: r.detail, createdAt: r.created_at.toISOString(),
    }));
  }
}
