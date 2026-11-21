create table chat_send_settings (
  config_id smallint primary key check (config_id = 1),
  enabled boolean not null,
  version bigint not null check (version >= 0),
  updated_at timestamptz not null,
  updated_by uuid references admin_operator(operator_id),
  updated_by_username varchar(255),
  reason varchar(500),
  check ((updated_by is null) = (updated_by_username is null))
);

insert into chat_send_settings(config_id,enabled,version,updated_at)
values (1,true,0,now());

create table admin_chat_settings_command (
  operator_id uuid not null references admin_operator(operator_id),
  idempotency_key uuid not null,
  fingerprint varchar(64) not null,
  result_json text not null,
  created_at timestamptz not null,
  primary key(operator_id,idempotency_key)
);
