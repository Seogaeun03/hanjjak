// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BattleHudPreview, createDungeonPreviewChallenge } from "./battle-hud-preview";
import { BossArrivalWarning, ChapterOneMonster } from "./BattleScreen";
import { readMarketUiState } from "../market/marketUiState";
import { MasterHero } from "../gems/PlayerBattleCharacter";

beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
    this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  globalThis.history.replaceState({}, "", "/");
});

/* 랭킹·치장·던전은 그림이 화면을 다 쓰는 자리라 아래 성장 메뉴를 걷어 냈다.
   거래소는 전투 화면을 깔아 둔 채 덮이므로 그 메뉴가 그대로 남아 있다. */
it.each(["거래소"])("opens the character window from the %s preview state", (routeLabel) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  fireEvent.click(screen.getByRole("button", { name: routeLabel }));
  /* 거래소는 장비처럼 전투 화면을 깔아 둔 채 그 위에 덮여 열린다. 전투 화면이 그대로
     남아 있으니 위쪽 메뉴에는 현재 자리 표시가 붙지 않고, 관리 화면인 랭킹만 붙는다. */
  expect(document.querySelector(".market-plaza")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "캐릭터" }));
  expect(screen.getByRole("dialog", { name: "캐릭터" }).hasAttribute("open")).toBe(true);
});

it.each([
  ["스킬", "스킬", "h2"],
  ["거래소", "거래소", "h2 span"],
  ["랭킹", "전체 랭킹", "h3"],
  ["장비", "장비", "h2"],
  ["아이템", "인벤토리", "h2"],
])("renders the existing %s screen instead of only changing the active tab", (tabLabel, expectedText, selector) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  fireEvent.click(screen.getByRole("button", { name: tabLabel }));

  expect(screen.getByText(expectedText, { selector })).toBeTruthy();
});

it("opens the event gacha window over the battle screen and closes back to battle", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  fireEvent.click(await screen.findByRole("button", { name: "이벤트" }));

  // 장비·스킬 창과 같은 자리를 쓴다: 전투 무대는 창 뒤에 그대로 남고, 창은 스스로 닫힌다.
  expect(await screen.findByRole("dialog", { name: "이벤트 뽑기" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "사냥 이벤트 뽑기" })).toBeTruthy();
  expect(document.querySelector(".battle-screen-live")).toBeTruthy();
  expect(document.querySelector(".cozy-shared-navigation")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "이벤트 닫기" }));
  expect(screen.queryByRole("dialog", { name: "이벤트 뽑기" })).toBeNull();
  expect(screen.getByRole("navigation", { name: "주요 관리 메뉴" })).toBeTruthy();
});

