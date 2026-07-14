# Phase 0 — Prerequisite & Registration Checklist

Status: **STOP GATE — awaiting operator approval.**
Every human action needed to unlock this build, in dependency order. Nothing in later
phases silently assumes access that isn't ✅ here. "Blocks" distinguishes **build**
(can't even develop/test against stubs without it) from **live-test** (build proceeds on
stubs; real-account testing waits) from **go-live/scale**.

| # | Action | Purpose | Granted by | Realistic lead time | Depends on | Blocks |
|---|--------|---------|-----------|--------------------|-----------|--------|
| 1 | Create/choose the **operator Google account** (company identity, not personal) | Owns everything below | — (self-serve) | Same day | — | Build |
| 2 | Create **Google Cloud project**; enable the 6 GBP APIs (Account Mgmt, Business Info, Verifications, Performance, Notifications, Place Actions) + legacy My Business v4 + **Google Ads API** | The single project all quota and OAuth hang off | — (self-serve) | Same day | 1 | Build |
| 3 | Stand up **product domain + privacy policy + terms pages** | Required for OAuth consent screen & app verification | — (self-serve) | 1–3 days | — | #4 |
| 4 | Configure **OAuth consent screen** (external) with scopes `business.manage` + `adwords`; add test users; **submit app verification** | Merchant OAuth for both modules; both scopes are "sensitive" → Google app review | Google Trust & Safety (OAuth review) | Testing mode: same day (≤100 test users — sufficient for the whole build). **Verification: 2–6 weeks** | 2, 3 | Go-live only (testing mode covers build + operator E2E) |
| 5 | Secure **owner access to a verified GBP, active 60+ days, live website** (operator confirmed obtainable) | Sole eligibility key for the GBP API application; also the Flow A E2E test profile | — (existing business asset) | 0 if it exists; **~2+ months if one must be created & aged** | — | #6, GBP live-test |
| 6 | **Submit GBP API access application** (contact form → "Application for Basic API Access": GCP project number, owner email, website, use case) | Raises GBP quota from 0 → ~300 QPM | Google Business Profile API team (manual review) | **3–10 business days typical; up to 6 weeks reported; ~70% first-pass** — write the use case carefully | 2, 5 | GBP live-test (GBP module built on stubs meanwhile) |
| 7 | Create **Google Ads Manager Account (MCC)** on the operator account | Umbrella for all merchant accounts; issues the developer token | — (self-serve) | Same day | 1 | #8–#12 |
| 8 | Generate **developer token** in MCC API Center | API credential; starts at Test-Account access, **auto-upgrades to Explorer** (production, 2,880 ops/day) | Google (automatic) | Token: same day. Explorer upgrade: days | 7 | Ads live-test (Flow A testable under Explorer) |
| 9 | **Apply for Basic access** for the developer token | Unlocks `CreateCustomerClient` (Ads Flow B), `KeywordPlan*` (local-SEO keyword feature), billing services, 15k ops/day | Google Ads API team (manual review) | Target 2 business days; **currently backlogged — budget 2–6 weeks. FILE AT KICKOFF** | 8 | Ads Flow B live-test; keyword-research feature |
| 10 | Create **test manager + test client accounts** in the Ads UI | Full-fidelity Ads development before/alongside Explorer | — (self-serve) | Same day | 7 | — (accelerates build) |
| 11 | Create company **Payments profile** and link it to the MCC | The interim "we pay" funding instrument, reusable across all provisioned merchant accounts | — (self-serve; card details) | Same day | 7 | Ads live-test with real spend |
| 12 | *(Later, at scale)* **Apply for Standard access** (+ RMF compliance) | Removes 15k ops/day cap | Google Ads API team | 10+ business days + backlog | 9 in production use | Scale only |
| 13 | *(Optional)* Request **message-asset API allowlist** via a Google account manager, if/when one is reachable | Unlocks API-side click-to-WhatsApp asset creation (strategy S2) | Google account team | Unknown; small MCCs usually can't reach this initially | 7, 9 | Nothing — S1 redirect strategy is the default |
| 14 | **WhatsApp Business number we control** (+ optionally an IG business handle) | E2E target for the lead funnel test | Meta (self-serve app) | Same day | — | Ads E2E lead test |
| 15 | **OpenAI API key** (org account) | AI layer default provider | OpenAI (self-serve) | Same day | — | Build (AI features) |
| 16 | **Postgres** (Supabase project or equivalent) | Token vault + all module data | — (self-serve) | Same day | — | Build |
| 17 | **Per-merchant, recurring (ops runbook, interim billing):** on each we-funded account provisioned by Flow B, complete the **Billing Configuration step in the Ads UI** attaching our payments profile (~2 min; API cannot do this outside invoicing) | Activates the account for spend, funded by us | — (our ops, in Ads UI) | Minutes per merchant | 11 + Flow B provisioning | That merchant's ads going live |

## Critical path summary

- **File #6 (GBP API) and #9 (Ads Basic) in week 1, in parallel with Phase 1** — they are the two multi-week, human-reviewed gates, and both only block *live testing*, not the build (stub-first design).
- **#5 is the only prerequisite with a potential multi-month tail** (if no qualifying GBP exists). Operator has confirmed one is obtainable → confirm the concrete profile + owner email at Phase 1 kickoff.
- Everything else is same-day self-serve.
- **Nothing on this list blocks starting Phase 1 immediately.**
