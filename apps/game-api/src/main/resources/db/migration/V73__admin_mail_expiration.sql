-- 관리자 메시지·보상에도 공지와 같은 선택적 노출 종료 시각을 둔다.
-- null 은 무기한이며, 기존 캠페인은 동작을 바꾸지 않도록 null 로 남긴다.

alter table admin_mail_send
  add column expires_at timestamptz;

create index admin_mail_send_window_idx
  on admin_mail_send(published_at, expires_at, send_id);