it("keeps dungeon and gems active in the unlocked preview", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  fireEvent.click(screen.getByRole("button", { name: "콘텐츠" }));
  const dungeon = screen.getByRole("button", { name: /^던전/ }) as HTMLButtonElement;
  expect(dungeon.disabled).toBe(false);
  expect((screen.getByRole("button", { name: "보석" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(dungeon);
  expect(screen.getByRole("heading", { name: "보석 던전" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "콘텐츠" }) as HTMLButtonElement).disabled).toBe(false);
  /* 던전 화면은 위쪽 관리 메뉴만 남기므로 아래 성장 메뉴의 보석 단추는 없다. */
  expect(screen.queryByRole("button", { name: "보석" })).toBeNull();
  expect(document.querySelector(".cozy-shared-navigation.is-top-bar-only")).toBeTruthy();
});

it("builds an offensive preview that exercises all four skill cooldowns", () => {
  const challenge = createDungeonPreviewChallenge();

  expect(challenge.boss).toBe("BERSERK");
  expect(new Set(challenge.battle.events.map((event) => event.skillId).filter(Boolean))).toEqual(new Set([
    "active_haste", "active_dot", "active_basic_amp", "active_heavy",
  ]));
  expect(challenge.battle.events.some((event) => event.type === "PLAYER_HIT")).toBe(true);
  expect(challenge.battle.events.some((event) => event.type === "BOSS_HIT")).toBe(true);
  expect(challenge.battle.events.filter((event) => event.type === "PLAYER_HIT" && event.skillId === null)).toHaveLength(9);
});

it("starts the blacksmith tutorial on battle and lets the player open equipment directly", async () => {
  globalThis.history.replaceState({}, "", "/battle-hud-preview.html?tutorial=all");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 120,
    y: 220,
    top: 220,
    left: 120,
    right: 220,
    bottom: 300,
    width: 100,
    height: 80,
    toJSON: () => undefined,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  expect(screen.getByRole("navigation", { name: "튜토리얼 장 미리보기" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /모험가|대장장이|비법 수련가|던전 기사|보석 마법사|스타일리스트|장터 상인|마을 안내/ })).toHaveLength(8);

  fireEvent.click(screen.getByRole("button", { name: "대장장이" }));
  expect(screen.getByText("대장장이의 장")).toBeTruthy();
  expect(screen.getByText("이제 장비 쪽을 확인해 볼까? 아래 장비 버튼을 직접 눌러 봐!")).toBeTruthy();
  expect(screen.queryByText("표시된 버튼을 직접 눌러 줘!")).toBeNull();
  expect(container.querySelector(".battle-kitchen")).toBeTruthy();
  expect(container.querySelector(".tutorial-preview-window-stage")).toBeNull();

  fireEvent.click(screen.getByLabelText("장비 직접 선택"));

  expect(container.querySelector(".tutorial-preview-window-stage .equipment-window .equipment-screen")).toBeTruthy();
  expect(screen.getByText(/좋아, 장비 창이 열렸어!/)).toBeTruthy();
});

it("lets the stylist tutorial draw once and equip the acquired look directly", () => {
  globalThis.history.replaceState({}, "", "/battle-hud-preview.html?tutorial=stylist");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 120, y: 220, top: 220, left: 120, right: 220, bottom: 300, width: 100, height: 80,
    toJSON: () => undefined,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  fireEvent.click(screen.getByRole("button", { name: /새로운 옷이 열렸어!/ }));
  fireEvent.click(screen.getByLabelText("1회 뽑기 직접 선택"));
  expect(screen.getByRole("region", { name: "치장 뽑기 결과 화면" })).toBeTruthy();
  expect(screen.getByText("마법사 모자")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /뽑기 성공!/ }));
  fireEvent.click(screen.getByLabelText("마법사 모자 착용 직접 선택"));
  expect(screen.getByRole("button", { name: "마법사 모자 벗기" }).getAttribute("aria-pressed")).toBe("true");
});

it("lets the gem tutorial equip, save, and fuse its practice gems directly", async () => {
  globalThis.history.replaceState({}, "", "/battle-hud-preview.html?tutorial=gem-wizard");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 120, y: 220, top: 220, left: 120, right: 220, bottom: 300, width: 100, height: 80,
    toJSON: () => undefined,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  fireEvent.click(screen.getByRole("button", { name: /반짝이는 보석함을 얻었네!/ }));
  fireEvent.click(screen.getByLabelText("연습 보석 장착 직접 선택"));
  fireEvent.click(screen.getByLabelText("프리셋 저장 직접 선택"));
  fireEvent.click(screen.getByLabelText("합성 탭 직접 선택"));
  fireEvent.click(screen.getByLabelText("첫 번째 보석 직접 선택"));
  fireEvent.click(screen.getByLabelText("두 번째 보석 직접 선택"));
  fireEvent.click(screen.getByLabelText("세 번째 보석 직접 선택"));
  fireEvent.click(screen.getByLabelText("직접 합성 직접 선택"));

  const rewardMessage = await screen.findByText(/3레벨 공격력% 보석을 획득하였습니다!/, {}, { timeout: 5_000 });
  expect(rewardMessage.closest('[role="dialog"]')).toBeTruthy();
  fireEvent.click(screen.getByLabelText("합성 결과 확인 직접 선택"));
  expect(screen.queryByText(/3레벨 공격력% 보석을 획득하였습니다!/)).toBeNull();
  expect(screen.getByRole("button", { name: /성공! 2레벨 보석 세 개가 3레벨 보석 하나로 합쳐졌어/ })).toBeTruthy();
});

