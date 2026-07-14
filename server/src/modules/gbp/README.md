# GBP module (Phase 2 — not yet built)

Fully independent module: usable with the Ads module absent. Owns its routes
(`/api/gbp/...`), data models, and flow logic.

Will consume from core (shared infra ONLY):
- `GoogleAuthService.getAccessToken(merchantId, 'gbp')`
- `ApprovalService` — executors: `gbp.post.publish`, `gbp.review.reply`,
  `gbp.info.update`, `gbp.media.upload`
- `AiProvider` — content rewrite, review-reply drafting, post generation
- `Store` (module tables prefixed `gbp_`)

Flow A: existing-profile management (info, services, posts, media, reviews,
performance, local SEO, AI rewrite). Flow B: guided net-new creation +
verification state machine (see docs/PHASE0-RESEARCH.md §5).

API surface: 5 split v1 APIs + legacy v4 (reviews/posts/media). Q&A removed
(API shut down Nov 2025).
