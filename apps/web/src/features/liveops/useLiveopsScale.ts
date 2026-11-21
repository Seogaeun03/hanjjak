import { useEffect } from "react";

/*
 * 이벤트 창은 1440x880 판 위에서 잰 고정 px 로 짜여 있다. 예전에는 창 크기를
 * `min(1440px, 100vw)` · `min(880px, 100dvh)` 로 줄였는데, 바깥 상자만 줄고 안쪽
 * 글자·단추는 그대로라 낮은 창에서 왼쪽 칸 내용이 액자 밖으로 흘러넘쳤다.
 *
 * 전투 HUD 와 같은 방법을 쓴다 — 판 크기는 고정하고 판 통째로 축소한다. 좌표는 한 줄도
 * 바뀌지 않고 배율만 곱해지므로 어느 창에서든 넘치지 않는다.
 */
export const LIVEOPS_STAGE_WIDTH = 1440;
export const LIVEOPS_STAGE_HEIGHT = 880;
/** 판 둘레에 남겨 두는 여백. 창에 딱 붙으면 액자 톱니가 잘려 보인다. */
export const LIVEOPS_STAGE_MARGIN = 32;

/**
 * 창 크기에서 이벤트 창 배율을 낸다. 1 을 넘지 않는다 — 큰 화면에서 판을 늘리면
 * 픽셀 아트가 뭉개지고, 다른 관리 창보다 혼자 커진다.
 */
export function computeLiveopsScale(viewportWidth: number, viewportHeight: number): number {
  const byWidth = (viewportWidth - LIVEOPS_STAGE_MARGIN) / LIVEOPS_STAGE_WIDTH;
  const byHeight = (viewportHeight - LIVEOPS_STAGE_MARGIN) / LIVEOPS_STAGE_HEIGHT;
  return Math.min(1, Math.max(0, Math.min(byWidth, byHeight)));
}

/**
 * 배율을 `--liveops-scale` 로 넘긴다. 이벤트 창을 그리는 자리에서 부른다.
 *
 * `useHudScale` 처럼 `visualViewport` 까지 듣는다 — 모바일에서 주소창이 접히거나 화면
 * 키보드가 올라올 때 window 의 resize 가 오지 않는 경우가 있다.
 */
export function useLiveopsScale(): void {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--liveops-scale", String(computeLiveopsScale(window.innerWidth, window.innerHeight)));
    };
    apply();

    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.visualViewport?.addEventListener("resize", apply);

    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      root.style.removeProperty("--liveops-scale");
    };
  }, []);
}
