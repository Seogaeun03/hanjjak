-- 관리자가 계정에 직접 부여하는 현재 채팅 칭호 하나.
-- 메시지에는 복사하지 않고 조회 시 account를 조인해 교체·해제가 과거 메시지에도 반영되게 한다.
alter table account add column chat_title varchar(10);

alter table account add constraint account_chat_title_valid
  check (chat_title is null or (char_length(chat_title) between 1 and 10 and chat_title = btrim(chat_title)));
