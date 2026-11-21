import { expect, test } from "@playwright/test";

const PREVIEW = "/battle-hud-preview.html";

test("세로형 모바일은 스테이지부터 채팅까지 아래로 스크롤된다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PREVIEW);
  await page.waitForSelector(".battle-floor");

  const layout = await page.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top + scrollY;
    const growth = document.querySelector(".cozy-growth-nav")! as HTMLElement;
    const profile = document.querySelector(".cozy-profile-summary")! as HTMLElement;
    const rewards = document.querySelector(".cozy-rewards")! as HTMLElement;
    const rewardFold = document.querySelector(".cozy-reward-fold")! as HTMLElement;
    const pip = document.querySelector(".picture-in-picture-compact")! as HTMLElement;
    const tutorial = document.querySelector(".cozy-tutorial-launcher")! as HTMLElement;
    return {
      mode: document.documentElement.dataset.hudLayout,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
      tops: [
        top(".cozy-stage-panel-group"),
        top(".battle-floor"),
        top(".cozy-player-status"),
        top(".cozy-rewards"),
        top(".chat-panel"),
      ],
      growthPosition: getComputedStyle(growth).position,
      growthBottom: innerHeight - growth.getBoundingClientRect().bottom,
      profileUsesFinalAsset: getComputedStyle(profile).backgroundImage.includes("profile-currency-base"),
      rewardsBaseImage: getComputedStyle(rewards).backgroundImage,
      rewardsWidth: rewards.getBoundingClientRect().width,
      rewardFoldDisplay: getComputedStyle(rewardFold).display,
      pipDisplay: getComputedStyle(pip).display,
      tutorialDisplay: getComputedStyle(tutorial).display,
    };
  });

  expect(layout.mode).toBe("mobile");
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.scrollHeight).toBeGreaterThan(layout.viewportHeight);
  expect(layout.tops).toEqual([...layout.tops].sort((a, b) => a - b));
  expect(layout.growthPosition).toBe("fixed");
  expect(layout.growthBottom).toBeGreaterThanOrEqual(0);
  expect(layout.profileUsesFinalAsset).toBe(true);
  expect(layout.rewardsBaseImage).toBe("none");
  expect(layout.rewardsWidth).toBeCloseTo(374, 0);
  expect(layout.rewardFoldDisplay).toBe("none");
  expect(layout.pipDisplay).toBe("none");
  expect(layout.tutorialDisplay).toBe("none");
});

