# Phase 3 — Ads Module (built before Phase 2 by operator decision)

Status: **STOP GATE — awaiting operator approval.**

Fully independent module (`server/src/modules/ads/`): own routes (`/api/ads/*`,
`/r/:slug`), own tables (`ads_*`), own gateway. The GBP module does not exist yet and
nothing here needs it — module independence is covered by a test.

## Capability map (all verified live in stub mode)

| Capability | How |
|---|---|
| **Flow A — link existing account** | `POST /api/ads/accounts {flow: existing_linked}` → approval `ads.account.link` → MCC link invitation → poll to `active` → read pre-existing structure (`GET .../structure`) |
| **Flow B — provision new account** | `{flow: provisioned}` → approval `ads.account.provision` → `createCustomerClient` under MCC → interim funding state created automatically |
| **Billing modes (per Phase 0 decision)** | `we_pay_transfer` (Flow A default), `we_pay_provisioned` (Flow B), `manage_only`. Funding = interim provider; "Mark billing done" reflects the manual Ads-UI step; **launch is refused until funded** |
| **Ad-type selection (pluggable)** | Registry: `search` implemented; `performance_max`, `demand_gen`, `local` are reserved slots that reject with a clear message (`/api/ads/meta` lists them) |
| **Full campaign configuration** | `SearchCampaignSpec`: geo (countries + free-text locations), languages, ad schedule, bidding (MaxClicks / MaxConversions+tCPA / ManualCPC), keywords + match types, negatives, RSA copy (headline/description limits enforced), network settings, lead destination |
| **AI budget** | `POST /api/ads/ai/budget` — AI proposes, **always clamped to the operator's hard daily ceiling**; deterministic heuristic fallback so stub/parse failures never block |
| **AI ad copy** | `POST /api/ads/ai/ad-copy` — RSA-compliant lengths, channel-specific CTA, safe fallback |
| **Publish gate** | Launch and every edit (pause/resume/budget change) go through the approval queue; executors are the only code paths that touch Google |
| **Lead funnel (S1 default)** | `/r/:slug` logs the lead server-side then 302s to `wa.me/<number>?text=…` or `ig.me/m/<user>` — this is the ad's final URL and the CPL ground truth. S3 (direct deep link) also implemented; S2 (message asset) & S4 (lead form) documented future strategies |
| **Insights** | `GET /api/ads/campaigns/:id/insights` — impressions, clicks, CTR, spend, leads, CPL, month-to-date spend |
| **TCPL loop** | `POST .../tcpl/evaluate`: CPL < 0.7×target → propose raise (≤ ceiling); 1.3–2× → propose regenerate; >2× or zero-lead burn → propose pause; **month-to-date ≥ monthly cap → EMERGENCY AUTO-PAUSE** (see below). History at `.../tcpl/history` |

## Spend-safety model (flagged for gate review)

1. Budget changes above `hardDailyCeiling` are refused at proposal AND executor level.
2. Worst-case Google overdelivery is bounded (2× daily, 30.4× daily/month) — noted in Phase 0 §3.5.
3. **The one autonomous external action in the system:** breaching `monthlyCap` triggers an immediate protective pause without waiting for approval (it stops spend, never starts it), loudly audited as `tcpl.emergency_pause`. Everything else — including TCPL raise/pause suggestions — is propose-then-approve. If you want the emergency pause to be propose-only as well, say so and I'll change it.

## Gateway: stub now, real by env flip

- `StubAdsGateway`: deterministic simulated Ads environment (accounts, link
  invitations that auto-accept, a pre-existing "legacy" campaign for Flow A context
  reads, daily metrics derived from budget + hash, pause-aware).
- `RealAdsGateway`: Google Ads API **REST** interface (`v23` pinned), authorized as
  the MCC (`login-customer-id`) via `ADS_MCC_REFRESH_TOKEN`. Implements: account
  provisioning, link invitations + status polling, GAQL structure/metrics reads,
  atomic Search-campaign launch (budget → campaign → geo/language/schedule criteria →
  ad group → keywords → negatives → RSA) with temp-resource mutate, status/budget
  updates, geo suggest for free-text locations.
- **Flagged tradeoff:** Phase 0 recommended the Opteo Node client; this phase ships
  the real gateway on the REST interface instead (fewer moving parts to write blind,
  and I can verify request shapes against Google's REST docs). The `AdsGateway`
  interface is the seam — if live testing favors the Opteo client, only
  `gateway-real.ts` internals change. Revisit at live-access time.
- Explorer-tier blocks (`createCustomerClient`, billing, keyword planning) surface
  as a typed `AdsAccessError` naming the required access level.
- The real gateway is **written to spec but untested** until the developer token +
  MCC exist. That is exactly what the E2E harness (Phase 4) will exercise first.

## Console additions

"Ads" tab: account setup (Flow A/B + billing mode), funding state with "Mark billing
done" (ops runbook step), campaign builder (keywords, AI copy, AI budget with
ceiling/cap/target-CPL inputs, WhatsApp/IG destination + prefill text), campaign
cards with live insights, propose launch/pause/resume, "Run TCPL check", and a
clickable lead link that simulates (or in production, IS) a real lead.

## Verified live (stub mode, over HTTP)

Provision → approve → funded gate → AI budget (clamped) → AI copy → draft with full
spec → launch proposal (human-readable money summary) → approve → launched with
Google refs → 4 clicks on `/r/:slug` → 4 leads logged, redirect carries prefill text
→ insights show CPL exactly = spend/leads → TCPL evaluate returns `ok`. Plus tests:
unfunded-launch refusal, over-ceiling refusal, Flow A structure read, TCPL raise
proposal queuing (not executing), emergency pause on cap breach, GBP-absent
independence. **23/23 tests pass.**

## Deferred seams left documented, unbuilt

- Ad types beyond Search (registry slots), S2 message assets (API allowlist), S4
  lead forms, keyword-planner-backed research (needs Basic access), channel-routing
  decision point, invoiced billing.
