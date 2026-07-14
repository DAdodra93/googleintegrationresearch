# Phase 1 — Shared Foundation & Auth (stub-first)

Status: **STOP GATE — awaiting operator approval.**

Everything below runs today with ZERO Google access: every external dependency sits
behind a seam with a stub implementation, and flipping to real is **environment
variables only — no code changes** (see `.env.example`).

## What was built

```
server/                    TypeScript / Node 22 / Fastify
  migrations/              Postgres schema (merchants, google_connections,
                           approvals, account_funding, audit_log)
  src/core/
    config.ts              env-driven config; stub modes auto-detect from missing creds
    crypto.ts              AES-256-GCM token encryption + HMAC-signed OAuth state
    store/                 Store interface; PgStore (Supabase-compatible, with
                           migration runner) + MemoryStore (stub dev/tests)
    googleauth/            per-module OAuth (scopes.ts), TokenExchanger seam
                           (Real ⇄ Stub), GoogleAuthService (connect flow +
                           cached access-token refresh)
    ai/                    AiProvider seam — OpenAiProvider ⇄ StubAiProvider
    billing/               BillingProvider seam — InterimBillingProvider (we-fund,
                           tracks the manual Ads-UI billing step as an explicit
                           pending state) ⇄ InvoicedBillingProvider (future stub)
    approvals/             generic propose→approve→execute engine with per-action
                           executor registry; nothing external runs unapproved
  src/routes/              /api/system, /api/merchants, /auth/google/:module/*,
                           /api/approvals, /api/dev/* (pipeline-proof endpoints)
  src/modules/gbp, ads     placeholders documenting exactly what Phase 2/3 consume
  test/                    15 tests: crypto, approvals engine, full stub-mode E2E
console/                   Vite + React test console: merchant picker, per-module
                           connect/disconnect cards, approval queue (approve/reject
                           + history), system panel (config, AI seam check, audit)
```

## Design decisions embodied

- **Module independence:** connections are keyed `(merchant, module)` with separate
  scopes; either module connects/disconnects/testable alone (covered by a test).
- **Multi-tenant from day one:** every row and every route is merchant-keyed.
- **Token security:** refresh tokens AES-256-GCM-encrypted at rest; never serialized
  to the console; OAuth `state` HMAC-signed with 10-min TTL (tamper test included).
- **Approval philosophy enforced structurally:** module code cannot execute an
  external action directly — it registers an executor and proposes; only an
  approve decision triggers execution; failures are captured on the approval.
- **India-first defaults:** new merchants default to IN/INR (overridable per merchant).
- **Audit trail:** every connect, proposal, decision, execution, and billing state
  change is logged.

## How to run

```bash
npm install
npm run dev -w server          # API on :8080 (stub mode with empty env)
npm run dev -w console         # console on :5173 (proxies to :8080)
# or: npm run build && npm start -w server   → serves built console on :8080
npm test                       # 15 tests
```

## Verified in this phase (stub mode, live over HTTP)

- Merchant create → OAuth connect GBP and Ads independently → encrypted token
  stored → access-token refresh pipeline returns a token.
- GBP-only merchant: Ads absent, GBP fully functional (independence proof).
- AI seam: prompt → provider → response (stub; swaps to OpenAI via env).
- Interim billing: ensure funding → `pending_manual_billing_setup` → operator
  marks funded (the manual Ads-UI step is an explicit tracked state).
- Approval queue: propose → pending in console → approve → executed (and
  reject / failure paths under test).

## Operator actions to run in parallel now (from PHASE0-PREREQUISITES.md)

1. Cloud project + enable APIs + OAuth consent screen (testing mode) → fills
   `GOOGLE_CLIENT_ID/SECRET`.
2. **File the GBP API access application** (needs the qualifying GBP).
3. Create MCC → developer token (→ `ADS_DEVELOPER_TOKEN`, `ADS_MCC_CUSTOMER_ID`)
   → **file Basic-access application**.
4. Payments profile linked to the MCC.
5. Supabase/Postgres (`DATABASE_URL`), OpenAI key, and a generated `TOKEN_ENC_KEY`.

## Known limitations (deliberate, Phase-1 scope)

- No operator authentication on the console/API — it's a local test console;
  real access control comes with productization, not this proof-of-capability build.
- Access-token cache is in-process memory (fine single-instance).
- `/api/dev/*` routes exist to prove pipelines; Phase 2/3 replace them with real
  module actions.
