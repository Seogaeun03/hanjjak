alter table admin_gitlab_oauth_flow
  add column login_purpose varchar(16) not null default 'CONSOLE',
  add constraint admin_gitlab_oauth_flow_login_purpose_check
    check (login_purpose in ('CONSOLE', 'GAME'));

create table admin_game_account (
  operator_id uuid primary key references admin_operator(operator_id) on delete cascade,
  account_id uuid not null unique references account(id),
  created_at timestamptz not null
);
