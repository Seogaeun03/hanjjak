-- 얼굴 자리가 늘었다. 볼터치·오드아이·안경이 이 한 자리를 두고 다툰다.
-- 자리 이름을 적어 둔 검사에 얼굴이 없어, 얼굴 치장을 입히면 쓰기가 막혔다.
alter table cosmetic_equipment drop constraint if exists cosmetic_equipment_slot_check;
alter table cosmetic_equipment add constraint cosmetic_equipment_slot_check
  check (slot in ('HEAD','FACE','TOP','BOTTOM','GLOVES','SHOES','CAPE'));
