# Phase 0 — Research Refresh (verified July 2026)

Status: **STOP GATE — awaiting operator approval.**
Companion doc: [PHASE0-PREREQUISITES.md](./PHASE0-PREREQUISITES.md) (ordered registration checklist).

Everything below was re-verified against current official Google documentation and
practitioner sources (Google Ads developer blog, ppc.land, Google Groups/adwords-api,
independent integrator writeups) as of **July 2026**. Deltas from the operator's prior
research are marked **Δ**.

---

## 1. Verified API surface

### 1.1 Google Business Profile (GBP) API family

One OAuth scope covers the whole family: `https://www.googleapis.com/auth/business.manage`
(sensitive scope → OAuth app verification required for production use).
All APIs are enabled on one Google Cloud project; **quota is 0 QPM until Google manually
approves the project** (~300 QPM after approval).

| Capability | API | Base URL | Status |
|---|---|---|---|
| Accounts, invitations, admins | My Business Account Management API | `mybusinessaccountmanagement.googleapis.com/v1` | Active |
| Location CRUD (incl. **net-new create**), categories, attributes, service items, hours, descriptions | My Business Business Information API | `mybusinessbusinessinformation.googleapis.com/v1` | Active |
| Verification: `getVoiceOfMerchant`, `fetchVerificationOptions`, `verify`, `verifications.list/complete` | My Business Verifications API | `mybusinessverifications.googleapis.com/v1` | Active |
| Performance metrics (`fetchMultiDailyMetricsTimeSeries`: views, calls, directions, website clicks, bookings, conversations) + monthly search-keyword impressions | Business Profile Performance API | `businessprofileperformance.googleapis.com/v1` | Active (Google's most actively developed GBP API) |
| **Reviews** (list/get/**reply**/delete reply), **Local Posts** (standard/event/offer + recurring), **Media** (photo/video upload, customer media) | Legacy Google My Business API **v4** | `mybusiness.googleapis.com/v4` | **Still active and still the ONLY home for reviews/posts/media in 2026.** Never migrated to the split APIs. |
| New-review / new-media push notifications (Cloud Pub/Sub) | My Business Notifications API | `mybusinessnotifications.googleapis.com/v1` | Active |
| Place action links (booking/ordering links) | My Business Place Actions API | `mybusinessplaceactions.googleapis.com/v1` | Active |

**Deprecations / removals:**
- **Δ Q&A API (`mybusinessqanda`) was shut down Nov 3, 2025.** Q&A is REMOVED from module scope (was in the original brief). No replacement exists.
- Business Calls API — deprecated May 2023.
- InsuranceNetworks / HealthProviderAttributes — deprecated June 2024.
- Old monolithic GMB v4.9 account/location management — retired April 2022 (replaced by the split APIs above; only reviews/posts/media remain on v4).

Sources: [deprecation schedule](https://developers.google.com/my-business/content/sunset-dates), [API overview](https://developers.google.com/my-business/ref_overview), [Q&A shutdown](https://ppc.land/google-discontinues-business-profile-q-a-api-effective-november-3/), [2026 practitioner survey of live endpoints](https://slashpost.ai/blogs/google-business-profile/google-business-profile-api-documentation-2026), [v4 reviews reference](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews).

### 1.2 Google Ads API

- **Δ Current version: v23 (Jan 27, 2026), with Google moving to a MONTHLY release cadence in 2026** (v23.1 Feb 2026; v24 mid-2026). v19 hit end-of-life Feb 11, 2026; v20–v22 sunset through 2026. Plan for ~2 version bumps/year minimum; the monthly cadence makes client-library currency a first-class maintenance concern.
- Endpoint: `googleads.googleapis.com` (gRPC + REST). OAuth scope: `https://www.googleapis.com/auth/adwords` (sensitive scope → app verification).
- **Node client recommendation: stay Node-only.** Opteo's community `google-ads-api` is at **v24.1.0 (June 2026), actively tracking Google's monthly releases within weeks**. There is still no official Node library. The official Python client offers no capability we need that Opteo's lib lacks; a Python split would buy nothing but operational complexity. **Recommendation: single TypeScript/Node stack.** (Fork noted: if Opteo's lib ever lags a forced sunset, the escape hatch is calling the REST endpoint directly from Node — not a Python service.)

Sources: [v23 announcement](https://ads-developers.googleblog.com/2026/01/announcing-v23-of-google-ads-api.html), [sunset schedule](https://developers.google.com/google-ads/api/docs/sunset-dates), [Opteo google-ads-api](https://github.com/Opteo/google-ads-api), [npm](https://www.npmjs.com/package/google-ads-api).

---

## 2. Verified access paths

### 2.1 GBP API access (project-level, one-time, for OUR platform)

- Application via Google's **GBP API contact form → "Application for Basic API Access"**, submitting: GCP **project number**, contact info, business website, and use case. ([Prereqs](https://developers.google.com/my-business/content/prereqs), [request workflow](https://support.google.com/business/workflow/16726127))
- Hard requirements (verified still enforced 2026): the applying Google account must be **owner/manager on a VERIFIED GBP active 60+ days** with a **live business website**. New/young listings are auto-rejected on age. Practitioner consensus: owner strongly preferred; use the owner email as the application contact.
- Review is **manual**. Stated/typical: **3–10 business days**; practitioner reports range **4 days to 6 weeks**; ~70% first-pass success (rejections mostly for vague use cases or unqualified profiles). Approval = quota raised from 0 to ~300 QPM, notified by email.
- **This is a per-platform gate, not per-merchant.** Merchants using the product later only need to own/manage their own verified GBP and complete OAuth — no application on their side.

### 2.2 Google Ads API developer token (issued from our MCC's API Center)

**Δ The tier system changed in late 2025 — there are now four levels, one of them automatic:**

| Level | How obtained | Prod accounts? | Daily ops | Key restrictions |
|---|---|---|---|---|
| Test Account | Automatic on token creation | No (test accts only) | 15,000 | — |
| **Explorer** (new, Oct 2025) | **Automatic upgrade, no application** | **Yes** | 2,880 | **Blocks: `CustomerService.CreateCustomerClient` (account provisioning), user-access services, `KeywordPlan*` services (keyword research), ALL billing services (`PaymentsAccountService`, `BillingSetupService`, `AccountBudgetProposalService`, `InvoiceService`)** |
| Basic | Application | Yes | 15,000 | none of the Explorer blocks |
| Standard | Application + RMF compliance | Yes | Unlimited | RMF (Required Minimum Functionality) audit applies to full-service ad-management tools |

- **Δ Backlog confirmed:** Google publicly acknowledged (Feb 6, 2026) a review backlog — Basic exceeding its 2-business-day target and Standard exceeding its 10-business-day window; extra reviewers added. Budget **2–6 weeks** for Basic in planning. ([Google's statement](https://ads-developers.googleblog.com/2026/02/an-update-on-google-ads-api-developer.html), [ppc.land coverage](https://ppc.land/google-faces-developer-token-application-backlog-as-new-api-tier-debuts/), [Explorer announcement](https://ads-developers.googleblog.com/2025/10/explorer-access-is-now-available-for.html))
- **Build implication:** Explorer gives us same-week production access for campaign create/manage/report (Ads Flow A end-to-end). But **Ads Flow B (provision new accounts) and the keyword-planner-backed local-SEO feature require Basic** → apply for Basic immediately at kickoff, in parallel with the build. Standard is a go-live/scale concern, not a build blocker.

---

## 3. Verified billing reality (interim model — we fund spend, no credit line)

Confirmed mechanics:

1. **API-managed billing (`BillingSetupService`, `AccountBudgetProposalService`) works ONLY for monthly-invoicing (credit-line) accounts.** That is the DEFERRED model. Under the interim model these services are unused (and are blocked under Explorer anyway).
2. **Interim funding path (confirmed supported):** a **Payments profile belonging to US** is linked to the MCC; when a child account is created from the manager, the Billing Configuration step lets us **attach a payments profile already linked to the manager**, and **one payments profile can be reused across many client accounts** ([Google Ads Help: payments-profile linking for automatic/manual payments](https://support.google.com/google-ads/answer/14169584), [manage billing from manager account](https://support.google.com/google-ads/answer/9357347)). Result: merchant never pays Google; we do.
3. **Card/automatic-payments billing configuration is UI-only — it cannot be completed via API.** So under the interim model, every we-funded account requires a **one-time manual billing step in the Ads UI** (~2 minutes, from our MCC login). This goes in the ops runbook and sits behind the billing abstraction; the future invoiced implementation replaces it with `BillingSetupService` calls.
4. **Flow A (merchant's EXISTING account) — "who pays" tradeoff to decide at this gate:**
   - **(a) Link-only:** account links under our MCC for management; merchant's existing billing keeps paying. Simplest; but NOT "we pay".
   - **(b) Billing transfer:** after linking, transfer the account's billing to OUR payments profile (UI flow, supported from the manager for automatic-payments accounts; payer changes going forward). True "we pay" on their existing account; manual UI step + merchant consent.
   - **(c) Provision a parallel we-funded account (Flow B machinery) and run new campaigns there,** leaving their legacy account untouched (read-only context via the link). Cleanest money separation & offboarding; splits history across two accounts.
   - **Recommendation: default (b)** when the merchant wants us funding their existing account, with **(c) offered** when they want strict separation; (a) supported trivially as "manage-only mode". Decision requested at the gate.
5. **Spend-cap reality under interim billing:** account-level budgets (`AccountBudget`) exist only for invoicing accounts → **hard ceilings must be enforced by OUR engine**: campaign daily budgets (Google may overdeliver up to 2× daily on a given day but never above 30.4 × daily budget per month), plus our monitor that pauses campaigns when merchant-level cumulative spend approaches the configured hard ceiling. This is a residual-risk note: worst-case slippage is bounded by the daily-budget math, not by an account-level kill switch. (Google's UI "account spend limit" exists for some accounts; treated as belt-and-suspenders where available, not relied on.)

---

## 4. Verified lead-funnel mechanism (WhatsApp / Instagram DM)

**Δ Major update to the prior reality-check: Google NOW HAS a native click-to-message format.**

- **Message assets** (a.k.a. business message assets) attach to **Search and Performance Max** campaigns and open a chat with the business in **WhatsApp** — and, since Nov 2025, **Facebook Messenger and Zalo**. Setup requires the business's active WhatsApp number + country. Serving: **Android globally, iOS in ~50 countries**. Since **Oct 30, 2025** Google enforces **verification of message assets** (must relate to the advertised business) before serving. ([About message assets](https://support.google.com/google-ads/answer/14888522), [requirements policy](https://support.google.com/adspolicy/answer/16471781), [Messenger/Zalo expansion](https://ppc.land/google-expands-messaging-platforms-in-ads-beyond-whatsapp-support/))
- **BUT the Ads API surface for business message assets is allowlist-restricted** — Google's docs say access requires going through your Google Account Manager ([API doc](https://developers.google.com/google-ads/api/docs/assets/business-message-assets)). A small new MCC typically has no account manager, so **assume no API-side message-asset creation initially**; it may still be attachable via the Ads UI on API-created campaigns.
- **Instagram DM: no native Google format exists** (unchanged). The path is a deep link (`ig.me/m/<username>`) as/behind the final URL.

**Design: pluggable `LeadDestination` strategies** (this satisfies the pluggable-objective requirement):

| Strategy | Mechanism | Tracking | Risk/constraint |
|---|---|---|---|
| **S1 — Tracked redirect page (RECOMMENDED DEFAULT)** | Search (later PMax) campaign; final URL = our thin per-merchant landing page that fires the conversion then deep-links to `wa.me/<number>` or `ig.me/m/<user>` | Full: conversion fires pre-redirect → clean cost-per-lead for the TCPL loop | Requires our tiny hosted redirect page (part of this build); policy-safe |
| S2 — Native message asset (WhatsApp/Messenger) | Message asset on Search/PMax | Google-reported message conversions | API allowlist gate; iOS country list; asset verification since Oct 2025; attach via UI if API blocked |
| S3 — Direct `wa.me` / `ig.me` final URL | Deep link as the final URL itself | Click only — no reliable lead conversion | Practitioners report intermittent "destination not working" disapprovals; weakest tracking |
| S4 — Lead form asset → webhook → WhatsApp | Lead form; our webhook opens the WhatsApp thread | Form submissions as leads | Needs a WhatsApp Business API sender; heavier merchant onboarding; a v2 strategy |

**TCPL loop keys off the S1 redirect-conversion (a real per-lead event we own), falling back to S2's message conversions where used.** Campaign type at launch: **Search** (fully API-configurable, no allowlist); PMax/Demand Gen/Local slots reserved in the pluggable ad-type registry.

---

## 5. Verified net-new GBP creation reality

Confirmed: **cannot be fully automated — but more is API-drivable than the minimum:**

- API **CAN**: create the location (`locations.create`, Business Information API) fully pre-filled by AI; check claim/verification state (`getVoiceOfMerchant`); list available verification methods (`fetchVerificationOptions`); **initiate** verification (`verify`) for ADDRESS/postcard, PHONE_CALL, SMS, EMAIL (and AUTO where offered); and **complete PIN-based methods via API** (`verifications.complete` with the PIN the merchant received). ([Verifications API](https://developers.google.com/my-business/reference/verifications/rest), [manage-verification guide](https://developers.google.com/my-business/content/manage-verification))
- API **CANNOT**: choose which methods Google offers (Google decides per business/category/region — **many new listings are offered VIDEO ONLY**, a fraud-control trend since 2024); complete **video verification** (UI/mobile-app only, human-recorded walkthrough, Google review up to ~5 business days); or force/accelerate review.
- **Flow B state machine** therefore: `DRAFT → CREATED → VERIFICATION_OPTIONS_FETCHED → { PIN_SENT → PIN_ENTERED (in-console, via API) | VIDEO_HANDOFF (deep link to Google UI, we poll VoiceOfMerchant) } → VERIFIED → managed under Flow A`. Pending states are first-class and long-lived (postcard ≈ 14 days; video review ≈ days).
- Guardrail restated: no fake/test listings in production, ever. E2E tests for Flow B run against a real business we control, or stop at the pre-verification boundary.

---

## 6. Architecture consequences locked in by this research

1. **Node-only stack** (Opteo `google-ads-api` current; GBP via plain REST or `googleapis`).
2. **GBP client must speak to SIX base URLs** (5 split APIs + legacy v4) behind one module-internal client; Q&A removed from scope.
3. **Ads module launches on Search campaigns + S1 redirect destination**; message assets (S2) behind a feature flag pending allowlist; ad-type registry pluggable from day one.
4. **Billing abstraction**: `InterimBilling` (our payments profile + manual UI step + engine-enforced caps) now; `InvoicedBilling` stub for later.
5. **Apply-early pipeline**: GBP API application + Ads Basic-access application both filed at kickoff; the build runs against stubs until quota lands (Explorer bridges most Ads testing in the meantime).
6. **OAuth app verification** (both scopes are "sensitive") is its own multi-week Google review — filed at kickoff; until it clears, testing runs in OAuth "testing" mode with allowlisted test users (100-user cap), which is fine for our purposes.

---

## Open questions for the operator (answer at this gate)

1. **Flow A billing default:** approve recommendation (b) billing-transfer as default, (c) parallel we-funded account as option, (a) manage-only supported?
2. **Which verified GBP** (owner email + website) will back the GBP API application and E2E tests? (You confirmed you can obtain this — need the concrete profile at Phase 1 kickoff.)
3. **Primary target market(s)/countries** — affects message-asset iOS availability, currencies, and payments-profile setup.
4. **Node-only stack** — approve (recommended above)?
