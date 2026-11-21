-- 색만 다른 세트에서 고른 색. 남이 보는 내 모습(랭킹)에도 같은 색이 나와야 하므로
-- 브라우저가 아니라 여기 둔다. 스탯에는 영향이 없다.
alter table character add column cosmetic_color varchar(16);
