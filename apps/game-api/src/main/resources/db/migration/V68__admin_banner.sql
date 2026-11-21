-- 운영자가 올리는 상단 배너.
--
-- 공지(admin_notice)와는 일부러 따로 둔다. 공지는 우편함 알림 탭에 쌓여 나중에 읽는
-- 글이고, 배너는 지금 화면을 보고 있는 사람에게 한 줄로 끼어드는 알림이다. 같은 표에
-- 담고 칸으로 구분하면 "알림 탭에는 남기지 말고 배너로만" 같은 운영이 불가능해진다.
--
-- 배너는 공지와 달리 노출 종료가 필수다. 끝이 없는 배너는 모든 화면 위에 영원히 붙는데,
-- 그걸 내리는 길이 운영자의 기억밖에 없게 된다.

create table admin_banner (
  banner_id uuid primary key,
  message varchar(200) not null,
  tone varchar(16) not null check (tone in ('INFO', 'EVENT', 'WARNING')),
  operator_id uuid not null references admin_operator(operator_id),
  published_at timestamptz not null,
  expires_at timestamptz not null,
  -- 잘못 올린 배너를 기간이 끝나기 전에 내리는 칸. 행은 지우지 않는다. 무엇이 떠 있었는지는
  -- 남아야 하고, 이미 닫은 사람의 행이 참조하고 있기도 하다.
  revoked_at timestamptz,
  reason varchar(500) not null,
  created_at timestamptz not null,
  check (expires_at > published_at)
);

-- 읽는 쪽은 언제나 "지금 열려 있는 배너"만 찾는다.
create index admin_banner_window_idx on admin_banner(expires_at desc, banner_id desc);

-- 닫은 사람의 화면에서만 사라진다. 배너 원본은 그대로 남아 아직 안 본 사람에게 계속 보인다.
create table admin_banner_dismissal (
  banner_id uuid not null references admin_banner(banner_id) on delete cascade,
  account_id uuid not null references account(id) on delete cascade,
  dismissed_at timestamptz not null,
  primary key (banner_id, account_id)
);

create index admin_banner_dismissal_account_idx on admin_banner_dismissal(account_id);