test("태블릿은 HUD를 한 배율로 줄이고 PIP 내용을 버튼 안에 유지한다", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(PREVIEW);
  await page.waitForSelector(".cozy-stage-panel-group");

  const layout = await page.evaluate(() => {
    const button = document.querySelector(".picture-in-picture-toolbar button")!.getBoundingClientRect();
    const label = document.querySelector(".picture-in-picture-label")!.getBoundingClientRect();
    const profile = document.querySelector(".cozy-profile-summary")!.getBoundingClientRect();
    const pip = document.querySelector(".picture-in-picture-compact")!.getBoundingClientRect();
    const tutorial = document.querySelector(".cozy-tutorial-launcher")!.getBoundingClientRect();
    const chat = document.querySelector(".chat-panel")!.getBoundingClientRect();
    const rewards = document.querySelector(".cozy-rewards")! as HTMLElement;
    const rewardFold = document.querySelector(".cozy-reward-fold")! as HTMLElement;
    const status = document.querySelector(".cozy-player-status")!.getBoundingClientRect();
    const growth = document.querySelector(".cozy-growth-nav")!.getBoundingClientRect();
    return {
      mode: document.documentElement.dataset.hudLayout,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      pipContainsLabel: label.left >= button.left && label.right <= button.right,
      profileUsesFinalAsset: getComputedStyle(document.querySelector(".cozy-profile-summary")!).backgroundImage.includes("profile-currency-base"),
      rewardsUsesFinalAsset: getComputedStyle(rewards).backgroundImage.includes("reward-panel-final"),
      rewardFoldDisplay: getComputedStyle(rewardFold).display,
      leftAnchors: [profile.left, pip.left, chat.left],
      pipProfileGap: pip.top - profile.bottom,
      tutorialPipGap: tutorial.left - pip.right,
      chatBottom: innerHeight - chat.bottom,
      statusCenterOffset: Math.abs(status.left + status.width / 2 - innerWidth / 2),
      growthCenterOffset: Math.abs(growth.left + growth.width / 2 - innerWidth / 2),
      scale: getComputedStyle(document.documentElement).getPropertyValue("--hud-ui-scale").trim(),
    };
  });

  expect(layout.mode).toBe("tablet");
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(Number(layout.scale)).toBeCloseTo(0.64, 2);
  expect(layout.pipContainsLabel).toBe(true);
  expect(layout.profileUsesFinalAsset).toBe(true);
  expect(layout.rewardsUsesFinalAsset).toBe(true);
  expect(layout.rewardFoldDisplay).not.toBe("none");
  expect(layout.leftAnchors.every((left) => Math.abs(left - 16) < 1)).toBe(true);
  expect(layout.pipProfileGap).toBeGreaterThanOrEqual(3);
  expect(layout.pipProfileGap).toBeLessThanOrEqual(5);
  expect(layout.tutorialPipGap).toBeGreaterThanOrEqual(5);
  expect(layout.tutorialPipGap).toBeLessThanOrEqual(7);
  expect(layout.chatBottom).toBeCloseTo(16, 0);
  expect(layout.statusCenterOffset).toBeLessThan(1);
  expect(layout.growthCenterOffset).toBeLessThan(1);
});

test("가로형 모바일은 세로 스택 대신 태블릿 배치를 재사용한다", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(PREVIEW);
  await page.waitForSelector(".battle-floor");

  const layout = await page.evaluate(() => ({
    mode: document.documentElement.dataset.hudLayout,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    shellDisplay: getComputedStyle(document.querySelector(".cozy-battle-stage-shell")!).display,
    stagePosition: getComputedStyle(document.querySelector(".cozy-stage-panel-group")!).position,
    growthPosition: getComputedStyle(document.querySelector(".cozy-growth-nav")!).position,
  }));

  expect(layout.mode).toBe("tablet");
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.shellDisplay).not.toBe("flex");
  expect(layout.stagePosition).toBe("absolute");
  expect(layout.growthPosition).toBe("absolute");
});

test("세로형 모바일 거래소는 품목 선택과 거래 상세를 한 단계씩 보여 준다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/market-plaza-preview.html");

  const dialog = page.getByRole("dialog", { name: "거래소" });
  const flow = dialog.getByRole("navigation", { name: "모바일 거래 단계" });
  await expect(flow).toBeVisible();
  await expect(flow.getByRole("button", { name: "품목 선택" })).toHaveClass(/active/);
  await expect(dialog.locator(".market-plaza-catalog")).toBeVisible();
  await expect(dialog.locator(".market-plaza-ticket")).toBeHidden();

  const alert = dialog.locator(".market-plaza-message");
  if (await alert.count()) {
    await expect(alert).toBeVisible();
    const overlap = await dialog.evaluate(element => {
      const tabs = element.querySelector(".market-plaza-tabs")!.getBoundingClientRect();
      const message = element.querySelector(".market-plaza-message")!.getBoundingClientRect();
      return !(message.top >= tabs.bottom || message.bottom <= tabs.top);
    });
    expect(overlap).toBe(false);
  }

  const bounds = await dialog.evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    right: element.getBoundingClientRect().right,
    baseImage: getComputedStyle(element.querySelector(".market-plaza-paper")!).backgroundImage,
  }));
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
  expect(bounds.right).toBeLessThanOrEqual(391);
  expect(bounds.baseImage).toBe("none");

  await dialog.locator(".market-browser-row").filter({ hasText: "강화재료" }).click();
  await dialog.locator(".market-browser-row").filter({ hasText: /^감자/ }).first().click();
  await dialog.locator(".market-browser-row").filter({ hasText: "감자 한 조각" }).first().click();
  await expect(flow.getByRole("button", { name: "거래 상세" })).toHaveClass(/active/);
  await expect(dialog.locator(".market-plaza-catalog")).toBeHidden();
  await expect(dialog.locator(".market-plaza-ticket")).toBeVisible();
});

