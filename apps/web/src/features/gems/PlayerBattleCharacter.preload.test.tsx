// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerBattleCharacter } from "./PlayerBattleCharacter";

const requested: string[] = [];

beforeEach(() => {
  requested.length = 0;
  vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation((value: string) => { requested.push(value); });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const motionsOf = (urls: string[]) => [...new Set(urls.filter((url) => url.includes("/cosmetics/motion/body/")).map((url) => url.match(/body\/([a-z0-9]+)_/)?.[1]))].sort();

describe("PlayerBattleCharacter preload", () => {
  it("preloads only the motion currently shown", () => {
    // 미리 받은 동작은 모듈 전역에서 기억하므로 테스트마다 색을 달리해 새 조합으로 만든다.
    const catalog = { cosmetics: [], sets: [] };
    const view = render(<PlayerBattleCharacter appearance={{ equipment: {} } as never} catalog={catalog} motion="rest" skillVfx={[]} color="preload-current" />);

    expect(motionsOf(requested)).toEqual(["rest"]);

    view.rerender(<PlayerBattleCharacter appearance={{ equipment: {} } as never} catalog={catalog} motion="strike1" skillVfx={[]} color="preload-current" />);

    expect(motionsOf(requested)).toEqual(["rest", "strike1"]);
    expect(motionsOf(requested)).not.toContain("death");
    expect(motionsOf(requested)).not.toContain("run");
    expect(motionsOf(requested)).not.toContain("strike2");
  });
});
