import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

/*
 * 좁은 화면에서 HUD 칸들이 서로를 덮던 문제(U6)를 붙잡아 두는 자리다. 자리 계산은
 * 브라우저가 하므로 여기서 겹침을 직접 잴 수는 없다. 대신 겹치지 않게 만든 규칙,
 * 곧 "자리를 손으로 고르지 않고 기준선에서 끌어 쓴다"는 약속이 남아 있는지 본다.
 */
const hud = readFileSync(resolve(process.cwd(), "src/features/battle/BattleHud.css"), "utf8");
const appShell = readFileSync(resolve(process.cwd(), "src/app-shell.css"), "utf8");
const tutorial = readFileSync(resolve(process.cwd(), "src/features/tutorial/TutorialLauncher.css"), "utf8");
const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
const battleScreen = readFileSync(resolve(process.cwd(), "src/features/battle/BattleScreen.tsx"), "utf8");
const viewportContract = "@media (min-width: 768px)";
const battleScreenCss = readFileSync(resolve(process.cwd(), "src/features/battle/BattleScreen.css"), "utf8");

function block(css: string, header: string) {
  const start = css.indexOf(header);
  expect(start, `${header} 블록이 없다`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`${header} 블록이 닫히지 않았다`);
}

/* 캐릭터 창은 Esc로 닫힐 때 원래 눌렀던 메뉴 버튼으로 포커스를 돌려준다. 포커스를
 * 호버와 같은 상태로 그리면 마우스가 없어도 확대 배경과 전역 주황 테두리가 남는다. */
