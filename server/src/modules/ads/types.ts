import { z } from 'zod';

/** ─── Pluggable seams ──────────────────────────────────────────────────────
 * Ad types: registry below — 'search' is implemented; the other keys are
 * reserved slots (documented, unbuilt) so new formats add without rework.
 * Lead destinations: S1 tracked redirect (default, implemented), S3 direct
 * deep link (implemented); S2 native message asset + S4 lead-form webhook are
 * documented future strategies (Phase 0 research §4).
 */
export const AD_TYPES = ['search', 'performance_max', 'demand_gen', 'local'] as const;
export type AdType = (typeof AD_TYPES)[number];
export const IMPLEMENTED_AD_TYPES: AdType[] = ['search'];

export const LeadDestinationSchema = z.object({
  strategy: z.enum(['s1_redirect', 's3_direct']).default('s1_redirect'),
  channel: z.enum(['whatsapp', 'instagram_dm']),
  /** E.164 without '+' for wa.me, e.g. 919876543210 */
  whatsappNumber: z.string().regex(/^\d{8,15}$/).optional(),
  igUsername: z.string().min(1).max(60).optional(),
  prefillText: z.string().max(500).optional(),
}).refine((d) => (d.channel === 'whatsapp' ? !!d.whatsappNumber : !!d.igUsername), {
  message: 'whatsappNumber required for whatsapp, igUsername for instagram_dm',
});
export type LeadDestination = z.infer<typeof LeadDestinationSchema>;

export const BudgetSchema = z.object({
  currency: z.string().length(3),
  /** Daily budget in currency units. */
  dailyAmount: z.number().positive(),
  /** Hard ceiling any raise (human or TCPL) may never exceed. */
  hardDailyCeiling: z.number().positive(),
  /** Merchant-level hard monthly cap → emergency pause when breached. */
  monthlyCap: z.number().positive(),
  targetCostPerLead: z.number().positive(),
  proposedBy: z.string().default('operator'),
  rationale: z.string().optional(),
}).refine((b) => b.dailyAmount <= b.hardDailyCeiling, { message: 'dailyAmount exceeds hardDailyCeiling' })
  .refine((b) => b.hardDailyCeiling * 30.4 >= b.monthlyCap ? true : true, { message: '' });
export type Budget = z.infer<typeof BudgetSchema>;

export const SearchCampaignSpecSchema = z.object({
  geo: z.object({
    countryCodes: z.array(z.string().length(2)).min(1),
    /** Free-text locations (cities/regions) resolved to geo target constants at launch. */
    locations: z.array(z.string()).default([]),
  }),
  languageCodes: z.array(z.string().min(2).max(5)).default(['en']),
  schedule: z
    .object({
      days: z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).min(1),
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(1).max(24),
    })
    .optional(),
  bidding: z
    .object({
      strategy: z.enum(['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CLICKS', 'MANUAL_CPC']),
      targetCpa: z.number().positive().optional(),
      manualCpcMax: z.number().positive().optional(),
    })
    .default({ strategy: 'MAXIMIZE_CLICKS' }),
  keywords: z.array(z.object({ text: z.string().min(1), matchType: z.enum(['BROAD', 'PHRASE', 'EXACT']) })).min(1),
  negativeKeywords: z.array(z.string()).default([]),
  adCopy: z.object({
    headlines: z.array(z.string().min(1).max(30)).min(3).max(15),
    descriptions: z.array(z.string().min(1).max(90)).min(2).max(4),
    path1: z.string().max(15).optional(),
    path2: z.string().max(15).optional(),
  }),
  networks: z.object({ searchPartners: z.boolean().default(false) }).default({ searchPartners: false }),
  leadDestination: LeadDestinationSchema,
});
export type SearchCampaignSpec = z.infer<typeof SearchCampaignSpecSchema>;

/** ─── Domain records ─────────────────────────────────────────────────────── */
export type BillingMode = 'manage_only' | 'we_pay_transfer' | 'we_pay_provisioned';
export type AdsFlow = 'existing_linked' | 'provisioned';
export type LinkStatus =
  | 'none'
  | 'link_proposed'
  | 'invited'
  | 'active'
  | 'provision_proposed'
  | 'provision_pending'
  | 'error';

export interface AdsAccount {
  id: string;
  merchantId: string;
  flow: AdsFlow;
  billingMode: BillingMode;
  customerId: string | null;
  linkStatus: LinkStatus;
  createdAt: string;
  updatedAt: string;
}

export type CampaignStatus = 'draft' | 'launch_proposed' | 'launched' | 'paused' | 'archived';

export interface AdsCampaign {
  id: string;
  merchantId: string;
  adsAccountId: string;
  adType: AdType;
  name: string;
  spec: SearchCampaignSpec;
  budget: Budget;
  leadSlug: string | null;
  status: CampaignStatus;
  googleRefs: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadEvent {
  campaignId: string;
  destination: string;
  userAgent?: string;
  occurredAt: string;
}

export type TcplDecision = 'ok' | 'propose_raise_budget' | 'propose_pause' | 'propose_regenerate' | 'emergency_pause';

export interface TcplEvaluation {
  campaignId: string;
  windowDays: number;
  spend: number;
  leads: number;
  costPerLead: number | null;
  decision: TcplDecision;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface CampaignInsights {
  campaignId: string;
  windowDays: number;
  impressions: number;
  clicks: number;
  spend: number;
  currency: string;
  leads: number;
  costPerLead: number | null;
  clickThroughRate: number;
  monthToDateSpend: number;
}
