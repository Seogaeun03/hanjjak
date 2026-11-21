-- 던전을 10단계에서 30단계로 연다.
--
-- 범위를 넓히기만 하는 단방향 마이그레이션이다. 기존 진행도는 그대로 유효하므로 데이터 이관이
-- 없고, 승격 전 10단계 콘텐츠로 되돌려도 이 제약이 막지 않는다. 실제 노출 단계는 애플리케이션이
-- 로드된 콘텐츠의 maxStage 로 강제한다.
--
-- 제약 이름은 V20 의 컬럼 인라인 CHECK 를 PostgreSQL 이 자동 생성한 것이다.

alter table gem_dungeon_progress
    drop constraint gem_dungeon_progress_highest_cleared_stage_check;
alter table gem_dungeon_progress
    add constraint gem_dungeon_progress_highest_cleared_stage_check
    check (highest_cleared_stage between 0 and 30);

alter table gem_dungeon_first_clear
    drop constraint gem_dungeon_first_clear_stage_check;
alter table gem_dungeon_first_clear
    add constraint gem_dungeon_first_clear_stage_check
    check (stage between 1 and 30);

alter table gem_dungeon_challenge
    drop constraint gem_dungeon_challenge_stage_check;
alter table gem_dungeon_challenge
    add constraint gem_dungeon_challenge_stage_check
    check (stage between 1 and 30);
