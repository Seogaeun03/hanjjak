-- The order lifetime changed from 8 hours to 24 hours. Preserve each existing
-- active sell listing's elapsed lifetime by extending its stored deadline 16 hours.
update market_order
set expires_at = expires_at + interval '16 hours'
where side = 'SELL'
  and time_in_force = 'GTC'
  and status in ('ACTIVE', 'PARTIALLY_FILLED');
