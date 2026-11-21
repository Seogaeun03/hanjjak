import { describe, expect, it } from "vitest";
import { GLOBAL_OVERLAY_SCREENS, type GlobalOverlayScreen } from "../../navigationState";
import { TUTORIAL_MODAL_SCREEN_ROOTS, TUTORIAL_RUNTIME_CHAPTERS, type TutorialRuntimeSurface } from "./tutorialRuntimeCatalog";

/* 전역 오버레이이면서 안내가 도는 화면. 지금은 거래소 하나뿐이고, 메시지함은
   튜토리얼 표면이 아니라서 빠진다. */
type GuidedOverlay = GlobalOverlayScreen & TutorialRuntimeSurface;

/* 전역 오버레이는 공용 GlobalOverlayWindow 를 타고 브라우저 top layer 에 오른다.
   그 화면에서 도는 안내를 창 안에 심지 않으면 document.body 에 그려져, z-index 와
   무관하게 창 아래로 깔리고 눌리지도 않는다. 거래소가 top layer 창이 되던 날
   장터 상인의 안내가 정확히 그렇게 사라졌다. */
describe("tutorial portal roots", () => {
  const guidedSurfaces = new Set<string>(
    TUTORIAL_RUNTIME_CHAPTERS.flatMap((chapter) => chapter.steps.map((step) => step.surface)),
  );
  const guidedOverlays = GLOBAL_OVERLAY_SCREENS.filter((screen): screen is GuidedOverlay => guidedSurfaces.has(screen));

  it("has at least one global overlay that hosts a guide", () => {
    expect(guidedOverlays.length).toBeGreaterThan(0);
  });

  it.each(guidedOverlays)("gives the %s overlay a root to plant the guide in", (screen) => {
    expect(TUTORIAL_MODAL_SCREEN_ROOTS[screen]).toBeTruthy();
  });
});
