import { randomBytes } from 'node:crypto';
import type { AppContext } from '../../app.js';
import type { AdsGateway } from './gateway.js';
import type { AdsStore } from './store.js';
import {
  IMPLEMENTED_AD_TYPES,
  SearchCampaignSpecSchema,
  type AdsAccount,
  type AdsCampaign,
  type BillingMode,
  type Budget,
  type CampaignInsights,
  type LeadDestination,
  type SearchCampaignSpec,
  type TcplDecision,
} from './types.js';

const isoDaysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
const dateDaysAgo = (d: number) => isoDaysAgo(d).slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Resolve a lead destination to the actual deep link (used by /r/:slug and S3). */
export function destinationDeepLink(d: LeadDestination): string {
  if (d.channel === 'whatsapp') {
    const text = d.prefillText ? `?text=${encodeURIComponent(d.prefillText)}` : '';
    return `https://wa.me/${d.whatsappNumber}${text}`;
  }
  return `https://ig.me/m/${d.igUsername}`;
}

export class AdsService {
  constructor(
    private ctx: AppContext,
    private ads: AdsStore,
    private gateway: AdsGateway,
  ) {}

  get gatewayIsStub() {
    return this.gateway.stub;
  }

  // ─── Accounts ─────────────────────────────────────────────────────────────

  /**
   * Flow A: existing account. Linking is an external action → approval-gated.
   * Flow B: provisioning under our MCC → approval-gated (spends our money).
   */
  async setupAccount(input: { merchantId: string; flow: 'existing_linked' | 'provisioned'; billingMode: BillingMode; customerId?: string; name?: string }) {
    if (input.flow === 'existing_linked' && !input.customerId) throw new Error('customerId required to link an existing account');
    if (input.flow === 'existing_linked' && input.billingMode === 'we_pay_provisioned') throw new Error('we_pay_provisioned applies to provisioned accounts');
    if (input.flow === 'provisioned' && input.billingMode !== 'we_pay_provisioned') throw new Error('provisioned accounts use we_pay_provisioned billing');

    const account = await this.ads.createAccount({
      merchantId: input.merchantId,
      flow: input.flow,
      billingMode: input.billingMode,
      customerId: input.customerId ?? null,
      linkStatus: input.flow === 'existing_linked' ? 'link_proposed' : 'provision_proposed',
    });

    const approval = await this.ctx.approvals.propose({
      merchantId: input.merchantId,
      module: 'ads',
      actionType: input.flow === 'existing_linked' ? 'ads.account.link' : 'ads.account.provision',
      payload: { adsAccountId: account.id, customerId: input.customerId ?? null, name: input.name ?? null, billingMode: input.billingMode },
      summary:
        input.flow === 'existing_linked'
          ? `Send MCC link invitation to existing Google Ads account ${input.customerId} (billing: ${input.billingMode})`
          : `Provision NEW Google Ads account "${input.name ?? 'merchant account'}" under our MCC, funded by us (interim)`,
      proposedBy: 'operator',
    });
    return { account, approval };
  }

  /** Executor: ads.account.link */
  async executeLink(payload: { adsAccountId: string; customerId: string }) {
    await this.gateway.inviteLink(payload.customerId);
    await this.ads.updateAccount(payload.adsAccountId, { linkStatus: 'invited' });
  }

  /** Executor: ads.account.provision */
  async executeProvision(payload: { adsAccountId: string; name: string | null }) {
    const account = await this.ads.getAccount(payload.adsAccountId);
    if (!account) throw new Error('ads account not found');
    const merchant = await this.ctx.store.getMerchant(account.merchantId);
    const { customerId } = await this.gateway.createCustomerClient({
      name: payload.name ?? merchant?.name ?? 'merchant account',
      currencyCode: merchant?.currencyCode ?? 'INR',
      countryCode: merchant?.countryCode ?? 'IN',
    });
    await this.ads.updateAccount(payload.adsAccountId, { customerId, linkStatus: 'active' });
    // Interim billing: account exists but cannot spend until the manual
    // Ads-UI payments-profile step is done — tracked as an explicit state.
    await this.ctx.billing.ensureAccountFunding({ merchantId: account.merchantId, adsCustomerId: customerId });
  }

