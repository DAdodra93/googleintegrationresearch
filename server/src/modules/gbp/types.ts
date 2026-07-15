import { z } from 'zod';

export type GbpFlow = 'existing' | 'created';
export type GbpProfileStatus =
  | 'draft'
  | 'create_proposed'
  | 'created'
  | 'verification_pending'
  | 'verified'
  | 'connected'
  | 'error';

export interface GbpProfile {
  id: string;
  merchantId: string;
  flow: GbpFlow;
  accountName: string | null;
  locationName: string | null;
  title: string;
  status: GbpProfileStatus;
  prefill: Record<string, unknown> | null;
  verification: { method?: string; verificationName?: string; state?: string; note?: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** Subset of google.mybusiness location fields we read/write (extendable). */
export interface LocationInfo {
  name: string; // locations/{id}
  title: string;
  primaryCategory?: string;
  phone?: string;
  websiteUri?: string;
  description?: string;
  address?: { lines: string[]; locality?: string; administrativeArea?: string; postalCode?: string; regionCode?: string };
  regularHours?: Array<{ day: string; openTime: string; closeTime: string }>;
  serviceItems?: Array<{ label: string; description?: string; priceText?: string }>;
}

export interface GbpReview {
  reviewName: string; // v4 full: accounts/x/locations/y/reviews/z
  reviewer: string;
  starRating: number;
  comment: string;
  createTime: string;
  reply: { comment: string; updateTime: string } | null;
}

export interface GbpPost {
  name: string;
  summary: string;
  topicType: string;
  ctaType?: string;
  ctaUrl?: string;
  state: string;
  createTime: string;
}

export interface GbpMediaItem {
  name: string;
  category: string;
  sourceUrl?: string;
  googleUrl?: string;
  createTime: string;
}

export interface GbpDailyMetrics {
  date: string;
  impressionsSearch: number;
  impressionsMaps: number;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  conversations: number;
}

export interface KeywordImpressions {
  keyword: string;
  impressions: number;
}

export interface VerificationOption {
  method: string; // SMS | PHONE_CALL | EMAIL | ADDRESS | VIDEO | AUTO
  detail?: string; // masked phone/email/address hint from Google
}

export const InfoPatchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(750).optional(),
    phone: z.string().max(30).optional(),
    websiteUri: z.string().url().optional(),
    serviceItems: z
      .array(z.object({ label: z.string().min(1), description: z.string().optional(), priceText: z.string().optional() }))
      .optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'empty patch' });
export type InfoPatch = z.infer<typeof InfoPatchSchema>;

export const PostInputSchema = z.object({
  summary: z.string().min(10).max(1500),
  topicType: z.enum(['STANDARD', 'EVENT', 'OFFER']).default('STANDARD'),
  ctaType: z.enum(['LEARN_MORE', 'BOOK', 'ORDER', 'SHOP', 'SIGN_UP', 'CALL']).optional(),
  ctaUrl: z.string().url().optional(),
});
export type PostInput = z.infer<typeof PostInputSchema>;

export const PrefillInputSchema = z.object({
  businessName: z.string().min(1).max(200),
  category: z.string().min(1),
  addressLines: z.array(z.string()).min(1),
  locality: z.string().min(1),
  administrativeArea: z.string().optional(),
  postalCode: z.string().min(2),
  regionCode: z.string().length(2),
  phone: z.string().min(5),
  websiteUri: z.string().url().optional(),
  businessDetails: z.string().max(1000).default(''),
});
export type PrefillInput = z.infer<typeof PrefillInputSchema>;
