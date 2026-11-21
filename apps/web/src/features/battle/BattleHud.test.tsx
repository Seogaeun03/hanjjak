import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { expect, it } from "vitest";
import { battleRemainingSeconds, battleRemainingSecondsAt, BattleHistoryPopoverItem, BattlePlayerStatus, BattleRewards, BattleStageProgress, BattleUtilityNavigation, CozySharedNavigation, FirstClearRewardNotice, rewardMeta, stagePanelViewModel } from "./BattleHud";

/* 메뉴가 우편함을 살펴 점을 찍으므로 시험에도 질의 상자가 있어야 한다. */
const markupWithQuery = (element: ReactElement) => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{element}</QueryClientProvider>,
);

const stages = [{
  stageId: "stage.01-07",
  unlocked: true,
  clearCount: 2,
  contentVersion: "test",
  isCurrent: true,
  isRepeatTarget: false,
  repeatEligible: true,
  normalMonsterIds: [],
  bossMonsterId: null,
  backgroundId: null,
  bossOnly: false,
}];

it("counts down the server-authored battle duration in whole seconds", () => {
  expect(battleRemainingSeconds(34_000, 100, 127)).toBe(21);
  expect(battleRemainingSeconds(34_000, 100, 400)).toBe(0);
});

it("shows normal-stage progress with the final unlimited timer state", () => {
  const html = renderToStaticMarkup(<BattleStageProgress stages={stages} selectedStageId="stage.01-07" remainingSeconds={null} defeatedNormals={13} bossOnly={false} bossPhase={false} stageComplete={false} idleMode="AUTO_PROGRESS" idleModeSaving={false} repeatEligible onSelectStage={() => undefined} onChangeMode={() => undefined} />);
  expect(html).toContain("STAGE 1-7");
  expect(html).toContain('aria-label="제한시간 없음"');
  expect(html).toContain("제한 없음");
  expect(html).toContain("13 / 20");
  expect(html).toContain('aria-valuenow="13"');
  expect((html.match(/class="is-filled"/g) ?? [])).toHaveLength(13);
});

it("moves live boss HP into a dedicated bar below the stage controls", () => {
  const html = renderToStaticMarkup(<BattleStageProgress stages={stages} selectedStageId="stage.01-07" remainingSeconds={4} defeatedNormals={20} bossOnly={false} bossPhase stageComplete={false} idleMode="AUTO_PROGRESS" idleModeSaving={false} repeatEligible bossHealth={{ name: "게살군함", hp: 517, maxHp: 782 }} onSelectStage={() => undefined} onChangeMode={() => undefined} />);
  expect(html).toContain("게살군함");
  expect(html).toContain('aria-label="게살군함 보스 체력"');
  expect(html).toContain('aria-valuenow="517"');
  expect(html).toContain('aria-valuemax="782"');
});
it("shows the limit only during a timed boss phase", () => {
  const html = renderToStaticMarkup(<BattleStageProgress stages={stages} selectedStageId="stage.01-07" remainingSeconds={4.9} defeatedNormals={20} bossOnly={false} bossPhase stageComplete={false} idleMode="AUTO_PROGRESS" idleModeSaving={false} repeatEligible onSelectStage={() => undefined} onChangeMode={() => undefined} />);
  expect(html).toContain("남은 제한시간");
  expect(html).toContain("5초");
  expect(html).not.toContain("4.9초");
});

it("maps stage cells to explicit Figma states", () => {
  const view = stagePanelViewModel({
    stages: [
      { ...stages[0], stageId: "stage.01-06", isCurrent: false, clearCount: 3 },
      stages[0],
      { ...stages[0], stageId: "stage.01-08", isCurrent: false, clearCount: 0 },
      { ...stages[0], stageId: "stage.01-09", isCurrent: false, clearCount: 0, unlocked: false },
    ],
    selectedStageId: "stage.01-07",
    remainingSeconds: null,
    defeatedNormals: 7,
    bossOnly: false,
    bossPhase: false,
    stageComplete: false,
    bossHealth: null,
  });

  expect(view.timer.kind).toBe("unlimited");
  expect(view.stages.map((stage) => stage.state)).toEqual(["cleared", "current", "default", "locked"]);
  expect(view.progress).toEqual({ kind: "normal", defeated: 7, total: 20 });
});