  /** Poll link status (Flow A) and refresh funding state. */
  async refreshAccount(id: string): Promise<AdsAccount & { funding: string | null }> {
    let account = await this.ads.getAccount(id);
    if (!account) throw new Error('ads account not found');
    const invitedCustomerId = account.linkStatus === 'invited' ? account.customerId : null;
    if (invitedCustomerId) {
      const status = await this.gateway.getLinkStatus(invitedCustomerId);
      if (status === 'active') {
        account = await this.ads.updateAccount(id, { linkStatus: 'active' });
        if (account.billingMode !== 'manage_only') {
          await this.ctx.billing.ensureAccountFunding({ merchantId: account.merchantId, adsCustomerId: invitedCustomerId });
        }
      }
    }
    const customerId = account.customerId;
    const funding =
      customerId && account.billingMode !== 'manage_only'
        ? await this.ctx.billing.getFundingStatus({ merchantId: account.merchantId, adsCustomerId: customerId })
        : null;
    return { ...account, funding };
  }

  async listAccounts(merchantId: string) {
    const accounts = await this.ads.listAccounts(merchantId);
    return Promise.all(accounts.map((a) => this.refreshAccount(a.id)));
  }

  /** Flow A context read: what already exists in the linked account. */
  async accountStructure(id: string) {
    const account = await this.ads.getAccount(id);
    if (!account?.customerId) throw new Error('account has no customerId yet');
    return this.gateway.listCampaigns(account.customerId);
  }

  // ─── Campaigns ────────────────────────────────────────────────────────────

  async createDraft(input: {
    merchantId: string;
    adsAccountId: string;
    adType: string;
    name: string;
    spec: unknown;
    budget: Budget;
  }): Promise<AdsCampaign> {
    if (!IMPLEMENTED_AD_TYPES.includes(input.adType as any)) {
      throw new Error(`ad type "${input.adType}" is a reserved future slot; implemented: ${IMPLEMENTED_AD_TYPES.join(', ')}`);
    }
    const spec = SearchCampaignSpecSchema.parse(input.spec);
    const leadSlug = spec.leadDestination.strategy === 's1_redirect' ? randomBytes(5).toString('hex') : null;
    return this.ads.createCampaign({
      merchantId: input.merchantId,
      adsAccountId: input.adsAccountId,
      adType: input.adType as any,
      name: input.name,
      spec,
      budget: input.budget,
      leadSlug,
    });
  }

  /** The final URL Google sends clicks to (S1: our tracked redirect; S3: direct deep link). */
  finalUrl(campaign: AdsCampaign): string {
    if (campaign.spec.leadDestination.strategy === 's1_redirect' && campaign.leadSlug) {
      return `${this.ctx.config.publicBaseUrl}/r/${campaign.leadSlug}`;
    }
    return destinationDeepLink(campaign.spec.leadDestination);
  }

  async proposeLaunch(campaignId: string) {
    const campaign = await this.ads.getCampaign(campaignId);
    if (!campaign) throw new Error('campaign not found');
    if (campaign.status !== 'draft') throw new Error(`campaign is ${campaign.status}, expected draft`);
    const account = await this.ads.getAccount(campaign.adsAccountId);
    if (!account?.customerId || account.linkStatus !== 'active') throw new Error('ads account is not active yet');
    if (account.billingMode !== 'manage_only') {
      const funding = await this.ctx.billing.getFundingStatus({ merchantId: campaign.merchantId, adsCustomerId: account.customerId });
      if (funding !== 'funded') {
        throw new Error(`account ${account.customerId} funding is "${funding}" — complete the billing step before launching (interim model)`);
      }
    }
    const approval = await this.ctx.approvals.propose({
      merchantId: campaign.merchantId,
      module: 'ads',
      actionType: 'ads.campaign.launch',
      payload: { campaignId },
      summary: `LAUNCH "${campaign.name}" — ${campaign.budget.currency} ${campaign.budget.dailyAmount}/day (ceiling ${campaign.budget.hardDailyCeiling}, monthly cap ${campaign.budget.monthlyCap}), target CPL ${campaign.budget.targetCostPerLead}, → ${destinationDeepLink(campaign.spec.leadDestination)}`,
      proposedBy: 'operator',
    });
    await this.ads.updateCampaign(campaignId, { status: 'launch_proposed' });
    return approval;
  }