test("데스크톱 거래소는 기존 세 칸 배치와 탐색 흐름을 유지한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/market-plaza-preview.html");

  const dialog = page.getByRole("dialog", { name: "거래소" });
  await expect(dialog.getByRole("navigation", { name: "모바일 거래 단계" })).toBeHidden();
  await expect(dialog.locator(".market-plaza-catalog")).toBeVisible();
  await expect(dialog.locator(".market-simple")).toBeVisible();
  await expect(dialog.locator(".market-plaza-ticket")).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test("세로형 모바일 장비 화면은 축소판 대신 한 열 스크롤을 사용한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/equipment-preview.html");

  const paper = page.locator(".equipment-paper");
  const layout = page.locator(".equipment-layout");
  const result = await paper.evaluate((element) => {
    const layoutElement = element.querySelector(".equipment-layout") as HTMLElement;
    const stage = element.querySelector(".equipment-loadout-stage")!.getBoundingClientRect();
    const detail = element.querySelector(".equipment-detail-panel")!.getBoundingClientRect();
    return {
      paperWidth: element.getBoundingClientRect().width,
      transform: getComputedStyle(element).transform,
      columns: getComputedStyle(layoutElement).gridTemplateColumns,
      scrolls: layoutElement.scrollHeight > layoutElement.clientHeight,
      stageBeforeDetail: stage.bottom <= detail.top + 1,
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      baseImage: getComputedStyle(element).backgroundImage,
    };
  });

  expect(result.paperWidth).toBeCloseTo(390, 0);
  expect(result.transform).toBe("none");
  expect(result.columns.trim().split(/\s+/)).toHaveLength(1);
  expect(result.scrolls).toBe(true);
  expect(result.stageBeforeDetail).toBe(true);
  expect(result.documentOverflow).toBe(false);
  expect(result.baseImage).toBe("none");
  await expect(layout).toBeVisible();
});

test("세로형 모바일 스킬 화면은 늘어나는 종이 베이스를 사용하지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/skills-preview.html");

  const paper = page.locator(".skills-paper");
  await expect(paper).toBeVisible();
  expect(await paper.evaluate(element => getComputedStyle(element).backgroundImage)).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("세로형 모바일 랭킹은 단상과 배경 없이 순위표만 보여 준다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${PREVIEW}?route=ranking`);
  await expect(page.locator(".ranking-list-panel")).toBeVisible();

  expect(await page.locator(".ranking-podium").evaluate(element => getComputedStyle(element).display)).toBe("none");
  expect(await page.locator(".ranking-screen").evaluate(element => getComputedStyle(element).backgroundImage)).toBe("none");
  expect(await page.locator(".ranking-list-panel").evaluate(element => getComputedStyle(element).backgroundImage)).toBe("none");
  const rankingTop = await page.evaluate(() => {
    const nav = document.querySelector(".cozy-shared-navigation.is-top-bar-only > .cozy-utility-nav")!.getBoundingClientRect();
    const tabs = document.querySelector(".ranking-category-tabs")!.getBoundingClientRect();
    return { navTop: nav.top, separated: nav.bottom <= tabs.top };
  });
  expect(rankingTop.navTop).toBeLessThanOrEqual(7);
  expect(rankingTop.separated).toBe(true);
});