it("renders ranking as the full page layer behind the shared HUD", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  fireEvent.click(screen.getByRole("button", { name: "랭킹" }));

  const shell = container.querySelector(".cozy-ranking-shell");
  const ranking = shell?.querySelector(".ranking-screen");
  expect(shell).toBeTruthy();
  expect(ranking).toBeTruthy();
  expect(ranking?.parentElement).toBe(shell);
  expect(ranking?.closest(".cozy-management-content")).toBeNull();
  expect(shell?.querySelector(".cozy-shared-navigation")).toBeTruthy();
});

it("keeps the stage visible behind the designed equipment modal", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  fireEvent.click(screen.getByRole("button", { name: "장비" }));

  expect(document.querySelector(".battle-kitchen")).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "장비" })).toBeTruthy();
  expect(document.querySelectorAll(".equipment-slot-card")).toHaveLength(6);
});

it("keeps the stage visible behind the inventory modal and closes back to battle", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  fireEvent.click(screen.getByRole("button", { name: "아이템" }));

  expect(document.querySelector(".battle-kitchen")).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "인벤토리" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "인벤토리 닫기" }));

  expect(document.querySelector(".battle-kitchen")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "인벤토리" })).toBeNull();
});

it("renders inventory preview data without calling the production inventory API", async () => {
  globalThis.history.replaceState({}, "", "/battle-hud-preview.html?route=inventory");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network unavailable"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  expect((await screen.findAllByText("한짝의 일격 비법서")).length).toBeGreaterThan(0);
  expect(document.querySelectorAll(".inventory-v2-skillbook-badge")).toHaveLength(6);
  expect((await screen.findAllByText("감자 한 조각")).length).toBeGreaterThan(0);
  expect(screen.queryByText("인벤토리를 불러오지 못했습니다.")).toBeNull();
  expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("/api/v1/inventory"))).toBe(false);
});

it("runs the equipment enhancement preview and shows only the centered combat-power increase", async () => {
  globalThis.history.replaceState({}, "", "/battle-hud-preview.html?route=equipment");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  const enhance = await screen.findByRole("button", { name: "강화" });
  expect(enhance.hasAttribute("disabled")).toBe(false);
  fireEvent.click(enhance);

  expect(await screen.findByLabelText("전투력 5 상승")).toBeTruthy();
  expect(screen.getAllByText("감자 한 조각").length).toBeGreaterThan(0);
  await waitFor(() => expect(screen.getByRole("button", { name: "강화" }).hasAttribute("disabled")).toBe(false));
  expect(screen.queryByText("무기 상태를 업데이트했습니다.")).toBeNull();
});

it("opens the marketplace sell tab with the selected inventory item", async () => {
  globalThis.history.replaceState({}, "", "/battle-hud-preview.html?route=inventory");
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network unavailable"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);
  const potatoName = await screen.findByText("감자 한 조각", { selector: ".inventory-v2-grid strong" });
  fireEvent.click(potatoName.closest("button")!);
  fireEvent.click(await screen.findByRole("button", { name: "감자 한 조각 거래소에서 바로 판매" }));
  expect(readMarketUiState(window.sessionStorage).selectedItemId).toBe("POTATO_M1");

  /* 인벤토리는 열린 채로 남고 거래소가 그 위에 선다. 거래소가 아래로 깔려서 클릭이
     인벤토리 바깥 클릭 닫기로 새던 것이 원래 버그였다. */
  const overlay = document.querySelector<HTMLDialogElement>("dialog.global-overlay-window");
  expect(overlay?.open).toBe(true);
  expect(overlay!.contains(document.querySelector(".market-plaza")!)).toBe(true);
  const openDialogs = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")];
  expect(openDialogs.map((dialog) => dialog.className)).toContain("inventory-window");
  expect(openDialogs.at(-1)!.className).toBe("global-overlay-window");
});

