-- 운영자(GM) 표시 권한.
--
-- 채팅에서 닉네임 앞에 GM 배지를 달아 줄 계정을 구분한다. 배지는 표시 전용이라
-- 게임 규칙이나 admin 콘솔 접근 권한(admin_operator)과는 별개다. 그래서 운영자 계정
-- 테이블을 참조하지 않고 게임 계정 자신의 속성으로 둔다.
--
-- 채팅 메시지 행에는 복사하지 않는다. GM 을 회수하면 과거 메시지의 배지도 함께
-- 사라져야 하므로, 읽는 시점에 account 를 조인해서 현재 값을 쓴다.
alter table account add column game_master boolean not null default false;
