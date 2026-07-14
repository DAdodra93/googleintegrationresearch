# Ads module (Phase 3 — not yet built)

Fully independent module: usable with the GBP module absent. Owns its routes
(`/api/ads/...`), data models, and flow logic.

Will consume from core (shared infra ONLY):
- `GoogleAuthService.getAccessToken(merchantId, 'ads')` (merchant OAuth for
  Flow A link-invitations) + MCC credentials from config (`ADS_DEVELOPER_TOKEN`,
  `ADS_MCC_CUSTOMER_ID`) for manager-authorized operations
- `BillingProvider` — interim funding state per provisioned account
- `ApprovalService` — executors: `ads.campaign.launch`, `ads.campaign.edit`,
  `ads.budget.change`, `ads.account.link`, `ads.account.provision`
- `AiProvider` — budget proposals, ad copy, TCPL reasoning
- `Store` (module tables prefixed `ads_`)

Client: Opteo `google-ads-api` (Node). Access-level gates to respect:
Explorer blocks CreateCustomerClient / billing / keyword planning → those
paths stay stubbed until Basic access lands.

Pluggable seams (documented, unbuilt): ad-type registry (Search first; PMax /
Demand Gen / Local later), LeadDestination strategies S1–S4 (see
docs/PHASE0-RESEARCH.md §4), future channel-routing decision point.