test("세로형 모바일 치장 뽑기는 키 아트 아래에 두 단추를 두고 결과를 세로로 쌓는다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${PREVIEW}?route=cosmetics`);
  await expect(page.locator(".cosmetic-showcase-frame, .cosmetic-showcase-fallback")).toBeVisible();

  const buttons = page.locator(".cosmetic-cost-buttons button");
  await expect(buttons).toHaveCount(2);
  const before = await page.evaluate(() => ({
    background: getComputedStyle(document.querySelector(".cosmetic-screen")!).backgroundImage,
    hero: getComputedStyle(document.querySelector(".cosmetic-ticket-hero")!).display,
    columns: getComputedStyle(document.querySelector(".cosmetic-cost-buttons")!).gridTemplateColumns,
  }));
  expect(before.background).toBe("none");
  expect(before.hero).toBe("none");
  expect(before.columns.trim().split(/\s+/)).toHaveLength(2);
  expect(await buttons.first().evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.height >= 74 && box.width / box.height <= 3.1;
  })).toBe(true);

  await buttons.first().click();
  await expect(page.locator(".cosmetic-reveal-stage")).toBeVisible();
  expect(await page.locator(".cosmetic-result-grid").evaluate(element => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length)).toBe(1);
});

test("세로형 모바일 던전은 책 베이스 없이 선택과 정보를 수직 배치한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${PREVIEW}?route=dungeon`);
  await expect(page.locator(".dungeon-book-screen")).toBeVisible();

  const layout = await page.locator(".dungeon-book-screen").evaluate(element => ({
    background: getComputedStyle(element).backgroundImage,
    direction: getComputedStyle(element).flexDirection,
    scrollWidth: document.documentElement.scrollWidth,
    selectionBottom: element.querySelector(".dungeon-bookmarks")!.getBoundingClientRect().bottom,
    featureTop: element.querySelector(".dungeon-feature")!.getBoundingClientRect().top,
    ribbon: element.querySelector(".dungeon-open-ribbon")!.getBoundingClientRect().toJSON(),
    ribbonShell: element.querySelector(".dungeon-open-ribbon-shell")!.getBoundingClientRect().toJSON(),
    actionTops: [...element.querySelectorAll(".dungeon-primary-actions > button")].map(button => button.getBoundingClientRect().top),
    actionColumns: getComputedStyle(element.querySelector(".dungeon-primary-actions")!).gridTemplateColumns.trim().split(/\s+/).length,
    selectionColumns: getComputedStyle(element.querySelector(".dungeon-bookmarks")!).gridTemplateColumns.trim().split(/\s+/).length,
    selectionCount: element.querySelectorAll(".dungeon-bookmark").length,
    selectionIconsHidden: [...element.querySelectorAll(".dungeon-bookmark-head img")].every(icon => getComputedStyle(icon).display === "none"),
    openingLabelsHidden: [...element.querySelectorAll(".dungeon-bookmark > em")].every(label => getComputedStyle(label).display === "none"),
    screenScrolls: (() => {
      const screen = element.closest(".gems-dungeon-screen")!;
      return screen.scrollHeight > screen.clientHeight;
    })(),
    rewardsBottom: element.querySelector(".dungeon-rewards")!.getBoundingClientRect().bottom,
    rankingTop: element.querySelector(".dungeon-ranking")!.getBoundingClientRect().top,
    rewardFontSize: Number.parseFloat(getComputedStyle(element.querySelector(".dungeon-rewards article > span")!).fontSize),
    actionFontSizes: [...element.querySelectorAll(".dungeon-primary-actions > button")].map(button => Number.parseFloat(getComputedStyle(button).fontSize)),
    myRankGap: (() => {
      const list = element.querySelector(".dungeon-ranking-list")?.getBoundingClientRect();
      const mine = element.querySelector(".dungeon-my-rank")?.getBoundingClientRect();
      return list && mine ? mine.top - list.bottom : 0;
    })(),
    rankingBackground: getComputedStyle(element.querySelector(".dungeon-ranking")!).backgroundColor,
    lastRankBackground: getComputedStyle(element.querySelector(".dungeon-ranking-list li:last-child")!).backgroundColor,
  }));
  expect(layout.background).toBe("none");
  expect(layout.direction).toBe("column");
  expect(layout.scrollWidth).toBeLessThanOrEqual(391);
  expect(layout.selectionBottom).toBeLessThanOrEqual(layout.featureTop);
  expect(layout.ribbonShell.width).toBeLessThanOrEqual(layout.ribbon.width + 1);
  expect(layout.ribbonShell.height).toBeLessThanOrEqual(layout.ribbon.height + 1);
  expect(layout.actionColumns).toBe(2);
  expect(new Set(layout.actionTops.map(top => Math.round(top))).size).toBe(1);
  expect(layout.selectionColumns).toBe(3);
  expect(layout.selectionCount).toBe(3);
  expect(layout.selectionIconsHidden).toBe(true);
  expect(layout.openingLabelsHidden).toBe(true);
  expect(layout.screenScrolls).toBe(true);
  expect(layout.rewardsBottom).toBeLessThanOrEqual(layout.rankingTop);
  expect(layout.rewardFontSize).toBeLessThanOrEqual(14);
  expect(layout.actionFontSizes.every(size => size <= 18)).toBe(true);
  expect(layout.myRankGap).toBeLessThanOrEqual(6);
  expect(layout.rankingBackground).toBe("rgb(255, 250, 240)");
  expect(layout.lastRankBackground).toBe(layout.rankingBackground);

  await page.locator(".dungeon-ranking").scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "던전 랭킹" })).toBeVisible();
  expect(await page.locator(".dungeon-ranking-list time").first().evaluate(element => getComputedStyle(element).display)).toBe("none");
});

