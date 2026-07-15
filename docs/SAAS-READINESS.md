# SaaS Readiness — customers sign in, link Google, manage their own Ads & GBP

Added after Phase 2 at operator request. Verdict and what changed.

## What now works as a SaaS (implemented + tested)

- **Self-serve signup/login** (`/api/auth/*`): email + password (scrypt-hashed),
  signed-cookie sessions (7-day HMAC tokens, HttpOnly/SameSite=Lax), business
  created at signup. Console shows a sign-in/sign-up screen before anything else.
- **Roles:** `operator` (you/your team — first signup bootstraps it; `OPERATOR_EMAILS`
  grants it thereafter) and `merchant` (your customers).
- **Tenant isolation, enforced server-side on every route:** a customer sees and
  touches only their own merchants, connections, GBP profiles, Ads accounts,
  campaigns, insights, and approvals. Cross-tenant access returns 403 (covered by
  dedicated tests, including OAuth-start, insights, and approval-decision attempts).
- **Approval rights split:** customers approve their own content/campaign actions
  (their profile edits, their launches — their money, their call). Actions that
  spend PLATFORM money or are platform ops are **operator-only**:
  `ads.account.provision` and the interim-billing “mark funded” confirmation.
  Customers see those as “pending (platform team)”.
- **Per-customer Google linking** was already per-merchant OAuth — each customer
  connects their own Google account per module; tokens encrypted per merchant.
- **Public surfaces kept public:** `/r/:slug` lead redirects (ad clicks are
  anonymous) and OAuth callbacks (authenticated by the signed `state`).
- Dev/diagnostic routes and the audit feed are operator-only.

35/35 tests pass, including 5 new multi-tenant isolation tests.

## Hard limits Google imposes (cannot be coded away) — know these before launch

1. **OAuth app verification (Google review, 2–6 weeks).** Until your consent screen
   passes verification, only ≤100 allowlisted **test users** can complete the Google
   OAuth linking. Fine for pilots; verification is mandatory before general signup.
2. **GBP API quota approval** gates ALL customers' GBP features (it's per-platform,
   ~300 QPM shared). One approval covers everyone, but until it lands the GBP module
   only works in stub mode. At scale, request quota increases via the same channel.
3. **Ads developer-token tier** gates features platform-wide: Explorer (automatic) =
   manage/link/report on production accounts; **Basic (application, backlogged) is
   required for provisioning new customer accounts (Flow B)** and keyword planning;
   Standard for >15k ops/day.
4. **Interim billing has a manual step per we-funded account** — attaching your
   payments profile happens in the Google Ads UI only (~2 min per customer account,
   your ops team). The API-automated alternative is the deferred consolidated-
   invoicing model (needs a Google credit line). This is a Google constraint, not a
   code gap — the state machine tracks it explicitly.
5. **Net-new GBP verification is Google-controlled**: PIN methods complete
   in-product; when Google offers **video-only** (common for new listings), the
   customer must finish in Google's own app/UI — we hand off and poll. No API can
   bypass this.
6. **Ads Flow A link acceptance** happens in the customer's own Google Ads UI (they
   accept your MCC invitation there). Potential future enhancement: accept via API
   using the customer's own OAuth token where they have admin rights.

## Recommended before real customer traffic (not blocking your own testing)

- Serve over HTTPS with a real domain (also required for real ad final URLs) and
  set cookie `Secure`.
- Rate-limit `/api/auth/*`; add password reset (email); consider Google Sign-In as
  a login option (separate from the module-scoped OAuth connects).
- Real production UI polish — the console is a functional test console by design.
- Legal: your ToS must reflect that you manage customers' Google assets on their
  behalf, and Google Ads API Terms + RMF apply to your tool.
