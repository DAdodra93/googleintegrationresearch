-- SaaS auth: platform users + user↔merchant bindings

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  role text not null check (role in ('operator','merchant')),
  created_at timestamptz not null default now()
);

create table if not exists user_merchants (
  user_id uuid not null references users(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  primary key (user_id, merchant_id)
);
