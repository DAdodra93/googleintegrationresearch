create extension if not exists pgcrypto;

create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country_code text not null default 'IN',
  currency_code text not null default 'INR',
  created_at timestamptz not null default now()
);

create table if not exists google_connections (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  module text not null check (module in ('gbp','ads')),
  google_email text,
  refresh_token_enc text not null,
  scopes text[] not null,
  status text not null default 'active' check (status in ('active','revoked','error')),
  connected_at timestamptz not null default now(),
  unique (merchant_id, module)
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  module text not null check (module in ('gbp','ads')),
  action_type text not null,
  payload jsonb not null,
  summary text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','executed','failed')),
  proposed_by text not null default 'ai',
  decided_by text,
  decided_at timestamptz,
  executed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists approvals_status_idx on approvals (status, created_at desc);

create table if not exists account_funding (
  merchant_id uuid not null references merchants(id) on delete cascade,
  ads_customer_id text not null,
  model text not null check (model in ('interim','invoiced')),
  status text not null check (status in ('unfunded','pending_manual_billing_setup','funded')),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, ads_customer_id)
);

create table if not exists audit_log (
  id bigserial primary key,
  merchant_id uuid,
  module text,
  event text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
