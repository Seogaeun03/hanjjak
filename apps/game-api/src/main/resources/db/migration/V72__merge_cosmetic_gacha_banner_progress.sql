-- Fold the short-lived per-set pickup counters back into the original general
-- cosmetic gacha counter without losing successful draws or claimed boxes.
insert into cosmetic_banner_progress(account_id, banner_id, total_successful_draws, claimed_box_count)
select account_id,
       'cosmetic-banner-01',
       sum(total_successful_draws)::bigint,
       sum(claimed_box_count)::bigint
from cosmetic_banner_progress
where banner_id in ('cosmetic-banner-01', 'cosmetic-banner-02', 'cosmetic-banner-03', 'cosmetic-banner-04')
group by account_id
on conflict (account_id, banner_id) do update
set total_successful_draws = excluded.total_successful_draws,
    claimed_box_count = excluded.claimed_box_count;

delete from cosmetic_banner_progress
where banner_id in ('cosmetic-banner-02', 'cosmetic-banner-03', 'cosmetic-banner-04');
