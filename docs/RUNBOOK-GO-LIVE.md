# Runbook — Testing Both Modules with Real Google Credentials

Exact operator steps, in order. Each stage ends with a check you can run in the
console. Stages 1–2 unlock real-mode GBP; stages 1+3 unlock real-mode Ads — the
modules stay independent, do them in either order. Everything not yet unlocked keeps
running in stub mode.

---

## Stage 0 — prep (½ day)

1. Choose the **operator Google account** (company identity — it will own the Cloud
   project, the MCC, and submit the GBP application).
2. Have a **live product domain with privacy-policy and terms pages** (required by the
   OAuth consent screen). A simple static page is fine.
3. Generate secrets locally:
   ```bash
   openssl rand -hex 32   # → TOKEN_ENC_KEY
   ```
4. Create a **Supabase project** (or any Postgres) → `DATABASE_URL`; get an
   **OpenAI API key** → `OPENAI_API_KEY`.

## Stage 1 — Google Cloud project + OAuth (1 hour, unlocks real OAuth for BOTH modules)

1. [console.cloud.google.com](https://console.cloud.google.com) → **New project** (e.g. `google-growth-engine`). Note the **project NUMBER** (needed for the GBP application).
2. **APIs & Services → Library** — enable ALL of:
   - Google Ads API
   - My Business Account Management API
   - My Business Business Information API
   - My Business Verifications API
   - My Business Notifications API *(optional now)*
   - My Business Place Actions API *(optional now)*
   - Business Profile Performance API
   - Google My Business API *(the legacy v4 — reviews/posts/media live here)*
3. **OAuth consent screen**: External · app name/logo · your support email · links to
   your privacy policy/terms · **stay in “Testing” mode** and add your own Google
   account(s) (and any test merchant accounts) as **test users**. Do NOT submit for
   verification yet — testing mode fully covers this build (≤100 test users).
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized redirect URIs (add all):
   ```
   http://localhost:8080/auth/google/gbp/callback
   http://localhost:8080/auth/google/ads/callback
   https://<your-deployed-domain>/auth/google/gbp/callback
   https://<your-deployed-domain>/auth/google/ads/callback
   https://developers.google.com/oauthplayground        ← used once in Stage 3.4
   ```
5. Fill `.env` (from `.env.example`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `TOKEN_ENC_KEY`, `DATABASE_URL`, `OPENAI_API_KEY`, `PUBLIC_BASE_URL`.

**✅ Check:** restart the server — the “GOOGLE STUB MODE” banner disappears; the
Connections tab “Connect” button now opens a real Google consent screen; after
consenting, the connection card shows your real Google email. (GBP API *calls* will
still fail with the quota message until Stage 2.4 — that's expected.)

## Stage 2 — GBP real-mode (calendar time: days–weeks, driven by Google review)

1. Secure **owner access to a verified GBP, active 60+ days, with a live website**
   (you confirmed you can). Log its owner email.
2. **Submit the GBP API access application**: [official request flow](https://support.google.com/business/workflow/16726127)
   (“Application for Basic API Access”). You'll need: GCP **project number** (Stage 1.1),
   the **owner email**, the business **website**, and a use-case description. Write the
   use case concretely — e.g. *“SaaS platform enabling small businesses to manage
   their own Business Profiles (posts, review replies, business info, performance
   reporting) via per-merchant OAuth with human approval of all changes.”* I can
   draft the exact text when you're ready. ~70% pass first time; 3–10 business days
   typical, up to 6 weeks reported.
3. While waiting: everything remains testable in stub mode; do Stage 3 in parallel.
4. Approval email arrives → confirm quota: Cloud console → APIs & Services →
   each GBP API → Quotas shows ~300 QPM (not 0).
5. **Real Flow A test** (in the console): create a merchant → Connections → Connect
   GBP **signing in as the profile's owner/manager account** → GBP tab → “Flow A —
   connect existing profile” → your real location appears → manage it:
   - read info + performance + keywords (autonomous reads),
   - AI-rewrite description → Propose update → Approvals tab → Approve → confirm the
     edit on Google Maps/Search,
   - reply to a real review via AI draft → propose → approve → confirm on Maps,
   - publish a post → confirm it renders on the profile.
6. **Real Flow B test** — ONLY with a real business you control (never a fake
   listing): GBP tab → Flow B wizard → approve creation → pick the verification
   method Google offers → PIN in-console, or the video handoff if that's all Google
   offers → wait for `verified` → manage it.

## Stage 3 — Ads real-mode (start immediately; Basic-access wait runs in parallel)

1. **Create the MCC**: [ads.google.com manager account signup](https://ads.google.com/home/tools/manager-accounts/)
   with the operator account. Note the 10-digit ID (no dashes) → `ADS_MCC_CUSTOMER_ID`.
2. **Developer token**: in the MCC → Tools & settings → **API Center** → accept terms →
   token appears → `ADS_DEVELOPER_TOKEN`. It starts at *Test-account* access;
   Google auto-upgrades eligible tokens to **Explorer** (production, 2,880 ops/day)
   within days.
3. **Apply for Basic access NOW** (same API Center page → access level → apply).
   Needed for Flow B provisioning + keyword planning. Currently backlogged: budget
   2–6 weeks. The application asks how you use the API — describe the tool honestly
   (campaign creation/management for client accounts under your manager account,
   with human approval gates).
4. **Mint the MCC operator refresh token** (`ADS_MCC_REFRESH_TOKEN`) via
   [OAuth Playground](https://developers.google.com/oauthplayground):
   gear icon → “Use your own OAuth credentials” → paste your client ID/secret →
   in Step 1 enter scope `https://www.googleapis.com/auth/adwords` → Authorize
   **signing in as the MCC admin user** → Step 2 “Exchange authorization code for
   tokens” → copy the **refresh_token** → `.env`.
5. **Payments profile**: MCC → Billing → set up the company payments profile (card).
   This is the interim “we pay” instrument reused across merchant accounts.
6. Restart the server — `/api/system/status` shows `ads.mccConfigured: true` and the
   Ads gateway leaves stub mode.

**Testing ladder (matches token access level):**

7. **Test accounts (day 1, zero risk):** in API Center, create a **test manager
   account** + test client accounts. Point `ADS_MCC_CUSTOMER_ID` at the *test* MCC.
   Everything works against test accounts with any token — provision (Flow B),
   launch, edit. Test accounts never serve ads or spend money (metrics stay zero —
   the TCPL loop is only meaningfully testable in stub or with real spend).
8. **Explorer (production, ~days):** point `ADS_MCC_CUSTOMER_ID` back at the real
   MCC. Flow A works end-to-end: link a real existing Ads account (invitation appears
   in that account's UI → accept) → structure reads → campaign management.
   Flow B provisioning will return the typed access-level error — expected until Basic.
9. **Basic access granted:** Flow B provisions real accounts. For each: complete the
   **manual billing step** — Ads UI → that account → Billing → link the company
   payments profile — then click **“Mark billing done”** in the console (launches are
   refused until then).
10. **First real ad (small money):** before launching, `PUBLIC_BASE_URL` must be a
    real **HTTPS** domain (deploy the server or at least expose it publicly —
    Google disapproves localhost final URLs). Then: campaign builder → your real
    WhatsApp Business number → AI budget with tight caps (e.g. ₹150/day ceiling,
    ₹2,000 monthly cap) → propose → approve → live. Verify: ad serves → tap it →
    WhatsApp opens with your prefill → lead appears in insights → CPL computes →
    “Run TCPL check”.

## Stage 4 — before external users (not needed for your own testing)

- Submit **OAuth app verification** (consent screen → Publish) — 2–6 weeks review of
  both sensitive scopes.
- Consider **Standard access** (Ads) when nearing 15k ops/day.
- Revisit: Opteo client vs REST internals for the Ads gateway; message-asset
  allowlist; pin/bump of Ads API version `v23` against the current sunset schedule.

## Env quick reference

| Variable | Unlocks | From |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Real OAuth (both modules) | Stage 1.4 |
| `TOKEN_ENC_KEY`, `DATABASE_URL`, `OPENAI_API_KEY` | Persistence + real AI | Stage 0 |
| *(GBP quota approval — no env var)* | Real GBP API calls | Stage 2.2–2.4 |
| `ADS_DEVELOPER_TOKEN` | Ads API | Stage 3.2 |
| `ADS_MCC_CUSTOMER_ID` | Which MCC (test vs real) | Stage 3.1 / 3.7 |
| `ADS_MCC_REFRESH_TOKEN` | MCC-authorized operations | Stage 3.4 |
| `PUBLIC_BASE_URL` (HTTPS, public) | Real ad final URLs (`/r/:slug`) | Stage 3.10 |
