import type { AiProvider } from '../../core/ai/index.js';
import { BudgetSchema, type Budget, type SearchCampaignSpec } from './types.js';

/**
 * AI proposals are ALWAYS clamped to operator-set hard ceilings — the model
 * can suggest, never exceed. If the provider returns unusable output (or is
 * the stub), we fall back to a deterministic heuristic so the pipeline never
 * blocks on AI quality.
 */
export async function proposeBudget(
  ai: AiProvider,
  input: {
    merchantName: string;
    country: string;
    currency: string;
    targetCostPerLead: number;
    hardDailyCeiling: number;
    monthlyCap: number;
    keywords: string[];
  },
): Promise<Budget> {
  const heuristic = () => ({
    // Enough spend for ~4 leads/day at target CPL, never above the ceiling.
    dailyAmount: Math.min(round2(input.targetCostPerLead * 4), input.hardDailyCeiling),
    rationale: `Heuristic: 4×target CPL (${input.targetCostPerLead} ${input.currency}) per day, clamped to the ${input.hardDailyCeiling} ceiling.`,
  });

  let proposal = heuristic();
  try {
    const raw = await ai.complete({
      system:
        'You are a performance marketing budget planner. Respond with strict JSON: {"dailyAmount": number, "rationale": string}. The budget must be realistic for the market and never exceed the ceiling.',
      prompt: JSON.stringify({
        task: 'propose a daily budget for a Google Ads search campaign driving WhatsApp/Instagram DM leads',
        market: input.country,
        currency: input.currency,
        targetCostPerLead: input.targetCostPerLead,
        hardDailyCeiling: input.hardDailyCeiling,
        monthlyCap: input.monthlyCap,
        keywords: input.keywords.slice(0, 10),
        merchant: input.merchantName,
      }),
      json: true,
      temperature: 0.3,
    });
    const parsed = JSON.parse(raw);
    if (typeof parsed.dailyAmount === 'number' && parsed.dailyAmount > 0) {
      proposal = {
        dailyAmount: round2(Math.min(parsed.dailyAmount, input.hardDailyCeiling)),
        rationale: String(parsed.rationale ?? 'AI proposal'),
      };
    }
  } catch {
    // fall through to heuristic
  }

  return BudgetSchema.parse({
    currency: input.currency,
    dailyAmount: proposal.dailyAmount,
    hardDailyCeiling: input.hardDailyCeiling,
    monthlyCap: input.monthlyCap,
    targetCostPerLead: input.targetCostPerLead,
    proposedBy: ai.stub ? 'ai-stub-heuristic' : `ai:${ai.name}`,
    rationale: proposal.rationale,
  });
}

export async function generateAdCopy(
  ai: AiProvider,
  input: { merchantName: string; business: string; channel: 'whatsapp' | 'instagram_dm'; keywords: string[] },
): Promise<Pick<SearchCampaignSpec['adCopy'], 'headlines' | 'descriptions'>> {
  const cta = input.channel === 'whatsapp' ? 'Chat on WhatsApp' : 'Message us on Instagram';
  const fallback = {
    headlines: [
      trim30(`${input.merchantName}`),
      trim30(cta),
      trim30('Fast replies, real people'),
      trim30(`${input.business}`.trim() || 'Trusted local business'),
    ].filter((h, i, a) => h && a.indexOf(h) === i),
    descriptions: [
      trim90(`Message ${input.merchantName} now — quick answers and easy booking. ${cta}.`),
      trim90(`Serving you locally. Tap the ad and start a chat in seconds.`),
    ],
  };
  try {
    const raw = await ai.complete({
      system:
        'You write Google responsive search ads. Respond with strict JSON {"headlines": string[], "descriptions": string[]}. Headlines ≤30 chars each (6-8 of them), descriptions ≤90 chars each (3-4). No emojis, no ALL CAPS, no exclamation spam — Google Ads editorial policy compliant.',
      prompt: JSON.stringify({ merchant: input.merchantName, business: input.business, callToAction: cta, keywords: input.keywords.slice(0, 10) }),
      json: true,
      temperature: 0.7,
    });
    const parsed = JSON.parse(raw);
    const headlines = (Array.isArray(parsed.headlines) ? parsed.headlines : []).map(trim30).filter(Boolean).slice(0, 15);
    const descriptions = (Array.isArray(parsed.descriptions) ? parsed.descriptions : []).map(trim90).filter(Boolean).slice(0, 4);
    if (headlines.length >= 3 && descriptions.length >= 2) return { headlines, descriptions };
  } catch {
    // fall through
  }
  return fallback;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const trim30 = (s: unknown) => String(s ?? '').trim().slice(0, 30);
const trim90 = (s: unknown) => String(s ?? '').trim().slice(0, 90);
