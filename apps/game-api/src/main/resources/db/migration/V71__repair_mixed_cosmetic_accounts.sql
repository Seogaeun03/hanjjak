-- V67은 v6와 v7 치장이 같은 문자열 ID에 섞인 계정을 의도적으로 건너뛰었다.
-- 이 후속 보정은 감사 로그로 현재 수량 전부를 설명할 수 있는 계정만 원자적으로 재구성한다.
-- 한 ID라도 수량이 다르거나, 알 수 없는 콘텐츠 버전·예약 재고·비정상 착용이 있으면
-- 계정 전체를 그대로 두고 cosmetic_remap_skipped_accounts에 남긴다.

create temporary table cosmetic_id_remap_v71 (
  old_id varchar(80) primary key,
  new_id varchar(80) not null,
  old_slot varchar(16) not null,
  current_slot varchar(16) not null
) on commit drop;

insert into cosmetic_id_remap_v71(old_id,new_id,old_slot,current_slot) values
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

create temporary table cosmetic_draw_audits_v71 on commit drop as
select e.account_id,
       e.content_version,
       case
         when jsonb_typeof(coalesce(e.details_json->'results', e.result_json#>'{data,results}', e.result_json->'results')) = 'array'
           then coalesce(e.details_json->'results', e.result_json#>'{data,results}', e.result_json->'results')
         else '[]'::jsonb
       end as results,
       jsonb_typeof(coalesce(e.details_json->'results', e.result_json#>'{data,results}', e.result_json->'results')) = 'array' as valid_results
  from cosmetic_audit_event e
  join cosmetic_remap_skipped_accounts s on s.account_id = e.account_id
 where e.operation = 'DRAW';

create temporary table cosmetic_draw_results_v71 on commit drop as
select a.account_id,
       a.content_version,
       result->>'cosmeticId' as cosmetic_id,
       a.content_version in (
         'cosmetics-v1',
         'cosmetics-v2-placeholder',
         'cosmetics-v3-balanced-placeholder',
         'cosmetics-v4-active-sets-placeholder',
         'cosmetics-v5-motion-ready-sets',
         'cosmetics-v6-angel-yakgwa-back'
       ) as legacy
  from cosmetic_draw_audits_v71 a
 cross join lateral jsonb_array_elements(a.results) result
 where nullif(result->>'cosmeticId','') is not null;

create temporary table cosmetic_actual_counts_v71 on commit drop as
select s.account_id,
       s.cosmetic_id,
       s.registered_quantity,
       s.unregistered_quantity,
       s.reserved_quantity,
       s.registered_quantity + s.unregistered_quantity as total_quantity
  from cosmetic_collection_state s
  join cosmetic_remap_skipped_accounts k on k.account_id = s.account_id;

create temporary table cosmetic_draw_counts_v71 on commit drop as
select account_id,
       cosmetic_id,
       count(*) filter (where legacy)::integer as legacy_quantity,
       count(*) filter (where not legacy)::integer as modern_quantity,
       count(*)::integer as total_quantity
  from cosmetic_draw_results_v71
 group by account_id, cosmetic_id;

create temporary table cosmetic_account_checks_v71 on commit drop as
select skipped.account_id,
       case
         when not exists (
           select 1 from cosmetic_draw_audits_v71 a
            where a.account_id = skipped.account_id
         ) then 'DRAW_AUDIT_MISSING'
         when not exists (
           select 1 from cosmetic_actual_counts_v71 actual
            where actual.account_id = skipped.account_id
         ) then 'COLLECTION_STATE_MISSING'
         when exists (
           select 1 from cosmetic_draw_audits_v71 a
            where a.account_id = skipped.account_id
               and (
                 a.valid_results is not true
                or exists (
                  select 1 from jsonb_array_elements(a.results) result
                   where nullif(result->>'cosmeticId','') is null
                )
              )
         ) then 'MALFORMED_DRAW_AUDIT'
         when exists (
           select 1 from cosmetic_draw_audits_v71 a
            where a.account_id = skipped.account_id
              and a.content_version not in (
                'cosmetics-v1',
                'cosmetics-v2-placeholder',
                'cosmetics-v3-balanced-placeholder',
                'cosmetics-v4-active-sets-placeholder',
                'cosmetics-v5-motion-ready-sets',
                'cosmetics-v6-angel-yakgwa-back',
                'cosmetics-v7-art-overhaul',
                'cosmetics-v8-legendary-banners'
              )
         ) then 'UNKNOWN_CONTENT_VERSION'
         when exists (
           select 1
             from cosmetic_actual_counts_v71 actual
             full join cosmetic_draw_counts_v71 drawn
               on drawn.account_id = actual.account_id and drawn.cosmetic_id = actual.cosmetic_id
            where coalesce(actual.account_id,drawn.account_id) = skipped.account_id
              and coalesce(actual.total_quantity,0) <> coalesce(drawn.total_quantity,0)
         ) then 'QUANTITY_MISMATCH'
         when exists (
           select 1 from cosmetic_actual_counts_v71 actual
            where actual.account_id = skipped.account_id and actual.reserved_quantity > 0
         ) then 'RESERVED_QUANTITY_PRESENT'
         when exists (
           select 1
             from cosmetic_equipment e
             join cosmetic_id_remap_v71 r on r.old_id = e.cosmetic_id
            where e.account_id = skipped.account_id
              and e.slot not in (r.old_slot,r.current_slot)
         ) then 'EQUIPMENT_SLOT_MISMATCH'
         else null
       end as rejection_reason
  from cosmetic_remap_skipped_accounts skipped;

create table cosmetic_collection_state_v71_mixed_backup as
select state.*, now() as backed_up_at
  from cosmetic_collection_state state
  join cosmetic_remap_skipped_accounts skipped on skipped.account_id = state.account_id;

create table cosmetic_equipment_v71_mixed_backup as
select equipment.*, now() as backed_up_at
  from cosmetic_equipment equipment
  join cosmetic_remap_skipped_accounts skipped on skipped.account_id = equipment.account_id;

create table cosmetic_remap_v71_result (
  account_id uuid primary key,
  status varchar(32) not null check (status in ('APPLIED','REQUIRES_MANUAL_REVIEW')),
  reason varchar(64),
  before_quantity bigint not null,
  audit_quantity bigint not null,
  affected_draw_quantity bigint not null,
  recommended_ticket_quantity bigint not null,
  after_quantity bigint,
  recorded_at timestamptz not null default now()
);

-- 보상 기준은 v6 획득분과 같은 raw ID에 기록되어 다른 치장과 합쳐진 v7+ 결과 1개당
-- 치장 뽑기권 1장이다. 실제 지급은 이 마이그레이션이 수행하지 않는다.
insert into cosmetic_remap_v71_result(
  account_id,status,reason,before_quantity,audit_quantity,
  affected_draw_quantity,recommended_ticket_quantity,after_quantity
)
select checks.account_id,
       case when checks.rejection_reason is null then 'APPLIED' else 'REQUIRES_MANUAL_REVIEW' end,
       checks.rejection_reason,
       coalesce((select sum(actual.total_quantity) from cosmetic_actual_counts_v71 actual where actual.account_id=checks.account_id),0),
       coalesce((select count(*) from cosmetic_draw_results_v71 drawn where drawn.account_id=checks.account_id),0),
       coalesce((
         select sum(drawn.modern_quantity)
           from cosmetic_draw_counts_v71 drawn
          where drawn.account_id=checks.account_id
            and drawn.legacy_quantity > 0
            and drawn.modern_quantity > 0
       ),0),
       coalesce((
         select sum(drawn.modern_quantity)
           from cosmetic_draw_counts_v71 drawn
          where drawn.account_id=checks.account_id
            and drawn.legacy_quantity > 0
            and drawn.modern_quantity > 0
       ),0),
       null
  from cosmetic_account_checks_v71 checks;

create temporary table cosmetic_source_parts_v71 (
  account_id uuid not null,
  cosmetic_id varchar(80) not null,
  registered_quantity integer not null,
  unregistered_quantity integer not null
) on commit drop;

-- 등록 명령에는 별도 감사 로그가 없다. 이슈 #44에서 검토한 FIFO 기준대로 같은 raw ID의
-- 등록 수량을 v6 획득분에 먼저 배정하고, 남은 등록 수량을 v7+ 획득분에 배정한다.
insert into cosmetic_source_parts_v71(account_id,cosmetic_id,registered_quantity,unregistered_quantity)
select actual.account_id,
       coalesce(remap.new_id,actual.cosmetic_id),
       least(actual.registered_quantity,drawn.legacy_quantity),
       drawn.legacy_quantity - least(actual.registered_quantity,drawn.legacy_quantity)
  from cosmetic_actual_counts_v71 actual
  join cosmetic_draw_counts_v71 drawn using (account_id,cosmetic_id)
  join cosmetic_account_checks_v71 checks on checks.account_id=actual.account_id and checks.rejection_reason is null
  left join cosmetic_id_remap_v71 remap on remap.old_id=actual.cosmetic_id
 where drawn.legacy_quantity > 0;

insert into cosmetic_source_parts_v71(account_id,cosmetic_id,registered_quantity,unregistered_quantity)
select actual.account_id,
       actual.cosmetic_id,
       greatest(actual.registered_quantity-drawn.legacy_quantity,0),
       drawn.modern_quantity-greatest(actual.registered_quantity-drawn.legacy_quantity,0)
  from cosmetic_actual_counts_v71 actual
  join cosmetic_draw_counts_v71 drawn using (account_id,cosmetic_id)
  join cosmetic_account_checks_v71 checks on checks.account_id=actual.account_id and checks.rejection_reason is null
 where drawn.modern_quantity > 0;

create table cosmetic_collection_state_v71_target (
  account_id uuid not null,
  cosmetic_id varchar(80) not null,
  registered_quantity integer not null,
  unregistered_quantity integer not null,
  reserved_quantity integer not null,
  primary key(account_id,cosmetic_id)
);

-- raw ID 충돌 때문에 새 의미의 첫 획득이 중복으로 처리된 경우, 합친 목표 행에 등록분이
-- 하나도 없을 때 첫 한 개를 자동 등록 상태로 되돌린다.
insert into cosmetic_collection_state_v71_target(account_id,cosmetic_id,registered_quantity,unregistered_quantity,reserved_quantity)
select account_id,
       cosmetic_id,
       case when sum(registered_quantity)=0 and sum(unregistered_quantity)>0 then 1 else sum(registered_quantity) end,
       case when sum(registered_quantity)=0 and sum(unregistered_quantity)>0 then sum(unregistered_quantity)-1 else sum(unregistered_quantity) end,
       0
  from cosmetic_source_parts_v71
 group by account_id,cosmetic_id;

delete from cosmetic_collection_state state
 using cosmetic_account_checks_v71 checks
 where state.account_id=checks.account_id and checks.rejection_reason is null;

insert into cosmetic_collection_state(account_id,cosmetic_id,registered_quantity,unregistered_quantity,reserved_quantity)
select account_id,cosmetic_id,registered_quantity,unregistered_quantity,reserved_quantity
  from cosmetic_collection_state_v71_target;

-- v6와 v7에서 같은 문자열 ID의 부위가 모두 달라 착용 슬롯으로 옛 의미를 판별할 수 있다.
update cosmetic_equipment equipment
   set cosmetic_id=remap.new_id
  from cosmetic_id_remap_v71 remap,
       cosmetic_account_checks_v71 checks
 where equipment.account_id=checks.account_id
   and checks.rejection_reason is null
   and equipment.cosmetic_id=remap.old_id
   and equipment.slot=remap.old_slot;

update account a
   set state_version=state_version+1
  from cosmetic_account_checks_v71 checks
 where a.id=checks.account_id and checks.rejection_reason is null;

update cosmetic_remap_v71_result result
   set after_quantity=(
     select coalesce(sum(state.registered_quantity+state.unregistered_quantity),0)
       from cosmetic_collection_state state
      where state.account_id=result.account_id
   )
 where result.status='APPLIED';

delete from cosmetic_remap_skipped_accounts skipped
 using cosmetic_account_checks_v71 checks
 where skipped.account_id=checks.account_id and checks.rejection_reason is null;

do $$
declare
  applied_accounts bigint;
  manual_review_accounts bigint;
  recommended_tickets bigint;
begin
  select count(*) filter (where status='APPLIED'),
         count(*) filter (where status='REQUIRES_MANUAL_REVIEW'),
         coalesce(sum(recommended_ticket_quantity),0)
    into applied_accounts,manual_review_accounts,recommended_tickets
    from cosmetic_remap_v71_result;

  raise notice 'COSMETIC_REMAP_V71_SUMMARY applied_accounts=% manual_review_accounts=% recommended_tickets=%',
    applied_accounts,manual_review_accounts,recommended_tickets;
end $$;
