create table event_lifecycle_config (
  config_id smallint primary key check (config_id = 1),
  starts_at timestamptz,
  ends_at timestamptz,
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references admin_operator(operator_id),
  updated_by_username varchar(255),
  reason varchar(500),
  reconciled_version bigint not null default -1,
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

insert into event_lifecycle_config(config_id) values (1);

create table event_lifecycle_command (
  operator_id uuid not null references admin_operator(operator_id),
  idempotency_key uuid not null,
  fingerprint varchar(64) not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (operator_id, idempotency_key)
);