it("opens the settings modal from a shared management page", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  fireEvent.click(screen.getByRole("button", { name: "스킬" }));
  fireEvent.click(screen.getByRole("button", { name: "설정" }));

  expect(screen.getByRole("dialog", { name: "설정" }).hasAttribute("open")).toBe(true);
});
it.each([
  ["pure-roll", "stage.01-01", false, "순수롤", "WARNING"],
  ["peach-siru", "stage.01-04", false, "복숭아 시루", "WARNING"],
  ["crepe", "stage.01-07", false, "크레이프", "WARNING"],
  ["strawberry-siru", "stage.01-10", true, "딸기 시루", "FINAL BOSS"],
  ["tea-time-biscuit-count", "stage.02-01", false, "티타임 비스킷 백작", "WARNING"],
  ["ruby-jam-sand-queen", "stage.02-04", false, "루비잼 샌드 여왕", "WARNING"],
  ["cookie-tin-bulwark-knight", "stage.02-07", false, "쿠키통 철벽기사", "WARNING"],
  ["royal-assortment-gift-golem", "stage.02-10", true, "로열 어소트먼트 선물 골렘", "FINAL BOSS"],
  ["mackerel-nigiri-captain", "stage.03-01", false, "고등어초밥 대장", "WARNING"],
  ["fatty-tuna-nigiri-boss", "stage.03-04", false, "대뱃살초밥 보스", "WARNING"],
  ["crab-gunkan-chief", "stage.03-07", false, "게살군함 대장", "WARNING"],
  ["futomaki-king", "stage.03-10", true, "후토마끼 왕", "FINAL BOSS"],
] as const)("renders the %s arrival warning with dynamic content", (monsterId, stageId, finalBoss, name, kicker) => {
  render(<BossArrivalWarning monsterId={monsterId} stageId={stageId} finalBoss={finalBoss} />);

  expect(screen.getByRole("status", { name: `${name} 보스 등장` })).toBeTruthy();
  expect(screen.getByText(kicker)).toBeTruthy();
  expect(screen.getByText(name)).toBeTruthy();
  expect(document.querySelector(".boss-warning-crop .boss-warning-sprite")).toBeTruthy();
  expect(screen.queryByText("BOSS APPEARS")).toBeNull();
  expect(screen.queryByText(/CHAPTER .* STAGE/)).toBeNull();
});

it("keeps overhead HP on normal monsters only", () => {
  const normal = renderToStaticMarkup(<ChapterOneMonster id="toyo-bread" motion="idle" boss={false} hp={500} maxHp={782} skillVfx={[]} />);
  const boss = renderToStaticMarkup(<ChapterOneMonster id="crepe" motion="idle" boss hp={500} maxHp={782} skillVfx={[]} />);
  const hero = renderToStaticMarkup(<MasterHero motion="rest" skillVfx={[]} />);

  expect(normal).toContain("actor-health-bar");
  expect(normal).toContain("--monster-health-bottom");
  expect(normal).toContain("--monster-shadow-bottom");
  expect(boss).not.toContain("actor-health-bar");
  expect(hero).not.toContain("actor-health-bar");
});

it("anchors target skill effects to each monster visual center", () => {
  const markup = renderToStaticMarkup(<ChapterOneMonster id="person-butter-cookie-fighter" motion="idle" boss={false} hp={500} maxHp={782} skillVfx={[
    { kind: "heavy-target", frame: 0, frameCount: 8 },
    { kind: "dot-target", frame: 0, frameCount: 8, loop: true },
  ]} />);

  expect(markup).toContain("--monster-vfx-center-bottom");
  expect(markup).toContain("--monster-vfx-center-x");
  expect(markup).toContain("--monster-heavy-vfx-size");
  expect(markup).toContain("--monster-dot-vfx-size");
  expect(markup).toContain("skill-vfx-heavy-target");
  expect(markup).toContain("skill-vfx-dot-target");
});

it("previews both persistent active effects with looping and expiry blinking", () => {
  globalThis.history.replaceState({}, "", "/battle-hud-preview.html?skill-vfx=buffs&expiring=1");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  const crownAnchor = container.querySelector(".hero-crown-vfx");
  expect(crownAnchor).toBeTruthy();
  expect(crownAnchor?.querySelector(".skill-vfx-haste-caster.skill-vfx-looping-8.skill-vfx-expiring")).toBeTruthy();
  expect(crownAnchor?.querySelector(".skill-vfx-basic-amp-caster.skill-vfx-looping-8.skill-vfx-expiring")).toBeTruthy();
});

