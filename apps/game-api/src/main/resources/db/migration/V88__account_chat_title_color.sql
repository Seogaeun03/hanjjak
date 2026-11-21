-- 관리자 지정 채팅 칭호의 선택 색상. 기존 칭호는 null을 유지해 재료색으로 표시한다.
alter table account add column chat_title_color varchar(7);

alter table account add constraint account_chat_title_color_valid
  check (
    chat_title_color is null
    or (chat_title is not null and chat_title_color ~ '^#[0-9A-Fa-f]{6}$')
  );
