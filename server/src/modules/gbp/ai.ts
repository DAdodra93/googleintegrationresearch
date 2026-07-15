import type { AiProvider } from '../../core/ai/index.js';
import type { GbpReview, PrefillInput } from './types.js';

/**
 * GBP AI assists. POLICY GUARDRAILS baked in: we never generate reviews
 * (only replies to real existing reviews), never promise incentives in
 * replies, and drafts only reach Google through approval-gated executors.
 */

export async function rewriteField(
  ai: AiProvider,
  input: { field: 'description' | 'post' | 'serviceDescription'; current: string; businessName: string; tone?: string },
): Promise<string> {
  const limits = { description: 750, post: 1500, serviceDescription: 300 } as const;
  const max = limits[input.field];
  try {
    if (ai.stub) throw new Error('stub');
    const out = await ai.complete({
      system: `You improve Google Business Profile content for local SEO. Return ONLY the rewritten text, max ${max} characters. Natural keywords, no keyword stuffing, no ALL CAPS, no phone numbers or URLs inside descriptions (GBP policy).`,
      prompt: `Business: ${input.businessName}\nTone: ${input.tone ?? 'warm, professional'}\nField: ${input.field}\nCurrent text:\n${input.current}`,
      temperature: 0.6,
    });
    const text = out.trim().slice(0, max);
    if (text.length > 10) return text;
  } catch {
    /* fall through */
  }
  return input.current.slice(0, max);
}

export async function draftReviewReply(ai: AiProvider, input: { businessName: string; review: GbpReview }): Promise<string> {
  const { review } = input;
  const fallback =
    review.starRating >= 4
      ? `Thank you so much, ${review.reviewer.split(' ')[0]}! We're delighted you enjoyed your visit and hope to see you again soon. — ${input.businessName}`
      : `Thank you for the honest feedback, ${review.reviewer.split(' ')[0]} — we're sorry we fell short. We're working on it and would love another chance to serve you better. — ${input.businessName}`;
  try {
    if (ai.stub) throw new Error('stub');
    const out = await ai.complete({
      system:
        'You draft owner replies to Google reviews. Rules: thank the reviewer by first name, address their specific points, stay professional and human, NEVER offer discounts/incentives, never admit legal liability, max 350 characters. Return only the reply text.',
      prompt: JSON.stringify({ business: input.businessName, stars: review.starRating, review: review.comment, reviewer: review.reviewer }),
      temperature: 0.6,
    });
    const text = out.trim().slice(0, 350);
    if (text.length > 20) return text;
  } catch {
    /* fall through */
  }
  return fallback;
}

export async function generatePost(
  ai: AiProvider,
  input: { businessName: string; topic: string; ctaUrl?: string },
): Promise<{ summary: string; ctaType?: 'LEARN_MORE'; ctaUrl?: string }> {
  const fallback = {
    summary: `${input.topic} at ${input.businessName}! Drop by or message us to know more — we'd love to see you.`,
    ...(input.ctaUrl ? { ctaType: 'LEARN_MORE' as const, ctaUrl: input.ctaUrl } : {}),
  };
  try {
    if (ai.stub) throw new Error('stub');
    const out = await ai.complete({
      system:
        'You write Google Business Profile posts (What\'s New). 80-250 characters, engaging but factual, no fake urgency, no ALL CAPS. Return only the post text.',
      prompt: `Business: ${input.businessName}\nTopic: ${input.topic}`,
      temperature: 0.7,
    });
    const summary = out.trim().slice(0, 1500);
    if (summary.length >= 10) return { summary, ...(input.ctaUrl ? { ctaType: 'LEARN_MORE' as const, ctaUrl: input.ctaUrl } : {}) };
  } catch {
    /* fall through */
  }
  return fallback;
}

/** Flow B: expand minimal operator inputs into a full location payload. */
export async function prefillLocation(ai: AiProvider, input: PrefillInput) {
  let description = input.businessDetails;
  try {
    if (ai.stub) throw new Error('stub');
    const out = await ai.complete({
      system:
        'Write a Google Business Profile business description, max 700 characters, natural local-SEO keywords, no URLs or phone numbers. Return only the description.',
      prompt: JSON.stringify({ name: input.businessName, category: input.category, city: input.locality, details: input.businessDetails }),
      temperature: 0.6,
    });
    if (out.trim().length > 30) description = out.trim().slice(0, 700);
  } catch {
    /* keep operator-provided details */
  }
  return {
    title: input.businessName,
    primaryCategory: input.category,
    phone: input.phone,
    websiteUri: input.websiteUri,
    description,
    address: {
      lines: input.addressLines,
      locality: input.locality,
      administrativeArea: input.administrativeArea,
      postalCode: input.postalCode,
      regionCode: input.regionCode,
    },
  };
}