test("세로형 모바일 보석 관리는 무베이스 한 열 작업 흐름을 사용한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/gem-preview.html");
  await expect(page.locator(".gem-management-window")).toBeVisible();

  const layout = await page.evaluate(() => ({
    background: getComputedStyle(document.querySelector(".gem-management-window")!).backgroundImage,
    presetDirection: getComputedStyle(document.querySelector(".gem-preset-page")!).flexDirection,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.background).toBe("none");
  expect(layout.presetDirection).toBe("column");
  expect(layout.scrollWidth).toBeLessThanOrEqual(391);
});

test("세로형 모바일 보석 직접 합성은 세 재료와 결과를 한 줄에 둔다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PREVIEW);
  await page.getByRole("button", { name: "보석" }).click();
  await page.getByRole("tab", { name: /합성/ }).last().click();
  await expect(page.locator(".gem-fusion-equation")).toBeVisible();

  const layout = await page.locator(".gem-fusion-equation").evaluate(element => ({
    columns: getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
    width: element.getBoundingClientRect().width,
    viewport: innerWidth,
    ingredientTops: [...element.querySelectorAll(".gem-fusion-ingredient")].map(item => item.getBoundingClientRect().top),
  }));
  expect(layout.columns).toBe(5);
  expect(new Set(layout.ingredientTops.map(top => Math.round(top))).size).toBe(1);
  expect(layout.width).toBeLessThanOrEqual(layout.viewport);
});

test("세로형 모바일 HUD 팝오버와 채팅은 패널 폭 안에서 정렬된다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PREVIEW);

  await page.locator(".cozy-stage-picker > summary").click();
  const picker = page.getByRole("dialog", { name: "스테이지 선택" });
  await expect(picker).toBeVisible();
  const stageLayout = await page.evaluate(() => {
    const stage = document.querySelector(".cozy-stage-panel-group")!.getBoundingClientRect();
    const picker = document.querySelector(".cozy-stage-picker-panel")!.getBoundingClientRect();
    return { below: picker.top >= stage.bottom - 2, inside: picker.left >= 0 && picker.right <= innerWidth };
  });
  expect(stageLayout.below).toBe(true);
  expect(stageLayout.inside).toBe(true);

  await page.getByRole("button", { name: "콘텐츠" }).click();
  const dropdown = page.getByRole("navigation", { name: "콘텐츠 메뉴" });
  await expect(dropdown).toBeVisible();
  expect(await dropdown.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth;
  })).toBe(true);

  const chatLayout = await page.locator(".chat-panel").evaluate(element => {
    const panel = element.getBoundingClientRect();
    const more = element.querySelector(".chat-more")!.getBoundingClientRect();
    const collapse = element.querySelector(".chat-collapse")!.getBoundingClientRect();
    const composer = element.querySelector(".chat-composer")!.getBoundingClientRect();
    return {
      moreBeforeCollapse: more.right <= collapse.left,
      composerFills: composer.left - panel.left <= 18 && panel.right - composer.right <= 18,
    };
  });
  expect(chatLayout.moreBeforeCollapse).toBe(true);
  expect(chatLayout.composerFills).toBe(true);
});