it("캐릭터 창을 닫아 포커스가 돌아와도 하단 메뉴를 호버 상태로 표시하지 않는다", () => {
  const growthNav = hud.slice(hud.indexOf(".cozy-growth-nav {"), hud.indexOf("@media (max-width: 1279px)"));

  expect(growthNav).toContain(".cozy-growth-nav button:focus { outline: 0; }");
  expect(growthNav).not.toContain("focus-visible:not(:disabled)::before");
  expect(growthNav).not.toMatch(/focus-visible[^\{]*> (?:img|span)/);
});

/* 재시작만 배율에서 빠져 있어 이웃과 다른 자 위에서 자리를 잡았고, 그래서 획득 패널에 덮였다. */
it("재시작 단추도 나머지 HUD 와 같은 배율로 줄어든다", () => {
  const zoomed = hud.slice(hud.indexOf(".cozy-battle-stage-shell > .cozy-profile-summary"), hud.indexOf("zoom: var(--cozy-hud-zoom);"));

  expect(zoomed).toContain(".cozy-battle-stage-shell > .battle-kitchen > .cozy-stage-restart");
});

it("레벨 패널을 하단 메뉴 중앙 위에 80% 크기와 8px 간격으로 둔다", () => {
  const desktop = block(hud, viewportContract);

  expect(desktop).toContain(".cozy-battle-stage-shell > .battle-kitchen > .cozy-player-status { scale: calc(var(--hud-ui-scale, 1) * .8); }");
  expect(desktop).toContain("bottom: calc(var(--hud-edge-bottom) + (90px * var(--hud-ui-scale, 1)) + 8px)");
  expect(hud).toMatch(/\.cozy-player-status \{[\s\S]*?left: 50%;[\s\S]*?margin-left: -288px;[\s\S]*?transform: none;/);
});

it("하단 성장 메뉴는 축소되어도 화면 중앙과 공용 서체를 유지한다", () => {
  const growthNav = hud.match(/\.cozy-growth-nav \{\r?\n  position: absolute;[\s\S]*?\}/)?.[0];
  const growthButton = block(hud, ".cozy-growth-nav button {");
  const desktop = block(hud, viewportContract);

  expect(growthNav).toBeTruthy();
  expect(growthNav).toContain("left: 50%");
  expect(growthNav).toContain("transform: translateX(-50%)");
  expect(desktop).toMatch(/\.cozy-battle-stage-shell > \.battle-kitchen > \.cozy-growth-nav \{[\s\S]*?right: 0;[\s\S]*?left: 0;[\s\S]*?margin-inline: auto;[\s\S]*?transform: none;/);
  expect(growthButton).toContain("font-family: var(--hanjjak-font-ui)");
  expect(growthButton).not.toContain("GeekbleMalang2");
});

it("데스크톱에서 전투 인물을 HUD보다 키우고 상태 패널 위로 올린다", () => {
  const desktop = block(hud, viewportContract);

  expect(desktop).toContain(".cozy-battle-stage-shell > .chat-panel { scale: var(--hud-ui-scale, 1); transform-origin: bottom left; }");
  expect(desktop).toContain(".cozy-battle-stage-shell > .battle-kitchen > .battle-skill-cooldowns { scale: var(--hud-ui-scale, 1); transform-origin: bottom right; }");
  expect(desktop).toMatch(/\.cozy-battle-stage-shell > \.battle-kitchen > \.battle-floor \{[\s\S]*?bottom: calc\(\(160px \* var\(--hud-ui-scale, 1\)\) \+ 70px\);[\s\S]*?scale: calc\(var\(--hud-ui-scale, 1\) \+ \.1\);/);
});

it("데스크톱 PIP와 튜토리얼 단추를 프로필 가까이 붙인다", () => {
  const desktop = block(hud, viewportContract);

  expect(desktop).toMatch(/\.game-shell > \.picture-in-picture-compact \{[\s\S]*?top: calc\(var\(--hud-edge-top\) \+ 72px\);/);
  expect(appShell).toContain("top: calc(var(--hud-edge-top, 20px) + 72px)");
  expect(desktop).toMatch(/\.cozy-battle-stage-shell > \.cozy-tutorial-launcher \{[\s\S]*?top: calc\(var\(--hud-edge-top\) \+ 72px\);[\s\S]*?left: calc\(var\(--hud-edge-left\) \+ 93px\);/);
});

/*
 * 성장 메뉴가 가로를 다 쓰는 구간에서 재시작을 획득 패널 위(bottom: 196px)로 올려 두었더니
 * 도리어 그 패널에 덮였다. 지금은 성장 메뉴와 같은 줄에 서고, 메뉴가 그 폭을 비워 준다.
 */
it("성장 메뉴가 재시작 단추의 폭만큼 오른쪽을 비운다", () => {
  const narrow = block(hud, "@media (max-width: 900px)");

  expect(narrow).toContain("--cozy-hud-restart-edge) + var(--cozy-hud-restart-size)");
  /* 관리 화면에는 재시작이 없으니 그 화면의 성장 메뉴까지 좁히면 안 된다. */
  expect(narrow).toMatch(/\.cozy-battle-stage-shell \.cozy-growth-nav \{/);
  expect(narrow).toContain(".cozy-growth-nav { width: calc(100% - 32px); min-width: 0; }");
});

it("재시작 단추가 아래 줄에 서고 획득 패널 위로 올라가지 않는다", () => {
  const restart = hud.slice(hud.indexOf(".cozy-stage-restart {"));

  expect(restart).toContain("bottom: 30px");
  /* 획득 패널 높이를 넘겨 짚어 잡아 둔 옛 자리. 다시 생기면 안 된다. */
  expect(restart).not.toContain("bottom: 196px");
});

/*
 * 스테이지 판이 가로를 다 쓰면 왼쪽·오른쪽 세로줄이 그 아래로 내려와야 한다. 내려오는
 * 자리를 각자 손으로 적어 두었던 탓에 판이 길어지면(보스 체력 막대) 다 같이 겹쳤다.
 */
it("좁은 화면의 세로줄이 모두 한 기준선에서 시작한다", () => {
  const narrow = block(hud, "@media (max-width: 1080px)");

  expect(narrow).toContain("--cozy-hud-column-top: calc(var(--cozy-hud-stage-top) + var(--cozy-hud-stage-reserve))");
  expect(hud).toMatch(/\.cozy-battle-stage-shell > \.cozy-stage-panel-group \{[\s\S]*?top: var\(--cozy-hud-stage-top\);/);
  expect(narrow).toContain(".cozy-history { top: var(--cozy-hud-column-top); }");
  expect(narrow).toContain(".picture-in-picture-compact { top: var(--cozy-hud-column-top)");
  expect(narrow).toContain("top: calc(var(--cozy-hud-column-top) + var(--cozy-hud-pip-step))");
  expect(tutorial).toContain("top: calc(var(--cozy-hud-column-top) + var(--cozy-hud-trigger-step))");
});

/* 보스전에는 체력 막대가 붙어 판이 길어진다. 기준선도 같이 내려가야 한다. */
it("보스 체력 막대가 붙으면 기준선이 그만큼 내려간다", () => {
  expect(hud).toMatch(/\.cozy-battle-stage-shell:has\(\.cozy-boss-health\) \{ --cozy-hud-stage-reserve: \d+px; \}/);
});

/* 획득 패널은 세로로 자라는 목록이다. 아래 칸까지 자라 내려오지 않게 위아래로 묶어 둔다. */
it("획득 패널이 아래 칸 자리까지 자라지 않는다", () => {
  const narrow = block(hud, "@media (max-width: 1080px)");
  const rewards = narrow.slice(narrow.indexOf(".cozy-rewards {"));

  expect(rewards).toContain("max-height: calc(100% - var(--cozy-hud-column-top) - var(--cozy-hud-pip-step) - var(--cozy-hud-bottom-reserve))");
  expect(rewards).toContain("overflow: auto");
});

/*
 * body 는 전투 화면에서 넘침을 자른다. 그런데 좁은 화면일수록 상자를 더 길게(760px,
 * 980px) 잡아 두어, 화면보다 긴 만큼이 잘려 성장 메뉴가 아예 보이지 않았다.
 */
it("좁은 화면에서 무대 상자를 화면보다 길게 잡지 않는다", () => {
  const narrow = block(hud, "@media (max-width: 1080px)");

  expect(hud).toContain("body:has(.battle-screen-live) { overflow: hidden; }");
  expect(narrow).toContain(".battle-stage-shell.cozy-battle-stage-shell { min-height: 0; max-height: none; }");
  expect(hud).not.toContain("min-height: 760px; max-height: none");
  expect(hud).not.toContain("min-height: 980px");
});

/* 프로필과 마을 메뉴가 나란히 서기 좁아지는 구간. 메뉴가 한 줄 내려가고 프로필을 비켜야 한다. */
it("가장 좁은 구간에서 마을 메뉴가 프로필 아래 줄로 내려간다", () => {
  const narrowest = block(hud, "@media (max-width: 620px)");
  const profileBottom = 10 + 86;

  expect(narrowest).toMatch(/\.cozy-utility-nav \{[^}]*top: (\d+)px;/);
  const top = Number(/\.cozy-utility-nav \{[^}]*top: (\d+)px;/.exec(narrowest)![1]);
  expect(top).toBeGreaterThanOrEqual(profileBottom);
});

/*
 * 채팅은 왼쪽 아래에 떠 있다. 아래 칸이 가로로 벌어지면 그 위를 덮으므로 빈 띠로 올라가는데,
 * 스스로 줄어들 수 있어야 한다. 바닥 높이(min-height: 330px)가 남아 있으면 줄지 못한다.
 */
it("좁은 화면의 채팅이 남은 띠만큼 줄어든다", () => {
  const narrow = block(hud, "@media (max-width: 1279px), (max-height: 719px)");

  expect(narrow).toContain(".cozy-battle-stage-shell .chat-panel { bottom: var(--cozy-hud-chat-bottom); }");
  expect(narrow).toContain("min-height: 0;");
  expect(narrow).toContain("max-height: calc((100% - var(--cozy-hud-chat-top) - var(--cozy-hud-chat-bottom) - 12px) / var(--cozy-hud-zoom))");
});

/*
 * 화면이 좁아질수록 조작 칸도 같이 작아져야 무대에 자리가 남는다. 마을 메뉴 단추는
 * 1fr 로 늘어나 있어 620px 에서 데스크톱(62px)보다 넓은 108px 이 되었고, 스테이지 판은
 * 가로를 다 쓰면서 키까지 커졌다. 구간마다 한 단계씩 줄어드는지 본다.
 */
function trackSize(css: string, header: string) {
  const found = /\.cozy-utility-nav \{[^}]*grid-template-columns: repeat\(var\(--cozy-utility-columns\), (?:minmax\(0, )?(\d+)px/.exec(block(css, header));
  expect(found, `${header} 에 마을 메뉴 칸 크기가 없다`).toBeTruthy();
  return Number(found![1]);
}

it("좁아질수록 마을 메뉴 단추가 한 단계씩 작아진다", () => {
  const steps = [
    /grid-template-columns: repeat\(var\(--cozy-utility-columns\), (\d+)px\)/.exec(hud.slice(0, hud.indexOf("@media (max-width: 1279px), (max-height: 719px)")))![1],
    trackSize(hud, "@media (max-width: 1279px), (max-height: 719px)"),
    trackSize(hud, "@media (max-width: 1080px)"),
    trackSize(hud, "@media (max-width: 620px)"),
    trackSize(hud, "@media (max-width: 480px)"),
  ].map(Number);

  expect(steps).toEqual([...steps].sort((a, b) => b - a));
  expect(new Set(steps).size, "같은 크기가 겹치면 한 단계가 헛돈다").toBe(steps.length);
});

/* 늘어나는 칸(1fr)은 좁은 화면에서 단추를 도리어 넓힌다. 고정 칸으로 두어야 줄어든다. */
it("마을 메뉴가 좁은 화면에서 가로로 늘어나지 않는다", () => {
  const narrowest = block(hud, "@media (max-width: 620px)");

  expect(narrowest).not.toMatch(/grid-template-columns: repeat\(var\(--cozy-utility-columns\), 1fr\)/);
  expect(narrowest).toContain("justify-content: end;");
});

it("좁아질수록 성장 메뉴 그림과 스테이지 줄도 같이 작아진다", () => {
  const img = (header: string | null) => {
    const css = header ? block(hud, header) : hud.slice(0, hud.indexOf("@media (max-width: 1180px)"));
    return Number(/\.cozy-growth-nav button > img \{ width: (\d+)px/.exec(css)![1]);
  };
  const row = (header: string) => Number(/\.cozy-stage-mode \{ min-height: (\d+)px/.exec(block(hud, header))![1]);

  const images = [img(null), img("@media (max-width: 1080px)"), img("@media (max-width: 620px)"), img("@media (max-width: 480px)")];
  expect(images).toEqual([...images].sort((a, b) => b - a));

  /* 스테이지 줄은 기본 36px 에서 시작한다. */
  expect(row("@media (max-width: 620px)")).toBeLessThan(36);
  expect(row("@media (max-width: 480px)")).toBeLessThan(row("@media (max-width: 620px)"));
});

/*
 * 이름을 감추고 네모만 남기던 규칙이 빈 네모를 만들었다. 화살표가 currentColor 를 따라
 * 같이 투명해졌고, 화살표를 되살리던 짝 규칙은 마크업에서 span 이 사라져 붙을 데가 없었다.
 */
it("스테이지 선택 단추를 빈 네모로 만들지 않는다", () => {
  const narrowest = block(hud, "@media (max-width: 620px)");

  expect(narrowest).not.toContain("color: transparent");
  /* 짝(span)을 잃은 규칙을 이 구간에 다시 들이면 같은 일이 벌어진다. 설명하는 글이
     아니라 실제 규칙만 본다. */
  expect(narrowest).not.toMatch(/summary span\s*\{/);
  /* 이름이 보이려면 폭을 네모로 묶어 두어서도 안 된다. */
  expect(narrowest).not.toMatch(/\.cozy-stage-picker summary \{[^}]*width: \d+px/);
});

it("상단바 전용 화면도 메인 전투와 같은 버튼 크기를 유지한다", () => {
  expect(hud).toContain(".cozy-shared-navigation.is-top-bar-only > .cozy-utility-nav button { width: 59px; min-width: 59px; height: 59px; min-height: 59px;");
  expect(hud).toContain(".cozy-shared-navigation.is-top-bar-only > .cozy-utility-nav img { width: 46px; height: 46px; }");
});

it("전체 화면 배경과 전투 무대가 접히지 않도록 중간 화면 높이를 전달한다", () => {
  const desktop = block(hud, viewportContract);

  expect(main).toContain('className="battle-stage-mount"');
  expect(hud).toMatch(/\.game-shell > \.battle-stage-mount \{[^}]*width: 100%;[^}]*height: 100%;[^}]*min-height: 0;/);
  expect(hud).toContain(".game-shell > .battle-stage-mount[hidden] { display: none; }");
  expect(desktop).toMatch(/\.battle-screen-live \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?min-height: 0;/);
  expect(desktop).toMatch(/\.battle-stage-shell\.cozy-battle-stage-shell \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;/);
});

it("정상 전투 중에는 중복 연결 상태 배지를 표시하지 않는다", () => {
  expect(battleScreen).toContain("{(!connected || retry) && <p className={`battle-connection");
  expect(battleScreen).not.toContain('fighting ? `${formatStageId(selectedStageId)} 전투 진행 중`');
});

it("다음 사이클 적용 안내를 더 크게 표시하고 아래로 내린다", () => {
  expect(hud).toContain(".cozy-idle-status { position: absolute; z-index: 13; top: 182px;");
  expect(hud).toContain("font-size: 13px;");
  expect(hud).toContain(".cozy-idle-status { top: calc(var(--cozy-hud-stage-top) + 104px); }");
  expect(hud).toContain(".cozy-idle-status { top: calc(var(--cozy-hud-stage-top) + 120px);");
});

it("잠긴 보석 메뉴는 버튼 위에 1-5 해금 툴팁을 표시한다", () => {
  const tooltip = hud.slice(hud.indexOf(".cozy-growth-nav button:disabled:hover::after"));
  expect(tooltip).toContain("bottom: calc(100% - 8px)");
  expect(tooltip).toContain("content: attr(data-disabled-reason)");
  expect(tooltip).toContain("content-menu-tooltip-down-v6.webp");
});

it("넓은 전투 화면에서 화면 가장자리로 이동한 랭킹·설정 버튼을 자르지 않는다", () => {
  const desktop = block(hud, viewportContract);
  expect(desktop).toMatch(/\.battle-stage-shell\.cozy-battle-stage-shell \{[\s\S]*?overflow: visible;/);
  expect(desktop).toContain(".cozy-battle-stage-shell > .battle-kitchen { background: transparent; }");
  expect(desktop).toContain("width: 100vw;");
  expect(desktop).toContain("height: 100dvh;");
  expect(desktop).not.toContain("scale(min(100vw");
});

it("잠금 툴팁은 해당 행 중앙에 Figma 160x45 크기로 붙는다", () => {
  const tooltip = hud.slice(hud.indexOf(".cozy-content-dropdown button:disabled:hover::after"));
  expect(tooltip).toContain("bottom: calc(100% - 9px)");
  expect(tooltip).toContain("left: 50%");
  expect(tooltip).toContain("width: 160px");
  expect(tooltip).toContain("height: 45px");
  expect(tooltip).toContain("padding: 0 12px 24px");
  expect(tooltip).toContain("transform: translateX(-50%)");
  expect(tooltip).not.toContain("bottom: calc(300%");
});

it("상단바 전용 화면도 메인과 같은 잠금 툴팁 크기를 쓴다", () => {
  const desktop = block(hud, viewportContract);
  const tooltip = desktop.slice(desktop.indexOf(".cozy-shared-navigation.is-top-bar-only > .cozy-content-dropdown button:disabled:hover::after"));
  expect(tooltip).toContain("width: 160px");
  expect(tooltip).toContain("height: 45px");
  expect(tooltip).toContain("padding: 0 12px 24px");
  expect(tooltip).toContain("background-size: 160px 45px");
  expect(tooltip).toContain("font-size: 13px");
});

it("HUD 그룹은 앵커 방향에 맞는 축소 기준점을 쓴다", () => {
  const desktop = block(hud, viewportContract);
  expect(desktop).toContain("transform-origin: top left");
  expect(desktop).toContain("transform-origin: top right");
  expect(desktop).toContain("transform-origin: top center");
  expect(desktop).toContain("transform-origin: bottom left");
  expect(desktop).toContain("transform-origin: bottom center");
  expect(desktop).toContain("transform-origin: center right");
  expect(desktop).toContain("scale: var(--hud-ui-scale, 1)");
});

it("전투 기록 종이는 무대 안쪽을 넓게 쓰고 읽을 수 있는 크기로 유지한다", () => {
  const panelStart = hud.indexOf(".cozy-history-panel {\n  position: absolute;");
  expect(panelStart, "전투 기록 본문 블록이 없다").toBeGreaterThan(-1);
  const panel = block(hud.slice(panelStart), ".cozy-history-panel {");
  const desktopPanel = block(hud, ".cozy-stage-panel-group > .cozy-history .cozy-history-panel {");

  expect(panel).toContain("padding: 82px 44px 42px");
  expect(panel).toContain('assets-paper-panels-v2/battle-history-panel-v2.png');
  expect(panel).toContain("width: min(620px, calc(100vw - 70px), calc((100vh - 190px) * 4 / 3))");
  expect(panel).toContain("height: auto");
  expect(panel).toContain("aspect-ratio: 4 / 3");
  expect(hud).toContain("width: min(calc(100vw - 20px), calc((100vh - 190px) * 4 / 3))");
  expect(desktopPanel).toContain("right: -285px");
  expect(desktopPanel).toContain("width: auto");
  expect(desktopPanel).toContain("height: min(780px, calc(100vh / var(--hud-ui-scale, 1) - 185px))");
  expect(desktopPanel).toContain("aspect-ratio: 4 / 3");
  expect(hud).toContain(".cozy-history-panel h3 { margin: 0; font-size: 42px;");
  expect(hud).toContain("margin-right: 12px");
  expect(hud).toContain(".cozy-history-panel li > img { width: 58px; height: 58px;");
  expect(hud).toContain(".cozy-history-result dd { justify-self: end; font-size: 24px; }");
});

it("첫 클리어 보상도 얇고 촘촘한 전용 종이와 넓어진 안전 영역을 쓴다", () => {
  const notice = block(battleScreenCss, ".cozy-first-clear-notice {");

  expect(notice).toContain('assets-paper-panels-v2/first-clear-reward-panel-v2.png');
  expect(notice).toContain("padding: clamp(58px, 7.4vh, 82px) clamp(28px, 2.8vw, 44px) clamp(52px, 6.5vh, 68px)");
  expect(notice).toContain("width: min(653.333px, calc(100vw - 24px), calc((100vh - 76px) * 4 / 3))");
  expect(notice).toContain("height: auto");
  expect(notice).toContain("aspect-ratio: 4 / 3");
  expect(battleScreenCss).toContain("top: clamp(42px, 5.8vh, 50px)");
  expect(battleScreenCss).toContain("right: clamp(28px, 2.6vw, 38px)");
  expect(notice).not.toContain("var(--paper-sheet)");
});

it("스테이지 패널은 화면 중심축에서 배율까지 한 transform으로 계산한다", () => {
  const panel = block(hud, "\n.cozy-stage-panel-group {");

  expect(panel).toContain("left: 50%");
  expect(panel).toContain("transform: translateX(-50%) scale(calc(var(--hud-ui-scale, 1) * .7))");
  expect(panel).not.toMatch(/\n\s*scale:/);
});

it("세로형 모바일은 HUD를 스테이지부터 세로 흐름으로 재배치한다", () => {
  const mobile = block(hud, "@media (max-width: 767px) and (orientation: portrait)");

  expect(mobile).toContain("flex-direction: column");
  expect(mobile).toContain("overflow-y: auto");
  expect(mobile).toContain("order: 0");
  expect(mobile).toContain("order: 4");
  expect(mobile).toContain("order: 5");
  expect(mobile).toContain("position: fixed");
  expect(mobile).toContain("env(safe-area-inset-bottom)");
  expect(mobile).toContain('background-image: url("../../shared/assets/cozy-hud-v1-webp/paper/profile-currency-base-fefcf6-v1.webp")');
  expect(mobile).toContain("background: rgba(255, 250, 237, .82)");
  expect(mobile).toMatch(/\.cozy-battle-stage-shell > \.cozy-tutorial-launcher \{\s*display: none;/);
  expect(mobile).toContain(".cozy-rewards .cozy-reward-fold { display: none; }");
  expect(mobile).toMatch(/\.cozy-rewards\.is-collapsed \{[\s\S]*?min-height: 0;[\s\S]*?background: rgba\(255, 250, 237, \.82\)/);
  expect(mobile).toMatch(/\.battle-skill-cooldowns \{[\s\S]*?top: calc\(clamp\(320px, 92vw, 430px\) - 62px\);[\s\S]*?left: 50%;/);
  expect(mobile).toMatch(/\.cozy-player-status \.cozy-status-row > span \{\s*font-size: 12px;/);
  expect(mobile).toMatch(/\.cozy-player-status \.cozy-status-row > span\.is-compact \{\s*font-size: 19px;/);
});

it("태블릿은 HUD 그룹을 동일한 화면 배율로 줄인다", () => {
  const tablet = block(hud, "@media (min-width: 768px) and (max-width: 1279px)");

  expect(tablet).toContain("scale: var(--hud-ui-scale, .8)");
  expect(tablet).toContain("scale(calc(var(--hud-ui-scale, .8) * .85))");
  expect(tablet).toContain("transform-origin: top left");
  expect(tablet).toContain("transform-origin: top right");
});

it("투명 여백이 있는 Figma 타이머와 모드 에셋은 fill 방식으로 자른다", () => {
  expect(hud.slice(hud.lastIndexOf(".cozy-stage-heading > time {"))).toContain("center / cover no-repeat");
  expect(hud.slice(hud.lastIndexOf(".cozy-stage-mode-toggle {"))).toContain("background-size: cover");
});

it("가장자리 간격은 12px 아래로 줄지 않고 safe area를 포함한다", () => {
  const desktop = block(hud, viewportContract);
  expect(desktop).toContain("--hud-edge-gap: max(12px, calc(20px * var(--hud-ui-scale, 1)))");
  expect(desktop).toContain("env(safe-area-inset-top)");
  expect(desktop).toContain("env(safe-area-inset-right)");
  expect(desktop).toContain("env(safe-area-inset-bottom)");
  expect(desktop).toContain("env(safe-area-inset-left)");
});

it("우측 상단 메뉴는 선택한 흰 종이 버튼과 단순 아이콘의 투명 여백 보정을 유지한다", () => {
  const navigation = block(hud, ".cozy-utility-nav button {");
  expect(navigation).toContain("top-button-base-white-paper-v1.png");
  expect(navigation).toContain("132% 139%");
  expect(hud).toContain('.cozy-utility-nav button[data-route="mail"] { --cozy-utility-art-scale: 1.55; }');
  expect(hud).toContain('.cozy-utility-nav button[data-route="settings"] { --cozy-utility-art-scale: 1.18; }');
  expect(hud).toContain("scale(var(--cozy-utility-art-scale, 1))");
  expect(hud).not.toContain("top-button-base-pressed-v2.webp");
});
