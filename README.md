# Google Growth Engine

Self-contained backend + test console proving full **Google Business Profile** and
**Google Ads** capabilities as two fully independent modules, for later lift into a
separate product as an integration.

- GBP module: connect/manage existing profiles (info, posts, media, reviews,
  performance, AI rewrite) + guided net-new creation & verification.
- Ads module: link or provision accounts under our MCC, full-surface campaign
  configuration, AI-proposed budgets with hard ceilings, propose-then-approve
  publishing, insights, and a target-cost-per-lead optimization loop. Initial
  objective: funnel leads to WhatsApp / Instagram DM.
- Direct Google APIs only; AI layer is provider-swappable (OpenAI-family default);
  interim "we-fund-spend" billing behind an abstraction; multi-tenant from day one.

## Status

**Phase 1 complete — at STOP gate, awaiting operator approval.**

| Phase | Deliverable | State |
|---|---|---|
| 0 | [Research refresh](docs/PHASE0-RESEARCH.md) + [prerequisite checklist](docs/PHASE0-PREREQUISITES.md) | ✅ approved |
| 1 | [Shared foundation & auth](docs/PHASE1-FOUNDATION.md) (stub-first) | ✅ awaiting approval |
| 2 | GBP module (Flows A + B) | — |
| 3 | Ads module (Flows A + B) | — |
| 4 | E2E test harness + approval queue | — |
