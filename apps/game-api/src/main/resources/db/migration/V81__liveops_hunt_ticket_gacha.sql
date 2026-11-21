-- 라이브 이벤트: 접속 티켓 경품 뽑기.
--
-- 티켓은 인벤토리 아이템이 아니다. 치장 뽑기권과 같은 계정 재화라 슬롯을 점유하지 않는다.
-- 기간 한정 아이템이 200칸 가방을 먹는 쪽이 더 나쁘다.

-- 적립 진행. 날짜(KST)마다 한 행이라 일일 상한이 행 단위로 닫힌다.
create table liveops_ticket_accrual (
  event_id varchar(80) not null,
  account_id uuid not null references account(id) on delete cascade,
  kst_date date not null,
  accrued_seconds bigint not null default 0 check (accrued_seconds >= 0),
  granted_today bigint not null default 0 check (granted_today >= 0),
  last_tick_at timestamptz not null,
  primary key(event_id, account_id, kst_date)
);

create table liveops_ticket_balance (
  event_id varchar(80) not null,
  account_id uuid not null references account(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  primary key(event_id, account_id)
);

-- 뽑기 결과와 멱등. command_id 유니크가 같은 요청의 재시도를 한 결과로 묶는다.
create table liveops_draw (
  draw_id uuid primary key,
  event_id varchar(80) not null,
  account_id uuid not null references account(id) on delete cascade,
  command_id uuid not null,
  content_version varchar(80) not null,
  result_json jsonb not null,
  drawn_at timestamptz not null,
  unique(event_id, account_id, command_id)
);

create index liveops_draw_event_drawn_idx on liveops_draw(event_id, drawn_at desc, draw_id desc);

-- 경품 재고. claimed <= total 을 제약으로 못 박아, 코드가 실수해도 초과 당첨이 저장되지 않는다.
create table liveops_prize_stock (
  event_id varchar(80) not null,
  prize_id varchar(120) not null,
  total bigint not null check (total >= 0),
  claimed bigint not null default 0 check (claimed >= 0),
  primary key(event_id, prize_id),
  check (claimed <= total)
);

-- 당첨 로그와 운영 처리 상태. (event_id, prize_id, account_id) 유니크가 계정당 1회의 최종 방어선이다.
--
-- draw_id 외래키는 deferrable 이다. 10연차 안에서 당첨이 나오면 뽑기 행보다 당첨 행이 먼저
-- 들어가야 다음 회차가 그 당첨을 보고 쌀로 대체한다. 커밋 시점에만 검사하면 순서와 무결성을
-- 둘 다 지킬 수 있다.
create table liveops_prize_win (
  win_id uuid primary key,
  event_id varchar(80) not null,
  prize_id varchar(120) not null,
  account_id uuid not null references account(id) on delete cascade,
  draw_id uuid not null references liveops_draw(draw_id) deferrable initially deferred,
  status varchar(16) not null default 'PENDING' check (status in ('PENDING','CONTACTED','FULFILLED','VOIDED')),
  operator_note varchar(500),
  won_at timestamptz not null,
  updated_at timestamptz not null,
  unique(event_id, prize_id, account_id)
);

create index liveops_prize_win_event_status_idx on liveops_prize_win(event_id, status, won_at desc);

-- 비상정지. 이벤트 코드에 문제가 생겼을 때 배포 없이 빠져나갈 유일한 길이다.
create table liveops_switch (
  event_id varchar(80) primary key,
  halted boolean not null default false,
  halted_reason varchar(500),
  updated_at timestamptz not null default now(),
  updated_by varchar(120)
);
