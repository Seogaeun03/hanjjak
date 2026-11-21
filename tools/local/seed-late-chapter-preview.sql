-- Local chapter 11~15 and special-option gem preview seed.
--
-- Sign up through the app first, then run:
--   psql -h localhost -U hanjjak -d hanjjak -v email=you@example.com -f tools/local/seed-late-chapter-preview.sql
--
-- Safe to re-run: every inserted row uses a deterministic key or an upsert.
-- Local development only. Never run this against a shared or production database.

\if :{?email}
\else
\set email 'preview@example.com'
\endif

\set ON_ERROR_STOP on

begin;

drop table if exists late_preview_target;
create temporary table late_preview_target as
select id from account where email = :'email';

do $$
begin
    if (select count(*) from late_preview_target) <> 1 then
        raise exception 'no account found for that email — sign up in the app first';
    end if;
end
$$;

-- Late chapters need enough baseline progression to stay alive while visual QA is in progress.
update "character"
set level = 300,
    experience = greatest(experience, 500::bigint * 300 * 299),
    rice = greatest(rice, 1000000000)
where account_id = (select id from late_preview_target);

-- Chapters 1~14 are treated as cleared and every chapter 15 stage is exposed for direct QA.
insert into stage_progress(account_id, stage_id, unlocked, first_cleared_at, highest_clear_count, content_version)
select (select id from late_preview_target),
       'stage.' || lpad(chapter::text, 2, '0') || '-' || lpad(number::text, 2, '0'),
       true,
       case when chapter <= 14 then now() else null end,
       case when chapter <= 14 then 1 else 0 end,
       'enemy-v1-applied'
from generate_series(1, 15) chapter, generate_series(1, 10) number
on conflict (account_id, stage_id) do update
set unlocked = true,
    first_cleared_at = coalesce(stage_progress.first_cleared_at, excluded.first_cleared_at),
    highest_clear_count = greatest(stage_progress.highest_clear_count, excluded.highest_clear_count),
    content_version = excluded.content_version;

insert into equipment_slot_state(account_id, slot, grade, enhancement_level)
select (select id from late_preview_target), slot, 'MYTHIC', 30
from unnest(array['WEAPON', 'GLOVES', 'ARMOR', 'HELMET', 'CAPE', 'SHOES']) slot
on conflict (account_id, slot) do update
set grade = 'MYTHIC', enhancement_level = 30, updated_at = now();

insert into skill_state(account_id, skill_id, grade, level, failure_bonus_basis_points)
select (select id from late_preview_target), skill_id, 'EPIC', 10, 0
from unnest(array['active_heavy', 'active_dot', 'active_haste', 'active_basic_amp',
                  'passive_critical', 'passive_all_damage']) skill_id
on conflict (account_id, skill_id) do update set grade = 'EPIC', level = 10;

delete from skill_loadout where account_id = (select id from late_preview_target);
insert into skill_loadout(account_id, slot_index, skill_id)
values ((select id from late_preview_target), 1, 'active_haste'),
       ((select id from late_preview_target), 2, 'active_basic_amp'),
       ((select id from late_preview_target), 3, 'active_heavy'),
       ((select id from late_preview_target), 4, 'active_dot');

-- Two attack-percent and two penetration gems deliberately prove same-option summation.
-- Special-option gems are auto-locked by policy, including while equipped.
do $$
declare
    acct uuid;
    base_seq bigint;
    i integer;
    gem uuid;
    slot_id uuid;
    opt text;
    val integer;
begin
    select id into acct from late_preview_target;
    select coalesce(max(seq), 0) into base_seq
    from (
        select acquired_sequence as seq from inventory_stack where account_id = acct
        union all
        select acquired_sequence from inventory_instance where account_id = acct
    ) owned;

    delete from gem_loadout where account_id = acct and preset = 'MAIN';

    for i in 1..6 loop
        opt := case i
            when 1 then 'ATTACK_PERCENT'
            when 2 then 'ATTACK_PERCENT'
            when 3 then 'FLAT_PENETRATION'
            when 4 then 'FLAT_PENETRATION'
            when 5 then 'CRITICAL_CHANCE'
            else 'HASTE'
        end;
        val := case opt
            when 'ATTACK_PERCENT' then 1500
            when 'FLAT_PENETRATION' then 120
            else 1200
        end;
        gem := md5('hanjjak-late-preview:gem:' || acct::text || ':' || i)::uuid;
        slot_id := case i
            when 2 then md5('hanjjak-late-preview:gem:' || acct::text || ':1')::uuid
            when 4 then md5('hanjjak-late-preview:gem:' || acct::text || ':3')::uuid
            else gem
        end;

        insert into gem_instance(gem_id, account_id, level, "option", value, locked, content_version, created_at)
        values (gem, acct, 7, opt, val, true, 'gem-v1-draft', now())
        on conflict (gem_id) do update
        set level = 7, "option" = excluded."option", value = excluded.value, locked = true;

        insert into inventory_instance(instance_id, account_id, item_id, reserved_for_sale,
                                       acquired_sequence, stack_key, inventory_slot_id, locked)
        values (gem, acct, 'gem:7:' || lower(opt), false, base_seq + i,
                '7:' || opt || ':' || val, slot_id, true)
        on conflict (instance_id) do update
        set item_id = excluded.item_id,
            stack_key = excluded.stack_key,
            inventory_slot_id = excluded.inventory_slot_id,
            locked = true,
            reserved_for_sale = false;

        insert into gem_loadout(account_id, preset, slot_index, gem_id)
        values (acct, 'MAIN', i, gem);
    end loop;
end
$$;

update account set state_version = state_version + 1 where id = (select id from late_preview_target);

select c.nickname,
       c.level,
       (select count(*) from stage_progress s where s.account_id = c.account_id and s.unlocked) as unlocked_stages,
       (select count(*) from gem_loadout l where l.account_id = c.account_id and l.preset = 'MAIN') as main_gems,
       (select sum(g.value) from gem_loadout l join gem_instance g on g.gem_id = l.gem_id
         where l.account_id = c.account_id and l.preset = 'MAIN' and g."option" = 'ATTACK_PERCENT') as attack_percent_bp,
       (select sum(g.value) from gem_loadout l join gem_instance g on g.gem_id = l.gem_id
         where l.account_id = c.account_id and l.preset = 'MAIN' and g."option" = 'FLAT_PENETRATION') as penetration,
       (select sum(g.value) from gem_loadout l join gem_instance g on g.gem_id = l.gem_id
         where l.account_id = c.account_id and l.preset = 'MAIN' and g."option" = 'CRITICAL_CHANCE') as critical_chance_bp,
       (select sum(g.value) from gem_loadout l join gem_instance g on g.gem_id = l.gem_id
         where l.account_id = c.account_id and l.preset = 'MAIN' and g."option" = 'HASTE') as haste_bp
from "character" c
where c.account_id = (select id from late_preview_target);

commit;
