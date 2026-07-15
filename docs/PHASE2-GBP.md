# Phase 2 — GBP Module

Status: **STOP GATE — awaiting operator approval.**

Fully independent module (`server/src/modules/gbp/`): own routes (`/api/gbp/*`), own
table (`gbp_profiles`), own gateway. Works with the Ads module absent (tested), and
the Ads module keeps working with GBP absent.

## Capability map (all verified in stub mode)

| Capability | How |
|---|---|
| **Flow A — connect existing profile** | Merchant OAuth (Connections tab) → `GET /api/gbp/discover` lists accounts+locations → pick one → managed profile |
| **Business info read/write** | `GET .../info`; `propose-info-update` (title, description, phone, website, services) → approval `gbp.info.update` → PATCH with updateMask |
| **AI rewrite** | `POST /api/gbp/ai/rewrite` (description/post/service copy, GBP policy constraints in the prompt, deterministic fallback in stub) |
| **Reviews** | list (autonomous read) → `POST /api/gbp/ai/review-reply` drafts (tone-aware by star rating, **never offers incentives**) → `propose-review-reply` → approval `gbp.review.reply` → v4 reply PUT. **We never create reviews — replies to real reviews only.** |
| **Posts** | AI draft (`/api/gbp/ai/post`) → `propose-post` (STANDARD/EVENT/OFFER + CTA) → approval `gbp.post.publish` → v4 localPosts |
| **Media** | `propose-media` (URL + COVER/PROFILE/ADDITIONAL) → approval `gbp.media.upload` → v4 media |
| **Performance** | `GET .../performance?days=` — daily series + totals (search/maps impressions, calls, website clicks, directions, conversations) + **before/after trend %** |
| **Local SEO keywords** | `GET .../keywords` — real search-keyword impressions from the Performance API |
| **Flow B — net-new creation** | Minimal inputs → **AI-prefilled draft** → `propose-create` → approval `gbp.location.create` → `locations.create` → state machine: `draft → create_proposed → created → verification_pending → verified` → **full Flow A surface unlocks automatically** |
| **Verification** | `fetchVerificationOptions` (Google decides methods) → PIN methods (SMS/PHONE/EMAIL/postcard) complete fully in-console via API → **VIDEO = explicit UI-handoff state**, resolved by VoiceOfMerchant polling on every profile read |
| Q&A | **Removed** — Google shut the Q&A API down Nov 3, 2025 (Phase 0 Δ) |

## Design notes flagged for review

1. **Verification initiation is not approval-gated** (the create is; verification only
   sends a PIN to the merchant's own address/phone/email). Tell me if you want a gate
   there too.
2. The real gateway spans the 5 split v1 APIs + legacy v4; a 429 is translated to a
   clear "project quota not approved yet" message so real-mode testing before GBP API
   approval fails loudly and legibly.
3. **Guardrail honored:** Flow B E2E in stub only; against real accounts, net-new
   creation is only run for a real business you control (no fake listings).

## Console

GBP tab: Flow A discovery/selection; Flow B wizard (AI-prefilled draft → propose →
verification method picker → PIN entry or video handoff note → verified); management
surface: performance strip with trends, info editor with AI rewrite, reviews with AI
draft replies, posts with AI drafting, photo upload, keyword table. Every write button
says "Propose …" and routes through the Approvals tab.

## Tests

7 GBP tests (30 total passing): OAuth-required discovery, Flow A full loop with
approved info update landing in the (stub) location, review reply approve + reject
paths, posts/media/performance/keywords, Flow B create→PIN verify→manage (wrong PIN
rejected), video handoff pending state, and ads-absent independence.