it("presents stage 10 as a final-boss-only encounter", () => {
  const finalStage = [{ ...stages[0], stageId: "stage.03-10", normalMonsterIds: [], bossMonsterId: "futomaki-king", bossOnly: true }];
  const html = renderToStaticMarkup(<BattleStageProgress stages={finalStage} selectedStageId="stage.03-10" remainingSeconds={12} defeatedNormals={0} bossOnly bossPhase stageComplete={false} idleMode="AUTO_PROGRESS" idleModeSaving={false} repeatEligible={false} onSelectStage={() => undefined} onChangeMode={() => undefined} />);

  expect(html).toContain("최종 보스");
  expect(html).toContain('aria-label="최종 보스 처치 진행"');
  expect(html).toContain('aria-valuemax="1"');
  expect(html).not.toContain("0 / 20");
});

it("renders every reward row and switches the list to scrolling past three rows", () => {
  const html = renderToStaticMarkup(<BattleRewards stageId="stage.01-07" rice={1284} rewards={[
    { itemId: "SWEET_POTATO_M1", requestedQuantity: 12, grantedQuantity: 12, discardedQuantity: 0 },
    { itemId: "CORN_M1", requestedQuantity: 3, grantedQuantity: 3, discardedQuantity: 0 },
    { itemId: "POTATO_M1", requestedQuantity: 7, grantedQuantity: 7, discardedQuantity: 0 },
    { itemId: "SKILL_BOOK", requestedQuantity: 1, grantedQuantity: 1, discardedQuantity: 0 },
  ]} />);
  /* 확정 설계는 페이지 넘김이 아니라 세로 스크롤이다. 1~3개는 한 화면에 들어가고
     4개 이상이면 목록이 스크롤로 바뀐다(K-06 문서, Figma 529:447 목록 높이 174px). */
  expect((html.match(/<li>/g) ?? [])).toHaveLength(5);
  expect(html).toContain("5종 획득");
  expect(html).toContain('class="is-scrollable"');

  const threeRows = renderToStaticMarkup(<BattleRewards stageId="stage.01-07" rice={0} rewards={[
    { itemId: "SWEET_POTATO_M1", requestedQuantity: 12, grantedQuantity: 12, discardedQuantity: 0 },
    { itemId: "CORN_M1", requestedQuantity: 3, grantedQuantity: 3, discardedQuantity: 0 },
    { itemId: "POTATO_M1", requestedQuantity: 7, grantedQuantity: 7, discardedQuantity: 0 },
  ]} />);
  expect((threeRows.match(/<li>/g) ?? [])).toHaveLength(3);
  expect(threeRows).not.toContain("is-scrollable");
  expect(html).toContain("고구마 한 조각");
  expect(html).toContain("옥수수 한 알");
});

it("maps a granted skillbook item id to its catalog display name", () => {
  const html = renderToStaticMarkup(<BattleRewards stageId="stage.01-07" rice={0} rewards={[
    { itemId: "skillbook:active_dot:normal", requestedQuantity: 1, grantedQuantity: 1, discardedQuantity: 0 },
  ]} />);
  expect(html).toContain("노말 마! 쫄이나 비법서");
  expect(html).not.toContain("skillbook:active_dot:normal");
});

it("maps offline material item ids to player-facing labels", () => {
  expect(rewardMeta("POTATO_M1").label).toBe("감자 한 조각");
  expect(rewardMeta("POTATO_M1").label).not.toBe("POTATO_M1");
});

it("keeps first-clear rewards informational because they are already granted", () => {
  const html = renderToStaticMarkup(<FirstClearRewardNotice reward={{
    rewardId: "reward-1",
    stageId: "stage.01-01",
    rewardVersion: "test",
    firstClear: true,
    riceGranted: 100,
    ticketsGranted: 0,
    grantedItems: [],
    pendingItems: [],
    unlockedSkillId: null,
    itemStatus: "GRANTED",
    requiredSlots: 0,
    availableSlots: 20,
    missingSlots: 0,
  }} onClose={() => undefined} />);

  expect(html).toContain("보상은 가방으로 바로 지급됩니다.");
  expect(html).toContain('aria-label="최초 클리어 보상 닫기"');
  expect(html).not.toContain("모두 받기");
  expect(html).not.toContain("나중에");
});

