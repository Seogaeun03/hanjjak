-- 탈퇴한 계정의 닉네임은 예전에 모두 같은 자리표시자 하나였다. 이름을 계정마다 하나로
-- 묶으려면 그 줄들을 먼저 갈라 놓아야 한다. 지금 탈퇴 코드가 쓰는 모양과 같게 맞춘다.
update character
set nickname = '탈퇴한 사용자-' || left(account_id::text, 8)
where nickname = '탈퇴한 사용자';

-- 남은 충돌은 먼저 만든 계정이 이름을 지키고, 나중에 만든 쪽에만 번호를 붙인다.
-- 이름은 스무 자까지라 번호가 들어갈 자리를 앞에서 덜어 낸다. 자르고 붙인 이름이 또
-- 다른 이름과 겹칠 수 있어 더 바꿀 것이 없을 때까지 돈다. 맴돌지 않도록 횟수를 묶어 두고,
-- 그래도 남으면 아래 제약이 소리 내어 막는다.
do $$
declare
  touched integer;
  passes integer := 0;
begin
  loop
    with ranked as (
      select c.id,
             row_number() over (partition by c.nickname order by a.created_at, c.account_id) as seq
      from character c
      join account a on a.id = c.account_id
    )
    update character c
    set nickname = left(c.nickname, 20 - length(ranked.seq::text) - 1) || '-' || ranked.seq
    from ranked
    where ranked.id = c.id and ranked.seq > 1;
    get diagnostics touched = row_count;
    passes := passes + 1;
    exit when touched = 0 or passes >= 10;
  end loop;
end $$;

alter table character add constraint character_nickname_unique unique (nickname);
