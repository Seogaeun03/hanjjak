-- 신화 장비 등급을 저장할 수 있게 한다. 콘텐츠(progression-rebalance-v1)는 전설→신화 승급을 열었지만
-- V24의 등급 제약이 LEGENDARY에서 끝나 승급 UPDATE가 제약 위반으로 실패했다.
alter table equipment_slot_state drop constraint equipment_slot_state_grade_check;

alter table equipment_slot_state add constraint equipment_slot_state_grade_check
  check (grade in ('NORMAL','RARE','EPIC','LEGENDARY','MYTHIC'));
