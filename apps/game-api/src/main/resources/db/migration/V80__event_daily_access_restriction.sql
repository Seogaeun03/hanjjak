alter table event_lifecycle_config
  add column daily_restriction_enabled boolean not null default false,
  add column daily_restriction_starts_at time,
  add column daily_restriction_ends_at time,
  add column daily_restriction_reconciled_for date,
  add column daily_restriction_applied_at timestamptz,
  add constraint event_daily_restriction_window check (
    (not daily_restriction_enabled and daily_restriction_starts_at is null and daily_restriction_ends_at is null)
    or
    (daily_restriction_enabled and daily_restriction_starts_at is not null and daily_restriction_ends_at is not null
      and daily_restriction_starts_at <> daily_restriction_ends_at)
  );
