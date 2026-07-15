import { randomUUID } from 'node:crypto';
import type {
  AdsAccount,
  AdsCampaign,
  AdsFlow,
  AdType,
  BillingMode,
  Budget,
  CampaignStatus,
  LeadEvent,
  LinkStatus,
  SearchCampaignSpec,
  TcplEvaluation,
} from './types.js';

export interface AdsStore {
  createAccount(a: { merchantId: string; flow: AdsFlow; billingMode: BillingMode; customerId: string | null; linkStatus: LinkStatus }): Promise<AdsAccount>;
  getAccount(id: string): Promise<AdsAccount | null>;
  listAccounts(merchantId: string): Promise<AdsAccount[]>;
  updateAccount(id: string, patch: Partial<Pick<AdsAccount, 'customerId' | 'linkStatus' | 'billingMode'>>): Promise<AdsAccount>;

  createCampaign(c: {
    merchantId: string;
    adsAccountId: string;
    adType: AdType;
    name: string;
    spec: SearchCampaignSpec;
    budget: Budget;
    leadSlug: string | null;
  }): Promise<AdsCampaign>;
  getCampaign(id: string): Promise<AdsCampaign | null>;
  getCampaignBySlug(slug: string): Promise<AdsCampaign | null>;
  listCampaigns(merchantId: string): Promise<AdsCampaign[]>;
  updateCampaign(
    id: string,
    patch: Partial<Pick<AdsCampaign, 'spec' | 'budget' | 'status' | 'googleRefs' | 'name'>>,
  ): Promise<AdsCampaign>;

  recordLead(e: { campaignId: string; destination: string; userAgent?: string }): Promise<void>;
  countLeads(campaignId: string, sinceIso?: string): Promise<number>;

  recordTcplEvaluation(e: Omit<TcplEvaluation, 'createdAt'>): Promise<TcplEvaluation>;
  listTcplEvaluations(campaignId: string, limit?: number): Promise<TcplEvaluation[]>;
}

const now = () => new Date().toISOString();

export class MemoryAdsStore implements AdsStore {
  private accounts = new Map<string, AdsAccount>();
  private campaigns = new Map<string, AdsCampaign>();
  private leads: Array<LeadEvent> = [];
  private evals: TcplEvaluation[] = [];

  async createAccount(a: { merchantId: string; flow: AdsFlow; billingMode: BillingMode; customerId: string | null; linkStatus: LinkStatus }) {
    const acc: AdsAccount = { id: randomUUID(), ...a, createdAt: now(), updatedAt: now() };
    this.accounts.set(acc.id, acc);
    return acc;
  }
  async getAccount(id: string) {
    return this.accounts.get(id) ?? null;
  }
  async listAccounts(merchantId: string) {
    return [...this.accounts.values()].filter((a) => a.merchantId === merchantId);
  }
  async updateAccount(id: string, patch: Partial<AdsAccount>) {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`ads account ${id} not found`);
    const updated = { ...a, ...patch, updatedAt: now() };
    this.accounts.set(id, updated);
    return updated;
  }

  async createCampaign(c: any) {
    const camp: AdsCampaign = { id: randomUUID(), ...c, status: 'draft', googleRefs: null, createdAt: now(), updatedAt: now() };
    this.campaigns.set(camp.id, camp);
    return camp;
  }
  async getCampaign(id: string) {
    return this.campaigns.get(id) ?? null;
  }
  async getCampaignBySlug(slug: string) {
    return [...this.campaigns.values()].find((c) => c.leadSlug === slug) ?? null;
  }
  async listCampaigns(merchantId: string) {
    return [...this.campaigns.values()].filter((c) => c.merchantId === merchantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async updateCampaign(id: string, patch: Partial<AdsCampaign>) {
    const c = this.campaigns.get(id);
    if (!c) throw new Error(`campaign ${id} not found`);
    const updated = { ...c, ...patch, updatedAt: now() };
    this.campaigns.set(id, updated);
    return updated;
  }

  async recordLead(e: { campaignId: string; destination: string; userAgent?: string }) {
    this.leads.push({ ...e, occurredAt: now() });
  }
  async countLeads(campaignId: string, sinceIso?: string) {
    return this.leads.filter((l) => l.campaignId === campaignId && (!sinceIso || l.occurredAt >= sinceIso)).length;
  }

  async recordTcplEvaluation(e: Omit<TcplEvaluation, 'createdAt'>) {
    const rec = { ...e, createdAt: now() };
    this.evals.push(rec);
    return rec;
  }
  async listTcplEvaluations(campaignId: string, limit = 20) {
    return this.evals.filter((x) => x.campaignId === campaignId).slice(-limit).reverse();
  }
}
