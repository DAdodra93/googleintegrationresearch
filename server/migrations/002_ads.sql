-- Ads module tables (module-owned; prefixed ads_)

create table if not exists ads_accounts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  flow text not null check (flow in ('existing_linked','provisioned')),
  billing_mode text not null check (billing_mode in ('manage_only','we_pay_transfer','we_pay_provisioned')),
  customer_id text,                -- Google Ads customer ID (digits), null until provisioned
  link_status text not null default 'none'
    check (link_status in ('none','link_proposed','invited','active','provision_proposed','provision_pending','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ads_accounts_merchant_idx on ads_accounts (merchant_id);

create table if not exists ads_campaigns (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  ads_account_id uuid not null references ads_accounts(id) on delete cascade,
  ad_type text not null default 'search',
  name text not null,
  spec jsonb not null,             -- full SearchCampaignSpec (validated app-side)
  budget jsonb not null,           -- { dailyAmount, hardDailyCeiling, monthlyCap, targetCostPerLead, currency, proposedBy }
  lead_slug text unique,           -- S1 tracked-redirect slug
  status text not null default 'draft'
    check (status in ('draft','launch_proposed','launched','paused','archived')),
  google_refs jsonb,               -- resource names returned on launch
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ads_campaigns_merchant_idx on ads_campaigns (merchant_id);

create table if not exists ads_lead_events (
  id bigserial primary key,
  campaign_id uuid not null references ads_campaigns(id) on delete cascade,
  destination text not null,       -- resolved deep link (wa.me/… or ig.me/…)
  user_agent text,
  occurred_at timestamptz not null default now()
);
create index if not exists ads_lead_events_campaign_idx on ads_lead_events (campaign_id, occurred_at);

create table if not exists ads_tcpl_evaluations (
  id bigserial primary key,
  campaign_id uuid not null references ads_campaigns(id) on delete cascade,
  window_days int not null,
  spend numeric not null,
  leads int not null,
  cost_per_lead numeric,           -- null when leads = 0
  decision text not null,          -- ok | propose_raise_budget | propose_pause | propose_regenerate | emergency_pause
  detail jsonb,
  created_at timestamptz not null default now()
);
