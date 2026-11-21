alter table character
  add column if not exists nickname_change_count integer not null default 0
  check (nickname_change_count >= 0);
