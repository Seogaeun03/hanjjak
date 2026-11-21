-- 관리자 공지(알림 탭)와 관리자 보상 우편(메시지 탭).
--
-- 공지는 원본 한 행만 두고 계정별로는 읽음·삭제 상태만 남긴다. 그래야 나중에 가입한
-- 사람도 노출 기간이 열려 있는 공지를 함께 본다. 우편은 반대로 발송 시점에 계정마다
-- 한 행씩 복제한다. 누가 무엇을 받아 갔는지는 그 사람의 행에 남아야 하기 때문이다.

create table admin_notice (
  notice_id uuid primary key,
  title varchar(120) not null,
  body text not null,
  sender_name varchar(120) not null,
  operator_id uuid not null references admin_operator(operator_id),
  published_at timestamptz not null,
  expires_at timestamptz,
  reason varchar(500) not null,
  created_at timestamptz not null,
  check (expires_at is null or expires_at > published_at)
);

create index admin_notice_window_idx on admin_notice(published_at desc, notice_id desc);

create table admin_notice_state (
  notice_id uuid not null references admin_notice(notice_id) on delete cascade,
  account_id uuid not null references account(id) on delete cascade,
  read_at timestamptz,
  deleted_at timestamptz,
  primary key(notice_id, account_id)
);

create index admin_notice_state_account_idx on admin_notice_state(account_id);

-- 우편에 제목·본문·읽음·삭제·보상 첨부를 더한다.
alter table mail_message
  add column title varchar(120),
  add column body text,
  add column sender_name varchar(120),
  add column read_at timestamptz,
  add column deleted_at timestamptz,
  add column rewards_json jsonb not null default '[]'::jsonb,
  add column send_id uuid,
  add column reward_status varchar(16) not null default 'PENDING';

-- claimed 은 "받을 것이 있는지"와 "받았는지"를 한 칸에 섞어 담고 있었다. 보상이 아예
-- 없는 안내 우편이 생기면서 셋을 구분해야 해서 상태 값으로 바꾼다.
update mail_message set reward_status = case when claimed then 'CLAIMED' else 'PENDING' end;

alter table mail_message
  add constraint mail_message_reward_status_check check (reward_status in ('NONE','PENDING','CLAIMED'));

-- claimed 와 그 인덱스는 아직 남겨 둔다.
--
-- 마이그레이션은 파드 교체보다 먼저 끝난다. 이 칸을 지금 지우면 아직 살아 있는 구버전이
-- 없는 칸을 읽고 쓰게 되고, 우편함뿐 아니라 거래소 체결의 정산 우편 insert 까지 실패한다.
-- 이미지를 되돌려도 스키마는 되돌아오지 않아 롤백도 막힌다.
--
-- 그래서 새 코드가 reward_status 와 함께 claimed 도 계속 채운다. 구버전이 모두 사라진
-- 다음 릴리스에서 이 칸과 인덱스를 지운다.

create index mail_message_reward_pending_idx
  on mail_message(account_id, created_at, mail_id)
  where reward_status = 'PENDING' and deleted_at is null;

create index mail_message_account_visible_idx
  on mail_message(account_id, created_at desc, mail_id desc)
  where deleted_at is null;

-- 발송 이력. 전체 발송 한 번이 수천 행을 만들어도 운영자에게는 한 줄로 보여야 한다.
create table admin_mail_send (
  send_id uuid primary key,
  operator_id uuid not null references admin_operator(operator_id),
  target_mode varchar(16) not null check (target_mode in ('ALL','ACCOUNT')),
  target_account_id uuid references account(id),
  title varchar(120) not null,
  rice_amount bigint not null check (rice_amount >= 0),
  rewards_json jsonb not null,
  recipient_count integer not null check (recipient_count >= 0),
  reason varchar(500) not null,
  created_at timestamptz not null,
  check ((target_mode = 'ACCOUNT') = (target_account_id is not null))
);

create index admin_mail_send_created_idx on admin_mail_send(created_at desc, send_id desc);

create table admin_message_command (
  operator_id uuid not null references admin_operator(operator_id),
  idempotency_key uuid not null,
  fingerprint varchar(64) not null,
  result_json text not null,
  created_at timestamptz not null,
  primary key(operator_id, idempotency_key)
);
