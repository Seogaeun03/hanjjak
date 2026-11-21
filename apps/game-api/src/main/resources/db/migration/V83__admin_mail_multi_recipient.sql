-- 관리자 메시지·보상 한 건을 여러 지정 계정에 보낼 수 있게 한다.
-- 기존 ACCOUNT 발송은 원본 대상 한 명을 매핑 행으로 옮겨 예약 발송 호환성을 유지한다.
create table admin_mail_send_recipient (
  send_id uuid not null references admin_mail_send(send_id) on delete cascade,
  account_id uuid not null references account(id),
  primary key (send_id, account_id)
);

insert into admin_mail_send_recipient(send_id, account_id)
select send_id, target_account_id
from admin_mail_send
where target_mode = 'ACCOUNT' and target_account_id is not null
on conflict do nothing;

alter table admin_mail_send drop constraint if exists admin_mail_send_target_mode_check;
alter table admin_mail_send drop constraint if exists admin_mail_send_check;
alter table admin_mail_send
  add constraint admin_mail_send_target_mode_check check (target_mode in ('ALL','ACCOUNT','ACCOUNTS')),
  add constraint admin_mail_send_target_shape_check check (
    (target_mode = 'ALL' and target_account_id is null) or
    (target_mode = 'ACCOUNT' and target_account_id is not null) or
    (target_mode = 'ACCOUNTS' and target_account_id is null)
  );

create index admin_mail_send_recipient_account_idx
  on admin_mail_send_recipient(account_id, send_id);
