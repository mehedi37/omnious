-- Device codes table for Device Flow OAuth (CLI authentication)
-- Replaces the in-memory Map<string, DeviceCodeEntry> for production resilience.

create table if not exists public.device_codes (
  device_code  text        primary key,
  user_code    text        not null unique,
  status       text        not null default 'pending'
                           check (status in ('pending', 'authorized', 'expired')),
  expires_at   timestamptz not null,
  poll_interval int        not null default 5,
  access_token text,
  refresh_token text,
  user_email   text,
  created_at   timestamptz not null default now()
);

-- Index for user_code lookup (the browser authorization flow searches by user_code)
create index if not exists idx_device_codes_user_code on public.device_codes (user_code);

-- Index for cleanup of expired rows
create index if not exists idx_device_codes_expires_at on public.device_codes (expires_at);

-- RLS: device_codes is server-managed only (service_role key).
alter table public.device_codes enable row level security;

-- Note: expired rows are cleaned up by the backend on each poll/request.
-- For production with pg_cron, add a scheduled job to purge stale rows.
