-- V71은 감사 로그 합계가 실보유량과 한 ID라도 다르면 계정 전체를 건드리지 않고
-- cosmetic_remap_skipped_accounts에 남겼다. 10개 중 8개는 그렇게 자동 적용됐고,
-- 남은 2개 계정만 수동 검토 대상으로 남았다 (이슈 #44 후속 조사).
--
-- 08c60330-d2d0-4477-aa83-286f83516611: cosmetic-063 보유량이 뽑기 로그보다 1개 많다.
--   플레이어 문의로 확인한 결과 옛 스시야 하의(간판 개편 전에 뽑은 것)로 확인됐다. 뽑기
--   로그에 잡히지 않는 경로(정확한 출처는 못 찾음)로 지급된 것으로 보고, 이 1개를 legacy
--   획득분으로 취급해 정상적으로 새 자리(cosmetic-077)로 옮긴다. 별도로 치장 뽑기권 보상을
--   지급하기로 팀에서 결정했으며, 그 지급은 이 마이그레이션의 범위가 아니다.
-- 26b63120-8bf8-4a36-8791-a0164682cc40: cosmetic-080 보유량 1개가 뽑기 로그·보상 테이블
--   어디에도 없다. 이 번호(스시야 CAPE 새 자리)는 이 계정의 어떤 옛 ID의 목적지도 아니고
--   (그 목적지인 옛 066은 이미 v8 뽑기로만 채워진 깨끗한 행이라 이동시킬 게 없다), 옛/새
--   번호 충돌 문제와 무관한 별개의 출처불명 건이다. 원인을 못 찾았으므로 건드리지 않고
--   그대로 둔다 — 이 마이그레이션은 이 계정의 '충돌 사슬'만 고치고 cosmetic-080은 그대로
--   남긴다.

create table cosmetic_collection_state_v74_backup as
select state.*, now() as backed_up_at
  from cosmetic_collection_state state
 where state.account_id in (
   '08c60330-d2d0-4477-aa83-286f83516611',
   '26b63120-8bf8-4a36-8791-a0164682cc40'
 );

create table cosmetic_equipment_v74_backup as
select equipment.*, now() as backed_up_at
  from cosmetic_equipment equipment
 where equipment.account_id in (
   '08c60330-d2d0-4477-aa83-286f83516611',
   '26b63120-8bf8-4a36-8791-a0164682cc40'
 );

create temporary table cosmetic_id_remap_v74 (
  old_id varchar(80) primary key,
  new_id varchar(80) not null,
  old_slot varchar(16) not null,
  current_slot varchar(16) not null
) on commit drop;

insert into cosmetic_id_remap_v74(old_id,new_id,old_slot,current_slot) values
  ('cosmetic-025','cosmetic-024','HEAD','TOP'),
  ('cosmetic-026','cosmetic-025','TOP','BOTTOM'),
  ('cosmetic-027','cosmetic-026','BOTTOM','GLOVES'),
  ('cosmetic-028','cosmetic-027','GLOVES','SHOES'),
  ('cosmetic-029','cosmetic-028','SHOES','CAPE'),
  ('cosmetic-030','cosmetic-029','CAPE','HEAD'),
  ('cosmetic-031','cosmetic-030','HEAD','TOP'),
  ('cosmetic-032','cosmetic-031','TOP','BOTTOM'),
  ('cosmetic-033','cosmetic-032','BOTTOM','GLOVES'),
  ('cosmetic-034','cosmetic-033','GLOVES','SHOES'),
  ('cosmetic-035','cosmetic-034','SHOES','CAPE'),
  ('cosmetic-036','cosmetic-035','CAPE','HEAD'),
  ('cosmetic-037','cosmetic-036','HEAD','TOP'),
  ('cosmetic-038','cosmetic-037','TOP','BOTTOM'),
  ('cosmetic-039','cosmetic-038','BOTTOM','GLOVES'),
  ('cosmetic-040','cosmetic-039','GLOVES','SHOES'),
  ('cosmetic-041','cosmetic-040','SHOES','CAPE'),
  ('cosmetic-042','cosmetic-041','CAPE','HEAD'),
  ('cosmetic-043','cosmetic-054','HEAD','TOP'),
  ('cosmetic-044','cosmetic-055','TOP','BOTTOM'),
  ('cosmetic-045','cosmetic-056','BOTTOM','GLOVES'),
  ('cosmetic-046','cosmetic-057','GLOVES','SHOES'),
  ('cosmetic-047','cosmetic-058','SHOES','CAPE'),
  ('cosmetic-048','cosmetic-059','CAPE','HEAD'),
  ('cosmetic-049','cosmetic-081','HEAD','TOP'),
  ('cosmetic-050','cosmetic-082','TOP','BOTTOM'),
  ('cosmetic-051','cosmetic-083','BOTTOM','GLOVES'),
  ('cosmetic-052','cosmetic-084','GLOVES','SHOES'),
  ('cosmetic-053','cosmetic-085','SHOES','CAPE'),
  ('cosmetic-054','cosmetic-086','CAPE','HEAD'),
  ('cosmetic-055','cosmetic-060','HEAD','TOP'),
  ('cosmetic-056','cosmetic-061','TOP','BOTTOM'),
  ('cosmetic-057','cosmetic-062','BOTTOM','GLOVES'),
  ('cosmetic-058','cosmetic-063','GLOVES','SHOES'),
  ('cosmetic-059','cosmetic-064','SHOES','CAPE'),
  ('cosmetic-060','cosmetic-065','CAPE','HEAD'),
  ('cosmetic-061','cosmetic-075','HEAD','TOP'),
  ('cosmetic-062','cosmetic-076','TOP','BOTTOM'),
  ('cosmetic-063','cosmetic-077','BOTTOM','GLOVES'),
  ('cosmetic-064','cosmetic-078','GLOVES','SHOES'),
  ('cosmetic-065','cosmetic-079','SHOES','CAPE'),
  ('cosmetic-066','cosmetic-080','CAPE','HEAD');

create temporary table cosmetic_target_accounts_v74(account_id uuid primary key) on commit drop;
insert into cosmetic_target_accounts_v74 values
  ('08c60330-d2d0-4477-aa83-286f83516611'),
  ('26b63120-8bf8-4a36-8791-a0164682cc40');

create temporary table cosmetic_draw_counts_v74 on commit drop as
select e.account_id,
       result->>'cosmeticId' as cosmetic_id,
       count(*) filter (where e.content_version = 'cosmetics-v6-angel-yakgwa-back')::integer as legacy_quantity,
       count(*) filter (where e.content_version <> 'cosmetics-v6-angel-yakgwa-back')::integer as modern_quantity
  from cosmetic_audit_event e
  join cosmetic_target_accounts_v74 t on t.account_id = e.account_id
 cross join lateral jsonb_array_elements(e.result_json#>'{data,results}') result
 where e.operation = 'DRAW'
 group by 1,2;

-- 08c60330의 cosmetic-063 : 뽑기 로그엔 없지만 옛 스시야 하의로 확인된 1개를 legacy로 얹는다.
update cosmetic_draw_counts_v74
   set legacy_quantity = legacy_quantity + 1
 where account_id = '08c60330-d2d0-4477-aa83-286f83516611'
   and cosmetic_id = 'cosmetic-063';
insert into cosmetic_draw_counts_v74(account_id, cosmetic_id, legacy_quantity, modern_quantity)
select '08c60330-d2d0-4477-aa83-286f83516611', 'cosmetic-063', 1, 0
where not exists (
  select 1 from cosmetic_draw_counts_v74
   where account_id = '08c60330-d2d0-4477-aa83-286f83516611' and cosmetic_id = 'cosmetic-063'
);

create temporary table cosmetic_actual_counts_v74 on commit drop as
select s.account_id, s.cosmetic_id, s.registered_quantity, s.unregistered_quantity
  from cosmetic_collection_state s
  join cosmetic_target_accounts_v74 t on t.account_id = s.account_id;

create temporary table cosmetic_source_parts_v74 (
  account_id uuid not null,
  cosmetic_id varchar(80) not null,
  registered_quantity integer not null,
  unregistered_quantity integer not null
) on commit drop;

-- 충돌 사슬에 걸린 옛 ID 몫: 등록 수량은 옛(legacy) 획득분에 먼저 배정한다(FIFO, 이슈 #44).
insert into cosmetic_source_parts_v74(account_id,cosmetic_id,registered_quantity,unregistered_quantity)
select actual.account_id,
       coalesce(remap.new_id, actual.cosmetic_id),
       least(actual.registered_quantity, drawn.legacy_quantity),
       drawn.legacy_quantity - least(actual.registered_quantity, drawn.legacy_quantity)
  from cosmetic_actual_counts_v74 actual
  join cosmetic_draw_counts_v74 drawn using (account_id, cosmetic_id)
  left join cosmetic_id_remap_v74 remap on remap.old_id = actual.cosmetic_id
 where drawn.legacy_quantity > 0
   and actual.cosmetic_id in (select old_id from cosmetic_id_remap_v74);

-- 같은 옛 ID 문자열에 남는 새(modern) 획득분 몫: 그 번호에 그대로 남는다.
insert into cosmetic_source_parts_v74(account_id,cosmetic_id,registered_quantity,unregistered_quantity)
select actual.account_id,
       actual.cosmetic_id,
       greatest(actual.registered_quantity - coalesce(drawn.legacy_quantity,0), 0),
       coalesce(drawn.modern_quantity,0) - greatest(actual.registered_quantity - coalesce(drawn.legacy_quantity,0), 0)
  from cosmetic_actual_counts_v74 actual
  left join cosmetic_draw_counts_v74 drawn using (account_id, cosmetic_id)
 where actual.cosmetic_id in (select old_id from cosmetic_id_remap_v74)
   and coalesce(drawn.modern_quantity,0) > greatest(actual.registered_quantity - coalesce(drawn.legacy_quantity,0), 0) - 1;

-- 충돌 사슬 밖(옛 ID도 아니고 목적지도 아닌) 행은 그대로 보존한다. 26b63120의 cosmetic-080이
-- 여기 해당 — 출처 불명이지만 어떤 옛 ID의 목적지도 아니므로 건드리지 않는다.
insert into cosmetic_source_parts_v74(account_id,cosmetic_id,registered_quantity,unregistered_quantity)
select actual.account_id, actual.cosmetic_id, actual.registered_quantity, actual.unregistered_quantity
  from cosmetic_actual_counts_v74 actual
 where actual.cosmetic_id not in (select old_id from cosmetic_id_remap_v74);

create temporary table cosmetic_collection_state_v74_target on commit drop as
select account_id, cosmetic_id,
       case when sum(registered_quantity) = 0 and sum(unregistered_quantity) > 0 then 1 else sum(registered_quantity) end as registered_quantity,
       case when sum(registered_quantity) = 0 and sum(unregistered_quantity) > 0 then sum(unregistered_quantity) - 1 else sum(unregistered_quantity) end as unregistered_quantity
  from cosmetic_source_parts_v74
 group by account_id, cosmetic_id;

delete from cosmetic_collection_state state
 using cosmetic_target_accounts_v74 t
 where state.account_id = t.account_id;

insert into cosmetic_collection_state(account_id, cosmetic_id, registered_quantity, unregistered_quantity, reserved_quantity)
select account_id, cosmetic_id, registered_quantity, unregistered_quantity, 0
  from cosmetic_collection_state_v74_target
 where registered_quantity > 0 or unregistered_quantity > 0;

update cosmetic_equipment equipment
   set cosmetic_id = remap.new_id
  from cosmetic_id_remap_v74 remap, cosmetic_target_accounts_v74 t
 where equipment.account_id = t.account_id
   and equipment.cosmetic_id = remap.old_id
   and equipment.slot = remap.old_slot;

update account a
   set state_version = state_version + 1
  from cosmetic_target_accounts_v74 t
 where a.id = t.account_id;

delete from cosmetic_remap_skipped_accounts skipped
 using cosmetic_target_accounts_v74 t
 where skipped.account_id = t.account_id;

update cosmetic_remap_v71_result result
   set status = 'APPLIED',
       reason = 'MANUAL_REVIEW_RESOLVED_V74',
       after_quantity = (
         select coalesce(sum(state.registered_quantity + state.unregistered_quantity), 0)
           from cosmetic_collection_state state
          where state.account_id = result.account_id
       )
  from cosmetic_target_accounts_v74 t
 where result.account_id = t.account_id;
