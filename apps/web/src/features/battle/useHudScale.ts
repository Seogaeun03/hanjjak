import { useEffect } from "react";

/*
 * 확정 HUD 는 1600x900 무대 위에서 잰 고정 px 좌표로 되어 있다. 예전에는 무대가
 * 창 크기를 그대로 먹어서, 창이 넓으면 패널 사이만 벌어지고 좁으면 패널이 넘쳤다.
 * 그래서 Figma 비율이 정확히 맞는 창 크기가 1600x900 하나뿐이었다.
 *
 * 이제는 무대 크기를 1600x900 으로 고정하고 무대 통째로 확대·축소한다. 좌표는
 * 한 줄도 바뀌지 않고 배율만 곱해지므로 어느 창에서든 시안 비율이 유지된다.
 */
export const HUD_STAGE_WIDTH = 1600;
export const HUD_STAGE_HEIGHT = 900;
export const HUD_SCALE_CEILING = 0.76;
export const HUD_SCALE_FLOOR = 0.59;
export const HUD_MOBILE_SCALE_FLOOR = 0.48;

export type HudLayoutMode = "desktop" | "tablet" | "mobile";

export function hudLayoutMode(viewportWidth: number, viewportHeight: number): HudLayoutMode {
  if (viewportWidth <= 767 && viewportHeight >= viewportWidth) return "mobile";
  if (viewportWidth <= 1279) return "tablet";
  return "desktop";
}

export function computeHudScale(viewportWidth: number, viewportHeight: number) {
  /* 큰 화면에서도 전투 장면을 넉넉히 보이게 HUD를 0.76으로 제한한다. 태블릿은
     0.59까지 줄이고, 세로 모바일은 전용 재배치를 위해 0.48까지 허용한다. */
  const floor = hudLayoutMode(viewportWidth, viewportHeight) === "mobile" ? HUD_MOBILE_SCALE_FLOOR : HUD_SCALE_FLOOR;
  return Math.min(
    HUD_SCALE_CEILING,
    Math.max(floor, Math.min(viewportWidth / HUD_STAGE_WIDTH, viewportHeight / HUD_STAGE_HEIGHT)),
  );
}

/**
 * 창 크기에서 HUD 구성 요소 배율을 계산해 `--hud-ui-scale` 로 넘긴다.
 * 전투 화면을 그리는 진입점(BattleScreen, battle-hud-preview)에서 호출한다.
 *
 * 화면 전체를 transform하지 않는다. 배율은 각 HUD 그룹과 전투 인물에만 적용하며
 * 데스크톱·태블릿은 0.59~0.76, 세로 모바일은 0.48~0.76 범위다.
 * 배경은 언제나 viewport를 채운다.
 */
export function useHudScale() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const scale = computeHudScale(window.innerWidth, window.innerHeight);
      root.style.setProperty("--hud-ui-scale", String(scale));
      root.style.setProperty("--hud-mobile-scale", String(Math.min(1, Math.max(0.32, (window.innerWidth - 16) / 872))));
      root.style.setProperty("--hud-mobile-status-scale", String(Math.min(1, Math.max(0.56, (window.innerWidth - 16) / 576))));
      root.dataset.hudLayout = hudLayoutMode(window.innerWidth, window.innerHeight);
    };
    apply();

    /* visualViewport 까지 듣는 이유는 모바일에서 주소창이 접히거나 화면 키보드가
       올라올 때 window 의 resize 가 오지 않는 경우가 있기 때문이다. */
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.visualViewport?.addEventListener("resize", apply);

    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      root.style.removeProperty("--hud-ui-scale");
      root.style.removeProperty("--hud-mobile-scale");
      root.style.removeProperty("--hud-mobile-status-scale");
      delete root.dataset.hudLayout;
    };
  }, []);
}
