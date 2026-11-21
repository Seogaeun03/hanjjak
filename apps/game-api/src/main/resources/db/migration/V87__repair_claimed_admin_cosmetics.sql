-- V60~V86의 일반 COSMETIC 우편 수령은 최초 획득도 미등록 수량으로만 넣었다.
-- 우편은 CLAIMED로 끝났지만 도감/착용이 보는 registered_quantity는 0이라 사용자는
-- 치장을 받지 못한 것처럼 보였다. 실제로 수령 완료된 관리자 우편이 증거로 남은 행만
-- 찾아 한 개를 등록으로 옮기고, 감사용 before/after와 근거 우편 ID를 영구 보존한다.

create table cosmetic_mail_registration_repair_v87 (
  account_id uuid not null references account(id),
  cosmetic_id varchar(80) not null,
  registered_quantity_before integer not null,
  unregistered_quantity_before integer not null,
  registered_quantity_after integer not null,
  unregistered_quantity_after integer not null,
  source_mail_ids uuid[] not null,
  repaired_at timestamptz not null,
  primary key(account_id, cosmetic_id)
);

insert into cosmetic_mail_registration_repair_v87(
  account_id,
  cosmetic_id,
  registered_quantity_before,
  unregistered_quantity_before,
  registered_quantity_after,
  unregistered_quantity_after,
  source_mail_ids,
  repaired_at
)
select state.account_id,
       state.cosmetic_id,
       state.registered_quantity,
       state.unregistered_quantity,
       1,
       -- 예약되지 않은 중복분이 있으면 한 개를 등록으로 옮긴다. 전량 예약된 과거 행은
       -- 진행 중 예약을 깨지 않고 약속한 최초 등록분을 보상하므로 미등록 수량을 유지한다.
       greatest(state.unregistered_quantity - 1, state.reserved_quantity),
       array_agg(distinct mail.mail_id),
       now()
  from cosmetic_collection_state state
  join mail_message mail
    on mail.account_id = state.account_id
   and mail.send_id is not null
   and mail.reward_status = 'CLAIMED'
 cross join lateral jsonb_array_elements(mail.rewards_json) reward
 where state.registered_quantity = 0
   and state.unregistered_quantity > 0
   and reward->>'kind' = 'COSMETIC'
   and reward->>'cosmeticId' = state.cosmetic_id
 group by state.account_id,
          state.cosmetic_id,
          state.registered_quantity,
          state.unregistered_quantity;

update cosmetic_collection_state state
   set registered_quantity = repair.registered_quantity_after,
       unregistered_quantity = repair.unregistered_quantity_after
  from cosmetic_mail_registration_repair_v87 repair
 where state.account_id = repair.account_id
   and state.cosmetic_id = repair.cosmetic_id;

update account target
   set state_version = target.state_version + 1
 where exists (
   select 1
     from cosmetic_mail_registration_repair_v87 repair
    where repair.account_id = target.id
 );
