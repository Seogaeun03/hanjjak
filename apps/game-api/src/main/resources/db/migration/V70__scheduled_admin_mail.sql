-- 관리자 메시지·보상을 공지처럼 예약하고, 게시 뒤 가입한 계정도 받을 수 있게 한다.
--
-- admin_mail_send 가 발송 원본을 소유하고 mail_message 는 계정별 읽음·삭제·수령 상태만
-- 소유한다. 대상 계정이 메시지함을 조회할 때 아직 없는 개인 행을 한 번만 만든다.

alter table admin_mail_send
  add column body text,
  add column sender_name varchar(120),
  add column published_at timestamptz;

-- 기존 발송 원본은 이미 만들어진 개인 우편에서 본문과 발신자를 복원한다.
update admin_mail_send send
set body = coalesce((
      select mail.body from mail_message mail
      where mail.send_id = send.send_id
      order by mail.created_at, mail.mail_id limit 1
    ), ''),
    sender_name = coalesce((
      select mail.sender_name from mail_message mail
      where mail.send_id = send.send_id
      order by mail.created_at, mail.mail_id limit 1
    ), '운영자'),
    published_at = send.created_at;

-- 수신자가 한 명도 없었던 과거 이력도 안전한 기본값으로 보존한다.
update admin_mail_send
set body = coalesce(body, ''),
    sender_name = coalesce(sender_name, '운영자'),
    published_at = coalesce(published_at, created_at);

alter table admin_mail_send
  alter column body set not null,
  alter column sender_name set not null,
  alter column published_at set not null;

create index admin_mail_send_publish_idx
  on admin_mail_send(published_at, send_id);

-- 조회와 예약 시각 도달이 겹쳐도 계정별 캠페인 우편은 한 통만 생긴다.
create unique index mail_message_admin_send_account_uq
  on mail_message(send_id, account_id)
  where send_id is not null;