it("enters an explicit cosmetics preview state without requesting production cosmetics data", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);
  fetchSpy.mockClear();

  fireEvent.click(screen.getByRole("button", { name: "콘텐츠" }));
  fireEvent.click(screen.getByRole("button", { name: "치장 뽑기" }));

  expect(screen.getByRole("heading", { name: "치장 뽑기" })).toBeTruthy();
  expect(screen.queryByText("정적 미리보기에서는 실제 뽑기 API를 호출하지 않습니다.")).toBeNull();
  expect(screen.getByRole("button", { name: "콘텐츠" }).getAttribute("aria-current")).toBe("page");
  fireEvent.click(screen.getByRole("button", { name: /10회 뽑기/ }));
  expect(screen.getByLabelText("치장 뽑기 결과")).toBeTruthy();
  expect(screen.getByLabelText("획득한 치장 10개").children).toHaveLength(10);
  expect(screen.getByRole("button", { name: /다시 10회 뽑기/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "선택 상자 1개 받기" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "선택 상자 1개 받기" }));
  // 받은 상자는 실제 화면과 똑같이 인벤토리로 이동해서 연다.
  expect(screen.getByText("치장 선택권 박스 1개 수령하였습니다.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "인벤토리로 이동" }));
  expect(screen.getByRole("heading", { name: "인벤토리" })).toBeTruthy();
  expect(await screen.findByText("치장 선택권 박스")).toBeTruthy();
  expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("/api/v1/cosmetic"))).toBe(false);
});

it("keeps preview result return flows reachable and removes decorative pointer interception", () => {
  globalThis.history.replaceState({}, "", "/battle-hud-preview.html?route=cosmetics");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BattleHudPreview /></QueryClientProvider>);

  const cosmeticsCss = readFileSync(resolve(process.cwd(), "src/features/cosmetics/cosmetics.css"), "utf8");
  expect(cosmeticsCss).toMatch(/\.cosmetic-reveal-aura\s*\{[^}]*pointer-events:\s*none;/);

  fireEvent.click(screen.getByRole("button", { name: /^1회 뽑기/ }));
  fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));
  expect(screen.getByRole("heading", { name: "치장 뽑기" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /^10회 뽑기/ }));
  expect(screen.getByLabelText("획득한 치장 10개").children).toHaveLength(10);
  fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));
  expect(screen.getByRole("heading", { name: "치장 뽑기" })).toBeTruthy();
});

it("anchors the shared HUD to one box so moving between screens does not shift it", () => {
  // 랭킹·치장뽑기는 배경을 화면 끝까지 깔되 HUD 는 전투와 같은 상자에 가둔다.
  const css = readFileSync(resolve(process.cwd(), "src/features/battle/BattleHud.css"), "utf8");
  expect(css).toContain("--cozy-hud-max-width: 1600px");
  expect(css).toContain("--cozy-hud-max-height: 900px");
  expect(css).toContain("width: min(100%, var(--cozy-hud-max-width))");
  expect(css).toContain("max-height: var(--cozy-hud-max-height)");
  // 화면마다 따로 폭을 풀어 주던 규칙은 남아 있으면 안 된다.
  expect(css).not.toContain("cozy-ranking-shell { max-width: none; }");
  expect(css).not.toContain("cozy-cosmetics-shell { max-width: none; }");
});

it("keeps stage cell artwork fixed while only its labels react on hover", () => {
  const css = readFileSync(resolve(process.cwd(), "src/features/battle/BattleHud.css"), "utf8");

  expect(css).not.toMatch(/\.cozy-stage-picker-panel li button:hover:not\(:disabled\)\s*\{[^}]*background\s*:/);
  expect(css).toMatch(/\.cozy-stage-panel-group > \.cozy-stage-picker-panel li button:hover:not\(:disabled\)\s*\{[^}]*background-size:\s*95px 97px;[^}]*transform:\s*none;/s);
  expect(css).toMatch(/button:hover:not\(:disabled\) strong\s*\{[^}]*translateX\(1px\) scale\(1\.1\);/s);
  expect(css).toMatch(/button:hover:not\(:disabled\) small\s*\{[^}]*transform:\s*scale\(1\.1\);/s);
});
