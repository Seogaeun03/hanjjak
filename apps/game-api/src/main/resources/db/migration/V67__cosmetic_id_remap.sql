-- 치장 개편에서 ID 를 다시 매기면서 중간에 항목이 끼어들어, 옛 ID 가 가리키던 물건이
-- 통째로 바뀌었다. DB 에는 'cosmetic-025' 같은 문자열만 두므로 외래키도 걸리지 않고
-- 없는 행도 생기지 않는다. 조용히 다른 치장이 된다. 그래서 유저에게는 갖고 있던 것이
-- 사라지고 없던 것이 생긴 것처럼 보였다.
--
-- 짝은 번호 산술이 아니라 (세트, 부위) 로 맞췄다. 밀린 폭이 구간마다 -1 부터 +32 까지
-- 제각각이라 번호로는 맞출 수 없다. 자리가 그대로인 열여덟 종은 아예 뺐다.

-- 되돌릴 자리를 먼저 떠 둔다. 이 두 표가 있으면 적용 뒤에 무엇이 얼마나 바뀌었는지
-- 대조할 수 있고, 잘못되면 그대로 복구할 수 있다.
create table cosmetic_collection_state_premap_backup as
  select * from cosmetic_collection_state;
create table cosmetic_equipment_premap_backup as
  select * from cosmetic_equipment;

-- 폐기된 간호사 여섯 종(옛 019~024)은 지우지 않는다. 그 번호는 새 콘텐츠에서 얼굴 치장과
-- 악마 머리가 쓰고 있어서, 문자열만 보고는 "옛 간호사"인지 "배포 뒤 정상으로 받은 새 치장"인지
-- 가릴 수 없다. 지우면 멀쩡한 치장이 날아간다. 간호사는 배포된 적이 없어 남은 행도 없을 것이고,
-- 혹 있더라도 아래에서 수량이 합쳐질 뿐 없어지지는 않는다.


-- 옛 행과 새 행은 문자열만으로는 못 가린다. 배포 뒤 뽑은 치장도 025~066 번대에 정상으로
-- 들어오기 때문이다. 그래서 감사 로그를 본다. 치장 명령은 전부 어느 콘텐츠 버전에서
-- 돌았는지를 남긴다.
--
--   v7 이력이 없는 계정 : 가진 것이 전부 개편 전 것이다. 통째로 옮겨도 안전하다.
--   v7 이력이 있는 계정 : 옛 것과 새 것이 한 행에 섞여 있을 수 있다. 손대지 않고 따로 적어 둔다.
--
-- 섞인 계정은 감사 로그를 되짚어 하나씩 봐야 한다. 여기서 뭉뚱그려 옮기면 배포 뒤에 뽑은
-- 치장이 엉뚱한 것으로 바뀐다.
create temporary table cosmetic_remap_targets on commit drop as
  select distinct s.account_id
    from cosmetic_collection_state s
   where not exists (
     select 1 from cosmetic_audit_event e
      where e.account_id = s.account_id
        and e.content_version = 'cosmetics-v7-art-overhaul')
     -- 감사 로그를 남기는 것은 뽑기뿐이다. 등록·착용·상자 열기는 기록이 없다. 그래서 로그에만
     -- 기대면 상자를 연 계정을 놓친다. 옛 콘텐츠는 066 번까지였으니 067 번 이후를 가졌다면
     -- 그것만으로 배포 뒤에 얻었다는 증거다. 선택 상자가 주는 전설도 전부 075 번 이후다.
     and not exists (
       select 1 from cosmetic_collection_state v
        where v.account_id = s.account_id
          and v.cosmetic_id > 'cosmetic-066');

-- 손봐야 할 계정만 적는다. 개편 전에도 쓰고 배포 뒤에도 쓴 계정이라야 한 행에 옛것과
-- 새것이 섞인다. 배포 뒤에 들어온 계정은 애초에 옮길 것이 없으므로 여기 넣지 않는다.
create table cosmetic_remap_skipped_accounts as
  select distinct s.account_id, now() as recorded_at
    from cosmetic_collection_state s
   where (exists (select 1 from cosmetic_audit_event e
                   where e.account_id = s.account_id and e.content_version = 'cosmetics-v7-art-overhaul')
          or exists (select 1 from cosmetic_collection_state v
                      where v.account_id = s.account_id and v.cosmetic_id > 'cosmetic-066'))
     and exists (select 1 from cosmetic_audit_event e
                  where e.account_id = s.account_id and e.content_version <> 'cosmetics-v7-art-overhaul');

create temporary table cosmetic_id_remap(
  old_id varchar(80) primary key,
  new_id varchar(80) not null
) on commit drop;

