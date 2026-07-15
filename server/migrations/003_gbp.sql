-- GBP module tables (module-owned; prefixed gbp_)

create table if not exists gbp_profiles (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  flow text not null check (flow in ('existing','created')),
  account_name text,          -- accounts/{id} (owner account context; needed for v4 paths)
  location_name text,         -- locations/{id}
  title text not null,
  status text not null default 'draft'
    check (status in ('draft','create_proposed','created','verification_pending','verified','connected','error')),
  prefill jsonb,              -- Flow B: AI-prefilled location payload awaiting create
  verification jsonb,         -- { method, verificationName, state, note }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gbp_profiles_merchant_idx on gbp_profiles (merchant_id);
