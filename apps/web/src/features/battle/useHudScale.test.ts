import { describe, expect, it } from "vitest";
import { computeHudScale, hudLayoutMode } from "./useHudScale";

describe("HUD component scale", () => {
  it.each([
    [1920, 1080, 0.76],
    [2560, 1440, 0.76],
    [2560, 1080, 0.76],
    [1600, 900, 0.76],
    [1366, 768, 0.76],
    [1280, 720, 0.76],
    [1024, 768, 0.64],
    [800, 600, 0.59],
    [768, 1024, 0.59],
  ])("%ix%i에서 UI 배율을 %s로 제한한다", (width, height, expected) => {
    expect(computeHudScale(width, height)).toBeCloseTo(expected, 3);
  });
});

describe("HUD responsive layout mode", () => {
  it.each([
    [1600, 900, "desktop"],
    [1280, 720, "desktop"],
    [1024, 768, "tablet"],
    [844, 390, "tablet"],
    [767, 1024, "mobile"],
    [390, 844, "mobile"],
  ] as const)("%ix%i에서 %s 레이아웃을 사용한다", (width, height, expected) => {
    expect(hudLayoutMode(width, height)).toBe(expected);
  });
});