it("shows experience, enhancement material, and rice gains in a HUD history record", () => {
  const html = renderToStaticMarkup(<BattleHistoryPopoverItem event={{
    eventId: "history-1",
    type: "STAGE_FAILED",
    occurredAt: "2026-09-10T00:01:00Z",
    stageId: "stage.01-07",
    dungeonId: null,
    resultCode: "PLAYER_DEFEATED",
    messageKey: "battle.history.player.defeated",
    contentVersion: "enemy-v1-applied",
    combatSnapshot: {
      attack: 120,
      maxHp: 500,
      penetration: 32,
      remainingHp: 0,
      defeatedNormals: 17,
      lastEnemyRemainingHp: 44,
      elapsedTicks: 250,
      experienceGained: 170,
      riceGained: 85,
      rewards: [
        { itemId: "POTATO_M1", displayName: "감자 M1", quantity: 7 },
        { itemId: "CORN_M1", displayName: "옥수수 M1", quantity: 3 },
      ],
    },
  }} />);

  expect(html).toContain("전투 획득 요약");
  expect(html).toContain("경험치");
  expect(html).toContain("+170");
  expect(html).toContain("강화 재료");
  expect(html).toContain("+10개");
  expect(html).toContain("쌀");
  expect(html).toContain("+85");
  expect(html).toContain("감자 M1 +7");
  expect(html).toContain("옥수수 M1 +3");
});

it("keeps HP and EXP as equal-width live progress tracks", () => {
  const html = renderToStaticMarkup(<BattlePlayerStatus level={24} hp={2680} maxHp={3680} experience={18720} experienceRequired={30000} experiencePercent={62.4} />);
  expect(html).toContain('aria-label="HP"');
  expect(html).toContain('aria-valuenow="2680"');
  expect(html).toContain('aria-label="EXP"');
  expect(html).toContain('aria-valuenow="18720"');
  expect(html).toContain("62.4%");
});

it("reuses profile and both navigation groups on management screens", () => {
  const html = markupWithQuery(<CozySharedNavigation
    account={{ accountId: "account-1", characterId: "character-1", email: "test@example.com", nickname: "한짝", level: 24, experience: 18720, rice: 15820 }}
    activeRoute="market"
    onOpenProfile={() => undefined}
    onNavigate={() => undefined}
  />);

  expect(html).toContain('aria-label="내 정보 열기"');
  expect(html).toContain('aria-label="주요 관리 메뉴"');
  expect(html).toContain('aria-label="성장 메뉴"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain("15,820");
  expect(html).toContain("전투");
  expect(html).toContain("설정");
  expect(html).toContain("보석");
  /* 잠긴 치장 뽑기는 닫힌 콘텐츠 메뉴 안에 있으므로 상단 셸에는 노출하지 않는다. */
  expect(html).not.toContain("1-5 해금");
});

it("keeps the battle utility buttons in the approved five-item order", () => {
  const html = markupWithQuery(<BattleUtilityNavigation
    activeRoute="battle"
    gemContentUnlocked
    cosmeticContentUnlocked
    onNavigate={() => undefined}
  />);
  expect([...html.matchAll(/data-route="([^"]+)"/g)].map(match => match[1])).toEqual([
    "mail", "content", "market", "ranking", "settings",
  ]);
  expect(html).not.toContain("첫 클리어 보상");
});

it("counts the stage timer down on the clock so it never climbs back up", () => {
  const deadline = "2026-09-13T00:01:00.000Z";
  const at = (iso: string) => battleRemainingSecondsAt(deadline, Date.parse(iso));
  expect(at("2026-09-13T00:00:12.000Z")).toBe(48);
  // 틱이 뒤로 가도 시계는 앞으로만 간다.
  expect(at("2026-09-13T00:00:12.900Z")).toBe(48);
  expect(at("2026-09-13T00:00:13.000Z")).toBe(47);
  expect(at("2026-09-13T00:02:00.000Z")).toBe(0);
  expect(battleRemainingSecondsAt(null, Date.now())).toBe(0);
  expect(battleRemainingSecondsAt("not a date", Date.now())).toBe(0);
});
