import { expect, test } from "@playwright/test";
import { ACTORS, attachBossHealthBar, formatOverlaps, freezeMotion, measureBattleHud } from "./battleHudLayout";

/*
 * 전투 HUD 는 1600x900 구도에 칸을 절대좌표로 놓는다. 창을 줄이면 칸끼리 덮거나
 * 화면 밖으로 밀리는데, 자리 계산은 브라우저만 하므로 단위 테스트로는 못 잡는다.
 * 실제로 두 번 연속으로 눈으로만 발견됐다. 그래서 여기서 재 둔다.
 *
 * 전투 미리보기(battle-hud-preview.html)는 로그인도 API 도 타지 않는 정적 화면이라
 * 개발 서버만으로 실제 화면과 같은 CSS 를 그린다.
 */

const PREVIEW = "/battle-hud-preview.html";

/*
 * 이번 전달 범위는 BattleHud.css의 데스크톱 계약과 같은 가로 1280px·세로 720px
 * 이상이다. 모바일·세로 반응형은 후속 작업 범위라 이 배포 게이트에 섞지 않는다.
 */
const DESKTOP_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
] as const;

/*
 * 기준 데스크톱에서도 상태 막대는 무대 바닥에 걸쳐 있어 인물의 발끝을 조금 가린다.
 * 값은 허용할 겹침의 최대 높이(px)이고, 그 밖의 HUD가 인물을 가리면 실패한다.
 */
const KNOWN_ACTOR_COVERAGE: Record<string, number> = {
  /* 상태 막대는 무대 바닥에 걸쳐 있어 기준 크기(1600x900)에서도 발끝 11px 를 가린다. */
  "hero|.cozy-player-status": 60,
  "monster|.cozy-player-status": 3,
  /* 1280px 데스크톱 경계의 무대 재배치는 모바일·세로 반응형 작업과 함께 개선한다. */
  "hero|.chat-panel": 255,
  "monster|.cozy-history-trigger": 14,
  "monster|.cozy-stage-cluster": 56,
};

for (const viewport of DESKTOP_VIEWPORTS) {
  const label = `${viewport.width}x${viewport.height}`;

  test(`HUD 칸이 서로 덮지 않는다 — ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(PREVIEW);
    await page.waitForSelector(".cozy-growth-nav");
    await freezeMotion(page);

    const measured = await measureBattleHud(page);

    expect(measured.panelOverlaps, `겹친 칸: ${formatOverlaps(measured.panelOverlaps)}`).toEqual([]);
    expect(measured.outOfBounds, `화면 밖으로 나간 칸: ${measured.outOfBounds.join("; ")}`).toEqual([]);
  });

  test(`보스 체력 막대가 붙어도 칸이 서로 덮지 않는다 — ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(PREVIEW);
    await page.waitForSelector(".cozy-stage-progress");
    await freezeMotion(page);
    await attachBossHealthBar(page);

    const measured = await measureBattleHud(page);

    expect(measured.panelOverlaps, `겹친 칸: ${formatOverlaps(measured.panelOverlaps)}`).toEqual([]);
    expect(measured.outOfBounds, `화면 밖으로 나간 칸: ${measured.outOfBounds.join("; ")}`).toEqual([]);
  });

  test(`무대 위 인물이 알려진 것보다 더 가려지지 않는다 — ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(PREVIEW);
    await page.waitForSelector(Object.values(ACTORS)[0]);
    await freezeMotion(page);

    const measured = await measureBattleHud(page);
    const worse = measured.actorCoverage.filter((hit) => hit.height > (KNOWN_ACTOR_COVERAGE[`${hit.a}|${hit.b}`] ?? 0));

    expect(worse, `새로 가려진 인물: ${formatOverlaps(worse)}`).toEqual([]);
  });
}

/*
 * 기준 크기에서는 무대가 상태 막대 말고 어떤 칸에도 안 가려야 한다. 위 표는 좁은
 * 화면을 위해 열어 둔 것이라, 기준 크기까지 느슨해지면 열어 둔 의미가 없다.
 */
test("기준 크기 1600x900 에서는 무대가 상태 막대 말고는 가려지지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(PREVIEW);
  await page.waitForSelector(Object.values(ACTORS)[0]);
  await freezeMotion(page);

  const measured = await measureBattleHud(page);
  const unexpected = measured.actorCoverage.filter((hit) => hit.b !== ".cozy-player-status");

  expect(unexpected, `기준 크기에서 가려진 인물: ${formatOverlaps(unexpected)}`).toEqual([]);
});

test("치장 보관함은 스크롤 경계에 잘린 카드 행을 노출하지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${PREVIEW}?route=character&character-tab=cosmetics`);
  await page.getByRole("tab", { name: "전체" }).click();
  await page.waitForSelector(".costume-owned-grid [data-cosmetic-id]");

  const clippedCards = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(".costume-owned-grid");
    if (!grid) return ["보관함 없음"];
    const edge = grid.getBoundingClientRect().bottom;
    return [...grid.querySelectorAll<HTMLElement>("[data-cosmetic-id]")]
      .filter(card => {
        const rect = card.getBoundingClientRect();
        return rect.top < edge - 0.5 && rect.bottom > edge + 0.5;
      })
      .map(card => card.dataset.cosmeticId ?? "알 수 없는 치장");
  });

  expect(clippedCards, `보관함 아래 경계에 걸린 카드: ${clippedCards.join(", ")}`).toEqual([]);
});

/* 브라우저 배율을 낮춰야만 얻던 여백을 100%에서도 제공한다. 하단 메뉴는 배율을
   적용한 뒤에도 레이아웃 상자의 가운데에 있어야 한다. */