  /** Executor: ads.campaign.launch */
  async executeLaunch(payload: { campaignId: string }) {
    const campaign = await this.ads.getCampaign(payload.campaignId);
    if (!campaign) throw new Error('campaign not found');
    const account = await this.ads.getAccount(campaign.adsAccountId);
    if (!account?.customerId) throw new Error('ads account has no customerId');
    const { refs } = await this.gateway.launchSearchCampaign({
      customerId: account.customerId,
      name: campaign.name,
      spec: campaign.spec,
      budget: campaign.budget,
      finalUrl: this.finalUrl(campaign),
    });
    await this.ads.updateCampaign(campaign.id, { status: 'launched', googleRefs: refs });
  }

  async proposeEdit(campaignId: string, edit: { action: 'pause' | 'resume' | 'set_daily_budget'; dailyAmount?: number }, proposedBy = 'operator') {
    const campaign = await this.ads.getCampaign(campaignId);
    if (!campaign) throw new Error('campaign not found');
    if (!['launched', 'paused'].includes(campaign.status)) throw new Error(`campaign is ${campaign.status}`);
    if (edit.action === 'set_daily_budget') {
      if (!edit.dailyAmount || edit.dailyAmount <= 0) throw new Error('dailyAmount required');
      if (edit.dailyAmount > campaign.budget.hardDailyCeiling) {
        throw new Error(`refused: ${edit.dailyAmount} exceeds the hard daily ceiling ${campaign.budget.hardDailyCeiling}`);
      }
    }
    return this.ctx.approvals.propose({
      merchantId: campaign.merchantId,
      module: 'ads',
      actionType: 'ads.campaign.edit',
      payload: { campaignId, ...edit },
      summary:
        edit.action === 'set_daily_budget'
          ? `Change "${campaign.name}" daily budget ${campaign.budget.dailyAmount} → ${edit.dailyAmount} ${campaign.budget.currency}`
          : `${edit.action.toUpperCase()} campaign "${campaign.name}"`,
      proposedBy,
    });
  }

  /** Executor: ads.campaign.edit */
  async executeEdit(payload: { campaignId: string; action: 'pause' | 'resume' | 'set_daily_budget'; dailyAmount?: number }) {
    const campaign = await this.ads.getCampaign(payload.campaignId);
    if (!campaign?.googleRefs) throw new Error('campaign not launched');
    const account = await this.ads.getAccount(campaign.adsAccountId);
    if (!account?.customerId) throw new Error('no customerId');
    if (payload.action === 'set_daily_budget') {
      if (!payload.dailyAmount || payload.dailyAmount > campaign.budget.hardDailyCeiling) throw new Error('budget exceeds hard ceiling');
      await this.gateway.updateCampaignDailyBudget(account.customerId, campaign.googleRefs.campaignBudget, payload.dailyAmount);
      await this.ads.updateCampaign(campaign.id, { budget: { ...campaign.budget, dailyAmount: payload.dailyAmount } });
    } else {
      await this.gateway.setCampaignStatus(account.customerId, campaign.googleRefs.campaign, payload.action === 'pause' ? 'PAUSED' : 'ENABLED');
      await this.ads.updateCampaign(campaign.id, { status: payload.action === 'pause' ? 'paused' : 'launched' });
    }
  }

  // ─── Leads (S1 tracked redirect) ─────────────────────────────────────────

  /** GET /r/:slug — log the lead, then redirect to the merchant's chat. */
  async handleLeadRedirect(slug: string, userAgent?: string): Promise<string | null> {
    const campaign = await this.ads.getCampaignBySlug(slug);
    if (!campaign) return null;
    const destination = destinationDeepLink(campaign.spec.leadDestination);
    await this.ads.recordLead({ campaignId: campaign.id, destination, userAgent });
    return destination;
  }

  // ─── Insights & TCPL ─────────────────────────────────────────────────────

  async insights(campaignId: string, windowDays = 7): Promise<CampaignInsights> {
    const campaign = await this.ads.getCampaign(campaignId);
    if (!campaign) throw new Error('campaign not found');
    const account = await this.ads.getAccount(campaign.adsAccountId);
    if (!campaign.googleRefs || !account?.customerId) {
      return {
        campaignId, windowDays, impressions: 0, clicks: 0, spend: 0, currency: campaign.budget.currency,
        leads: 0, costPerLead: null, clickThroughRate: 0, monthToDateSpend: 0,
      };
    }
    const daily = await this.gateway.getDailyMetrics(account.customerId, campaign.googleRefs.campaign, dateDaysAgo(windowDays));
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    const mtd = daily.filter((d) => d.date >= monthStart.toISOString().slice(0, 10));
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const impressions = sum(daily.map((d) => d.impressions));
    const clicks = sum(daily.map((d) => d.clicks));
    const spend = round2(sum(daily.map((d) => d.cost)));
    const leads = await this.ads.countLeads(campaignId, isoDaysAgo(windowDays));
    return {
      campaignId, windowDays, impressions, clicks, spend, currency: campaign.budget.currency, leads,
      costPerLead: leads > 0 ? round2(spend / leads) : null,
      clickThroughRate: impressions > 0 ? round2((clicks / impressions) * 100) : 0,
      monthToDateSpend: round2(sum(mtd.map((d) => d.cost))),
    };
  }

