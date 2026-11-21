alter table account_runtime_state
  drop constraint account_runtime_state_repeat_stage_format;

alter table account_runtime_state
  add constraint account_runtime_state_repeat_stage_format
  check (repeat_stage_id is null or repeat_stage_id ~ '^stage\.(0[1-9]|10)-(0[1-9])$');
