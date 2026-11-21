import type { Page } from "@playwright/test";

/*
 * 전투 화면의 자리를 재는 자. 브라우저에서 각 칸의 사각형을 받아 서로 덮는지,
 * 화면 밖으로 나갔는지를 센다.
 */

/* 화면에 떠 있는 HUD 칸. 서로 덮으면 안 된다. */
export const HUD_PANELS = [
  ".cozy-profile-summary",
  ".cozy-history-trigger",
  ".cozy-tutorial-launcher",
  ".cozy-stage-cluster",
  ".cozy-utility-nav",
  ".cozy-rewards",
  ".cozy-player-status",
  ".cozy-growth-nav",
  ".cozy-stage-restart",
  ".cozy-idle-status",
  ".chat-panel",
  ".picture-in-picture-shell",
] as const;

/* 무대 위 인물. HUD 에 덮이면 전투가 안 보인다. */
export const ACTORS = { hero: ".dungeon-current-character", monster: ".battle-monster" } as const;

/*
 * 프로필·전투 기록·튜토리얼, 스테이지 패널·전투 기록·재시작은 서로 붙여 그린
 * 디자인이다. 기준 크기인 1600x900 에서도 겹쳐 있으므로 겹침으로 세지 않는다.
 */
const INTENTIONAL_TUCKS = new Set([
  ".cozy-profile-summary|.cozy-history-trigger",
  ".cozy-history-trigger|.cozy-tutorial-launcher",
  ".cozy-history-trigger|.cozy-stage-cluster",
  ".cozy-stage-cluster|.cozy-stage-restart",
]);

export type Rect = { x: number; y: number; right: number; bottom: number; width: number; height: number };
export type Overlap = { a: string; b: string; width: number; height: number };
export type Measurement = {
  viewport: { width: number; height: number };
  panels: Record<string, Rect>;
  actors: Partial<Record<keyof typeof ACTORS, Rect>>;
  panelOverlaps: Overlap[];
  outOfBounds: string[];
  actorCoverage: Overlap[];
};

/* 겹친 면이 2px 를 넘을 때만 센다. 테두리 그림자와 반올림은 겹침이 아니다. */
const TOLERANCE = 2;

/*
 * 종이 장식과 접기 탭은 그림 자체가 viewport 경계에 걸치도록 배치된다. 보이는 내용이
 * 잘린 것이 아니라 의도된 bleed이므로, 이 값보다 더 나갔을 때만 회귀로 센다.
 */
const EDGE_BLEED: Partial<Record<(typeof HUD_PANELS)[number], Partial<Record<"top" | "right" | "bottom" | "left", number>>>> = {
  ".cozy-stage-cluster": { top: 32 },
  ".cozy-rewards": { right: 8 },
};

function intersect(a: Rect, b: Rect): { width: number; height: number } | null {
  const width = Math.min(a.right, b.right) - Math.max(a.x, b.x);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
  return width > TOLERANCE && height > TOLERANCE ? { width, height } : null;
}

/*
 * 전투 중에는 인물이 서로에게 다가가고(--encounter-step) 계속 흔들린다. 그 도중에 재면
 * 같은 창에서도 값이 달라져 검사가 흔들린다. 시간만 멈추고 자세는 그대로 둔다.
 * --encounter-step 을 0 으로 만들면 인물이 쉬는 자리로 물러나 전투 중 자리가 아니게 되므로
 * 건드리지 않는다. 우리가 보려는 것은 전투가 돌아가는 동안의 가림이다.
 */
export async function freezeMotion(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-play-state: paused !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });
}

/*
 * 보스전에는 체력 막대가 붙어 스테이지 판이 길어진다. 실제 보스를 띄우려면 전투를
 * 진행시켜야 하므로, 같은 마크업의 막대를 끼워 넣어 그 길이만 재현한다.
 */
export async function attachBossHealthBar(page: Page) {
  await page.evaluate(() => {
    const progress = document.querySelector(".cozy-stage-progress");
    if (!progress || progress.querySelector(".cozy-boss-health")) return;
    const bar = document.createElement("div");
    bar.className = "cozy-boss-health";
    bar.innerHTML =
      '<div class="cozy-boss-health-copy"><strong>보스</strong><span>782 / 782</span></div>' +
      '<div class="cozy-boss-health-track"><i style="width:80%"></i></div>';
    progress.appendChild(bar);
  });
}

/*
 * 픽셀 글꼴과 도트 그림이 다 올라오기 전에 재면 칸 크기가 달라진다. 워커를 여럿 돌릴 때만
 * 어긋나던 원인이 이것이었다: 화면은 떠 있는데 글꼴이 아직 기본 글꼴이라 글자 폭이 달랐다.
 */
async function waitForPaintedAssets(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const pending = [...document.images].filter((image) => !image.complete);
    await Promise.all(
      pending.map((image) => new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      })),
    );
  });
}

export async function measureBattleHud(page: Page): Promise<Measurement> {
  await waitForPaintedAssets(page);
  const raw = await page.evaluate(
    ({ panelSelectors, actorSelectors }) => {
      const read = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return null;
        return {
          x: Math.round(r.left),
          y: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      };
      const panels: Record<string, ReturnType<typeof read>> = {};
      for (const selector of panelSelectors) panels[selector] = read(selector);
      const actors: Record<string, ReturnType<typeof read>> = {};
      for (const [name, selector] of Object.entries(actorSelectors)) actors[name] = read(selector);
      return {
        panels,
        actors,
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      };
    },
    { panelSelectors: [...HUD_PANELS], actorSelectors: ACTORS },
  );

  const panels: Record<string, Rect> = {};
  for (const [selector, rect] of Object.entries(raw.panels)) if (rect) panels[selector] = rect;
  const actors: Partial<Record<keyof typeof ACTORS, Rect>> = {};
  for (const [name, rect] of Object.entries(raw.actors)) if (rect) actors[name as keyof typeof ACTORS] = rect;

  const present = Object.keys(panels);
  const panelOverlaps: Overlap[] = [];
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      const [a, b] = [present[i], present[j]];
      if (INTENTIONAL_TUCKS.has(`${a}|${b}`) || INTENTIONAL_TUCKS.has(`${b}|${a}`)) continue;
      const hit = intersect(panels[a], panels[b]);
      if (hit) panelOverlaps.push({ a, b, ...hit });
    }
  }

  const outOfBounds = present
    .filter((selector) => {
      const r = panels[selector];
      const bleed = EDGE_BLEED[selector as (typeof HUD_PANELS)[number]] ?? {};
      return r.x < -(bleed.left ?? TOLERANCE)
        || r.y < -(bleed.top ?? TOLERANCE)
        || r.right > raw.viewport.width + (bleed.right ?? TOLERANCE)
        || r.bottom > raw.viewport.height + (bleed.bottom ?? TOLERANCE);
    })
    .map((selector) => `${selector} (${panels[selector].x},${panels[selector].y})-(${panels[selector].right},${panels[selector].bottom})`);

  const actorCoverage: Overlap[] = [];
  for (const [name, actor] of Object.entries(actors)) {
    for (const selector of present) {
      const hit = intersect(actor as Rect, panels[selector]);
      if (hit) actorCoverage.push({ a: name, b: selector, ...hit });
    }
  }

  return { viewport: raw.viewport, panels, actors, panelOverlaps, outOfBounds, actorCoverage };
}

export const formatOverlaps = (overlaps: Overlap[]) =>
  overlaps.map((o) => `${o.a} × ${o.b} ${o.width}×${o.height}px`).join("; ");