test("100% 데스크톱에서 HUD를 76% 밀도로 그리고 하단 메뉴를 중앙에 둔다", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(PREVIEW);
  await page.waitForSelector(ACTORS.hero);
  await freezeMotion(page);

  const layout = await page.evaluate(() => {
    const hero = document.querySelector(".hero-position > :first-child")?.getBoundingClientRect();
    const nav = document.querySelector(".cozy-growth-nav")?.getBoundingClientRect();
    const chat = document.querySelector(".chat-panel")?.getBoundingClientRect();
    return {
      scale: getComputedStyle(document.documentElement).getPropertyValue("--hud-ui-scale").trim(),
      heroHeight: hero?.height ?? 0,
      navCenter: nav ? (nav.left + nav.right) / 2 : 0,
      navWidth: nav?.width ?? 0,
      chatWidth: chat?.width ?? 0,
    };
  });

  expect(Number(layout.scale)).toBeCloseTo(.76, 3);
  expect(layout.navCenter).toBeCloseTo(800, 0);
  expect(layout.navWidth).toBeCloseTo(643 * .76, 0);
  expect(layout.chatWidth).toBeCloseTo(421.667 * .76, 0);
  expect(layout.heroHeight).toBeCloseTo(360 * .86, 0);
});

/* 이 화면의 기준은 "에셋을 늘리지 않는다" 이다. 예전 기준선(액자 폭 850, 버튼 높이 150)은
   3.584:1 셸을 2.44:1 상자에 늘려 넣던 시절의 숫자였고, 늘림을 걷어내면 지킬 수 없다.
   그래서 치수 대신 비율을 못 박는다 — 키 아트는 원본 1586x992, 버튼은 셸 원본 1767x493. */
const KEY_ART_RATIO = 1586 / 992;
const DRAW_SHELL_RATIO = 1767 / 493;

test("치장 뽑기 키아트·버튼·마일스톤 간격을 유지한다 — 1440x900", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${PREVIEW}?route=cosmetics`);
  await page.waitForSelector(".cosmetic-showcase-frame");
  /* 키 아트가 다 받아지기 전에는 naturalWidth 가 0 이라 비율을 잴 수 없다. */
  await page.waitForFunction(() => {
    const art = document.querySelector<HTMLImageElement>(".cosmetic-showcase-frame > img:first-child");
    return Boolean(art?.complete && art.naturalWidth > 0);
  });
  await freezeMotion(page);

  const layout = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const frame = rect(".cosmetic-showcase-frame");
    const milestone = rect(".cosmetic-milestone");
    const heading = rect(".cosmetic-screen-heading");
    const odds = rect(".cosmetic-odds-button");
    const wallet = rect(".cosmetic-gacha-balance");
    const gauge = rect(".cosmetic-milestone-track progress");
    const box = rect(".cosmetic-milestone-progress > button");
    const drawButton = rect(".cosmetic-cost-buttons button");
    const artNode = document.querySelector<HTMLImageElement>(".cosmetic-showcase-frame > img:first-child");
    const art = artNode?.getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".cosmetic-cost-buttons button")].map((button) => {
      const shell = button.getBoundingClientRect();
      const title = button.querySelector("strong")?.getBoundingClientRect();
      const cost = button.querySelector(".cosmetic-draw-cost")?.getBoundingClientRect();
      return {
        ratio: shell.width / shell.height,
        width: shell.width,
        contentInside: Boolean(title && cost
          && title.top >= shell.top + 12 && title.bottom <= shell.bottom - 12
          && cost.top >= shell.top + 12 && cost.bottom <= shell.bottom - 12),
      };
    });
    /* 같은 선에 서야 하는 것들. 왼쪽은 확률 버튼·액자·게이지, 오른쪽은 재화·버튼·상자다. */
    const near = (a?: number, b?: number) => a !== undefined && b !== undefined && Math.abs(a - b) <= 2;
    return {
      gap: frame && milestone ? milestone.top - frame.bottom : -1,
      frameWidth: frame?.width ?? 0,
      artRatio: art ? art.width / art.height : 0,
      artNaturalRatio: artNode ? artNode.naturalWidth / artNode.naturalHeight : 0,
      headerAligned: Boolean(heading && odds && wallet && odds.left >= heading.left && wallet.right <= heading.right),
      leftRail: near(odds?.left, frame?.left) && near(frame?.left, gauge?.left),
      rightRail: near(wallet?.right, drawButton?.right) && near(drawButton?.right, box?.right),
      boxSlightlyBelowGauge: Boolean(gauge && box && box.bottom > gauge.bottom && box.bottom - gauge.bottom <= 10),
      buttons,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(layout.gap).toBeGreaterThanOrEqual(-24);
  expect(layout.frameWidth).toBeGreaterThanOrEqual(600);
  /* 액자 구멍에 맞추느라 키 아트를 잘라 넣으면 여기서 걸린다. */
  expect(layout.artRatio).toBeCloseTo(KEY_ART_RATIO, 2);
  expect(layout.artRatio).toBeCloseTo(layout.artNaturalRatio, 2);
  expect(layout.headerAligned).toBe(true);
  expect(layout.leftRail, "확률 버튼·액자·게이지의 왼쪽 선").toBe(true);
  expect(layout.rightRail, "재화·뽑기 버튼·상자의 오른쪽 선").toBe(true);
  expect(layout.boxSlightlyBelowGauge, "상자는 게이지 바보다 조금 아래에 둔다").toBe(true);
  expect(layout.buttons).toHaveLength(2);
  expect(layout.buttons.every((button) => button.width >= 320 && button.contentInside)).toBe(true);
  /* 셸을 늘려 넣으면 비율이 어긋난다. */
  expect(layout.buttons.every((button) => Math.abs(button.ratio - DRAW_SHELL_RATIO) < 0.05)).toBe(true);
  expect(layout.overflowX).toBe(0);
});
