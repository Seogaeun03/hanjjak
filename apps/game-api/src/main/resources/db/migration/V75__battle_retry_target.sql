/*
 * 판을 못 깨면 앞 판에서 경험치를 한 판 벌고 실패한 판으로 돌아간다. 돌아갈 판을
 * 여기 적어 두므로, 앞 판마저 못 깨도 더 아래로 미끄러지지 않는다.
 *
 * 칸 추가와 제약을 한 문장에 둬서 테이블 잠금을 한 번만 잡는다. 판 번호 자리가 10 까지인 것은
 * 일부러다. 보스 판(X-10)은 돌아갈 판이 될 수 있지만 반복 판은 될 수 없어서 V69 와 다르다.
 */
alter table account_runtime_state
  add column retry_stage_id varchar(32),
  add constraint account_runtime_state_retry_stage_format
  check (retry_stage_id is null or retry_stage_id ~ '^stage\.(0[1-9]|10)-(0[1-9]|10)$');
