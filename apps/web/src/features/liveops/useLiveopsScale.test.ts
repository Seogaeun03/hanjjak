import { describe, expect, it } from "vitest";
import { LIVEOPS_STAGE_HEIGHT, LIVEOPS_STAGE_WIDTH, computeLiveopsScale } from "./useLiveopsScale";

describe("이벤트 창 배율", () => {
  it.each([
    [2880, 1800, 1],
    [1920, 1080, 1],
    [1600, 912, 1],
  ])("%ix%i 처럼 판이 통째로 들어가는 창에서는 줄이지 않는다", (width, height) => {
    expect(computeLiveopsScale(width, height)).toBe(1);
  });

  /* 이 자리가 원래 깨지던 곳이다. 창 높이가 700px 일 때 바깥 상자만 줄이던 예전 방식은
     왼쪽 칸 단추를 액자 밖으로 53px 밀어냈다. 이제는 판 전체가 같은 비율로 줄어든다. */
  it.each([
    [1920, 700, (700 - 32) / LIVEOPS_STAGE_HEIGHT],
    [1366, 768, (768 - 32) / LIVEOPS_STAGE_HEIGHT],
    [1200, 1800, (1200 - 32) / LIVEOPS_STAGE_WIDTH],
  ])("%ix%i 에서는 모자란 쪽에 맞춰 줄인다", (width, height, expected) => {
    expect(computeLiveopsScale(width, height)).toBeCloseTo(expected, 5);
  });

  it("줄인 판은 여백까지 더해도 창을 넘지 않는다", () => {
    for (const [width, height] of [[1920, 700], [1366, 768], [1280, 720], [1024, 900]] as const) {
      const scale = computeLiveopsScale(width, height);
      expect(LIVEOPS_STAGE_WIDTH * scale).toBeLessThanOrEqual(width);
      expect(LIVEOPS_STAGE_HEIGHT * scale).toBeLessThanOrEqual(height);
    }
  });

  /* 창이 판보다 훨씬 작아도 음수 배율이 나오면 안 된다 — 음수면 창이 뒤집혀 그려진다. */
  it.each([[20, 20], [0, 0], [10, 1800]])("%ix%i 같은 극단에서도 0 밑으로 내려가지 않는다", (width, height) => {
    expect(computeLiveopsScale(width, height)).toBeGreaterThanOrEqual(0);
  });
});
