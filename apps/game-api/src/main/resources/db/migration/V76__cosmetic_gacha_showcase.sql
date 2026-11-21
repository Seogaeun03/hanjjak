create table cosmetic_gacha_showcase_config (
  config_id smallint primary key check (config_id = 1),
  selected_set_ids jsonb not null,
  version bigint not null check (version >= 1),
  updated_by uuid references admin_operator(operator_id),
  updated_at timestamptz not null,
  reason varchar(500) not null,
  check (jsonb_typeof(selected_set_ids) = 'array' and jsonb_array_length(selected_set_ids) > 0)
);

create table admin_cosmetic_showcase_command (
  operator_id uuid not null references admin_operator(operator_id),
  idempotency_key uuid not null,
  fingerprint varchar(64) not null,
  result_json jsonb not null,
  created_at timestamptz not null,
  primary key (operator_id, idempotency_key)
);

insert into cosmetic_gacha_showcase_config(
  config_id, selected_set_ids, version, updated_by, updated_at, reason
) values (
  1,
  '["sushi","mage","cotton-painter","moon-rabbit","white-fox-spirit","magical-girl"]'::jsonb,
  1,
  null,
  now(),
  '초기 치장 뽑기 소개 세트'
);