test("세로형 모바일 캐릭터 능력치와 설정은 긴 베이스 없이 읽힌다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PREVIEW);
  await page.getByRole("button", { name: "캐릭터" }).click();
  await expect(page.locator(".ability-summary-layout")).toBeVisible();
  const character = await page.locator(".ability-summary-layout").evaluate(element => ({
    display: getComputedStyle(element).display,
    backgrounds: [...element.querySelectorAll(".ability-summary-profile, .ability-stat-group, .ability-summary-power")].map(panel => getComputedStyle(panel).backgroundImage),
    supportColumns: getComputedStyle(element.querySelector(".ability-stat-group.is-support .ability-stat-rows")!).gridTemplateColumns.trim().split(/\s+/).length,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
  }));
  expect(character.display).toBe("grid");
  expect(character.backgrounds.every(background => background === "none")).toBe(true);
  expect(character.supportColumns).toBe(1);
  expect(character.overflow).toBe(false);
  await page.getByRole("button", { name: /닫기/ }).first().click();

  await page.getByRole("button", { name: "설정" }).click();
  await expect(page.locator(".profile-paper")).toBeVisible();
  const settings = await page.locator(".profile-paper").evaluate(element => ({
    width: element.getBoundingClientRect().width,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    sidebarPosition: getComputedStyle(element.querySelector(".profile-sidebar")!).position,
  }));
  expect(settings.width).toBeLessThanOrEqual(390);
  expect(settings.scrollWidth).toBeLessThanOrEqual(settings.clientWidth + 1);
  expect(settings.sidebarPosition).toBe("static");
});

test("세로형 모바일 챕터 선택은 두 열과 세로형 하단 정보로 배치된다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PREVIEW);
  await page.getByRole("button", { name: "챕터" }).click();
  const dialog = page.getByRole("dialog", { name: "챕터 선택" });
  await expect(dialog).toBeVisible();
  const layout = await dialog.evaluate(element => ({
    background: getComputedStyle(element).backgroundImage,
    columns: getComputedStyle(element.querySelector(".chapter-select-shops")!).gridTemplateColumns.trim().split(/\s+/).length,
    footerDirection: getComputedStyle(element.querySelector(".chapter-select-footer")!).flexDirection,
    footerBorderRadius: getComputedStyle(element.querySelector(".chapter-select-footer")!).borderRadius,
    backdropZ: Number(getComputedStyle(element.closest(".chapter-select-backdrop")!).zIndex),
    enterWidthRatio: element.querySelector(".chapter-select-enter")!.getBoundingClientRect().width / element.querySelector(".chapter-select-footer")!.getBoundingClientRect().width,
    enterAspectRatio: element.querySelector(".chapter-select-enter")!.getBoundingClientRect().width / element.querySelector(".chapter-select-enter")!.getBoundingClientRect().height,
    overflow: element.scrollWidth > element.clientWidth + 1,
  }));
  expect(layout.background).toBe("none");
  expect(layout.columns).toBe(2);
  expect(layout.footerDirection).toBe("column");
  expect(layout.footerBorderRadius).toBe("0px");
  expect(layout.backdropZ).toBeGreaterThan(100);
  expect(layout.enterWidthRatio).toBeCloseTo(.5, 1);
  expect(layout.enterAspectRatio).toBeCloseTo(2172 / 762, 1);
  expect(await page.locator(".stage-panel-preview-controls").evaluate(element => getComputedStyle(element).display)).toBe("none");
  expect(layout.overflow).toBe(false);
});