  /**
   * TCPL loop. Reads are autonomous; every resulting ACTION is a proposal
   * through the approval queue — with ONE exception: breaching the hard
   * monthly cap triggers an immediate protective auto-pause (stops spend,
   * never starts it), loudly audited.
   */
  async evaluateTcpl(campaignId: string, windowDays = 7) {
    const campaign = await this.ads.getCampaign(campaignId);
    if (!campaign) throw new Error('campaign not found');
    const ins = await this.insights(campaignId, windowDays);
    const b = campaign.budget;
    let decision: TcplDecision = 'ok';
    let note = 'within thresholds';
    let proposalId: string | null = null;

    if (campaign.status === 'launched' && ins.monthToDateSpend >= b.monthlyCap) {
      decision = 'emergency_pause';
      note = `month-to-date spend ${ins.monthToDateSpend} breached hard monthly cap ${b.monthlyCap} — auto-paused (protective stop)`;
      await this.executeEdit({ campaignId, action: 'pause' });
      await this.ctx.store.audit({
        merchantId: campaign.merchantId, module: 'ads', event: 'tcpl.emergency_pause',
        detail: { campaignId, monthToDateSpend: ins.monthToDateSpend, monthlyCap: b.monthlyCap },
      });
    } else if (campaign.status === 'launched' && ins.leads === 0 && ins.spend > 3 * b.targetCostPerLead) {
      decision = 'propose_pause';
      note = `spent ${ins.spend} with zero leads (> 3× target CPL ${b.targetCostPerLead})`;
      proposalId = (await this.proposeEdit(campaignId, { action: 'pause' }, 'tcpl-loop')).id;
    } else if (ins.costPerLead !== null && ins.costPerLead > 2 * b.targetCostPerLead) {
      decision = 'propose_pause';
      note = `CPL ${ins.costPerLead} > 2× target ${b.targetCostPerLead}`;
      if (campaign.status === 'launched') proposalId = (await this.proposeEdit(campaignId, { action: 'pause' }, 'tcpl-loop')).id;
    } else if (ins.costPerLead !== null && ins.costPerLead > 1.3 * b.targetCostPerLead) {
      decision = 'propose_regenerate';
      note = `CPL ${ins.costPerLead} is 1.3–2× target ${b.targetCostPerLead} — regenerate creative/keywords, or lower budget`;
    } else if (
      campaign.status === 'launched' &&
      ins.costPerLead !== null &&
      ins.costPerLead < 0.7 * b.targetCostPerLead &&
      b.dailyAmount < b.hardDailyCeiling
    ) {
      const raised = round2(Math.min(b.dailyAmount * 1.25, b.hardDailyCeiling));
      decision = 'propose_raise_budget';
      note = `CPL ${ins.costPerLead} well under target ${b.targetCostPerLead} — propose raising daily budget to ${raised} (ceiling ${b.hardDailyCeiling})`;
      proposalId = (await this.proposeEdit(campaignId, { action: 'set_daily_budget', dailyAmount: raised }, 'tcpl-loop')).id;
    }

    const evaluation = await this.ads.recordTcplEvaluation({
      campaignId, windowDays, spend: ins.spend, leads: ins.leads, costPerLead: ins.costPerLead,
      decision, detail: { note, proposalId, monthToDateSpend: ins.monthToDateSpend },
    });
    return { evaluation, insights: ins, proposalId };
  }

  listTcplEvaluations(campaignId: string) {
    return this.ads.listTcplEvaluations(campaignId);
  }

  getCampaign(id: string) {
    return this.ads.getCampaign(id);
  }
  getAccount(id: string) {
    return this.ads.getAccount(id);
  }
  listCampaigns(merchantId: string) {
    return this.ads.listCampaigns(merchantId);
  }
}
