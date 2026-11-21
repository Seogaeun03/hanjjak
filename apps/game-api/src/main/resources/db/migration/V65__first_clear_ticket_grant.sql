-- 최초 클리어 보상이 치장 뽑기권을 준다. 쌀과 같이 지갑(character.cosmetic_ticket_balance)
-- 으로 들어가므로 가방 칸을 쓰지 않는다. 지급 원장에도 쌀과 나란히 기록해 둔다.
alter table stage_first_clear_reward
  add column tickets_granted bigint not null default 0 check (tickets_granted >= 0);