insert into cosmetic_id_remap(old_id, new_id) values
  ('cosmetic-025','cosmetic-024'), -- 악마 HEAD
  ('cosmetic-026','cosmetic-025'), -- 악마 TOP
  ('cosmetic-027','cosmetic-026'), -- 악마 BOTTOM
  ('cosmetic-028','cosmetic-027'), -- 악마 GLOVES
  ('cosmetic-029','cosmetic-028'), -- 악마 SHOES
  ('cosmetic-030','cosmetic-029'), -- 악마 CAPE
  ('cosmetic-031','cosmetic-030'), -- 천사 HEAD
  ('cosmetic-032','cosmetic-031'), -- 천사 TOP
  ('cosmetic-033','cosmetic-032'), -- 천사 BOTTOM
  ('cosmetic-034','cosmetic-033'), -- 천사 GLOVES
  ('cosmetic-035','cosmetic-034'), -- 천사 SHOES
  ('cosmetic-036','cosmetic-035'), -- 천사 CAPE
  ('cosmetic-037','cosmetic-036'), -- 거북이 수호자 HEAD
  ('cosmetic-038','cosmetic-037'), -- 거북이 수호자 TOP
  ('cosmetic-039','cosmetic-038'), -- 거북이 수호자 BOTTOM
  ('cosmetic-040','cosmetic-039'), -- 거북이 수호자 GLOVES
  ('cosmetic-041','cosmetic-040'), -- 거북이 수호자 SHOES
  ('cosmetic-042','cosmetic-041'), -- 거북이 수호자 CAPE
  ('cosmetic-043','cosmetic-054'), -- 요리사 HEAD
  ('cosmetic-044','cosmetic-055'), -- 요리사 TOP
  ('cosmetic-045','cosmetic-056'), -- 요리사 BOTTOM
  ('cosmetic-046','cosmetic-057'), -- 요리사 GLOVES
  ('cosmetic-047','cosmetic-058'), -- 요리사 SHOES
  ('cosmetic-048','cosmetic-059'), -- 요리사 CAPE
  ('cosmetic-049','cosmetic-081'), -- 마법사 HEAD
  ('cosmetic-050','cosmetic-082'), -- 마법사 TOP
  ('cosmetic-051','cosmetic-083'), -- 마법사 BOTTOM
  ('cosmetic-052','cosmetic-084'), -- 마법사 GLOVES
  ('cosmetic-053','cosmetic-085'), -- 마법사 SHOES
  ('cosmetic-054','cosmetic-086'), -- 마법사 CAPE
  ('cosmetic-055','cosmetic-060'), -- 약과 HEAD
  ('cosmetic-056','cosmetic-061'), -- 약과 TOP
  ('cosmetic-057','cosmetic-062'), -- 약과 BOTTOM
  ('cosmetic-058','cosmetic-063'), -- 약과 GLOVES
  ('cosmetic-059','cosmetic-064'), -- 약과 SHOES
  ('cosmetic-060','cosmetic-065'), -- 약과 CAPE
  ('cosmetic-061','cosmetic-075'), -- 스시야 HEAD
  ('cosmetic-062','cosmetic-076'), -- 스시야 TOP
  ('cosmetic-063','cosmetic-077'), -- 스시야 BOTTOM
  ('cosmetic-064','cosmetic-078'), -- 스시야 GLOVES
  ('cosmetic-065','cosmetic-079'), -- 스시야 SHOES
  ('cosmetic-066','cosmetic-080'); -- 스시야 CAPE

-- 옮길 행을 먼저 떠 둔다. 곧바로 갱신하면 옛 ID 와 새 ID 의 범위가 겹쳐
-- (025 -> 024, 026 -> 025 처럼) 기본키가 도중에 부딪힌다.
create temporary table cosmetic_collection_state_moved on commit drop as
  select s.account_id,
         r.new_id as cosmetic_id,
         s.registered_quantity,
         s.unregistered_quantity,
         s.reserved_quantity
    from cosmetic_collection_state s
    join cosmetic_id_remap r on r.old_id = s.cosmetic_id
    join cosmetic_remap_targets t on t.account_id = s.account_id;

delete from cosmetic_collection_state s
  using cosmetic_id_remap r, cosmetic_remap_targets t
  where r.old_id = s.cosmetic_id and t.account_id = s.account_id;

-- 배포 뒤 새 ID 로 정상 기록된 행(그 사이 뽑은 것)은 덮어쓰지 않고 수량을 합친다.
insert into cosmetic_collection_state as t
    (account_id, cosmetic_id, registered_quantity, unregistered_quantity, reserved_quantity)
  select account_id, cosmetic_id, registered_quantity, unregistered_quantity, reserved_quantity
    from cosmetic_collection_state_moved
  on conflict (account_id, cosmetic_id) do update set
    registered_quantity   = t.registered_quantity   + excluded.registered_quantity,
    unregistered_quantity = t.unregistered_quantity + excluded.unregistered_quantity,
    reserved_quantity     = t.reserved_quantity     + excluded.reserved_quantity;

-- 착용 자리는 (계정, 부위) 가 기본키고 치장 ID 는 값일 뿐이라 그대로 바꾸면 된다.
-- 짝을 (세트, 부위) 로 맞췄으므로 부위가 바뀌는 일은 없다.
update cosmetic_equipment e
   set cosmetic_id = r.new_id
  from cosmetic_id_remap r, cosmetic_remap_targets t
 where r.old_id = e.cosmetic_id and t.account_id = e.account_id;
