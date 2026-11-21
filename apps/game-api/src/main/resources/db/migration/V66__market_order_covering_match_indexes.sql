-- Covering payload for the unified order book match indexes.
--
-- V51 indexed the price-time key of the resting book but none of the columns the matching CTE reads back, so the
-- candidate scan visits the heap once per index entry to fetch account_id, remaining_quantity and expires_at. The
-- same three columns are all that depth and price-level aggregation read. Carrying them as an INCLUDE payload lets
-- those scans stay inside the index.
--
-- The replacements are built under temporary names before the originals are dropped, so the order book is never left
-- without a usable match index. CREATE INDEX is deliberate rather than CREATE INDEX CONCURRENTLY: Flyway runs each
-- migration inside one transaction and CONCURRENTLY cannot run in a transaction block. These are partial indexes over
-- ACTIVE and PARTIALLY_FILLED rows only, so the build holds its SHARE lock for a fraction of a second.
create index market_order_sell_match_next_idx on market_order(instrument_id,limit_unit_price,priority_at,order_id)
  include (account_id,remaining_quantity,expires_at)
  where side='SELL' and status in ('ACTIVE','PARTIALLY_FILLED');
create index market_order_buy_match_next_idx on market_order(instrument_id,limit_unit_price desc,priority_at,order_id)
  include (account_id,remaining_quantity,expires_at)
  where side='BUY' and status in ('ACTIVE','PARTIALLY_FILLED');

drop index market_order_sell_match_idx;
drop index market_order_buy_match_idx;

alter index market_order_sell_match_next_idx rename to market_order_sell_match_idx;
alter index market_order_buy_match_next_idx rename to market_order_buy_match_idx;
