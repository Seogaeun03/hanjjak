// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = () => readFileSync(resolve(process.cwd(), "src/features/character/character.css"), "utf8");
/** 선택자 하나의 본문만 떼어 온다. 선택자에 정규식 기호가 없는 자리에서만 쓴다. */
const rule = (selector: string, text: string) => {
  const start = text.indexOf(`\n${selector} {`);
  return start < 0 ? "" : text.slice(start, text.indexOf("}", start) + 1);
};

describe("능력치 탭 캐릭터 자리", () => {
  it("겹쳐 그리는 그림의 높이를 칸 높이로 못 박는다", () => {
    // 이 span은 aspect-ratio로 제 높이를 잡는다. max-height로 누르면 상자만 줄고
    // 안쪽 그림은 원래 높이를 그대로 써서 발이 상자 밖으로 삐져나가 잘렸다.
    const hero = rule(".ability-fold-hero", css());
    expect(hero).toContain("height: 100%");
    expect(hero).toContain("grid-template-rows: 100%");
    expect(hero).not.toContain("max-height");
  });

  it("모자가 잘리지 않는 만큼만 끌어올린다", () => {
    // 그림 위쪽은 제일 높이 솟는 마법사 모자 위로도 620분의 108, 곧 17%가 비어 있다.
    // 끌어올리는 폭이 그보다 크면 모자 끝이 칸 밖으로 나가 잘린다.
    const hero = rule(".ability-fold-hero", css());
    const lift = Number(/transform: translate\(50%, -(\d+(?:\.\d+)?)%\)/.exec(hero)?.[1]);
    expect(lift).toBeGreaterThan(50);
    expect(lift - 50).toBeLessThan(100 * (108 / 620));
  });

  it("칸은 넘친 데를 잘라 낸다", () => {
    expect(rule(".ability-fold-stage", css())).toContain("overflow: hidden");
  });

  it("능력치 카드는 밝게 유지하고 전투력 숫자는 명패 안에 들어간다", () => {
    const paperOverlay = rule(".ability-fold-panel::before", css());
    expect(paperOverlay).toContain("background: #fffdf5");
    expect(paperOverlay).toContain("opacity: .2");
    expect(paperOverlay).toContain("mask: var(--ability-panel-art) center / 100% 100% no-repeat");

    expect(rule(".ability-fold-panel > *", css())).toContain("z-index: 1");
    expect(rule(".ability-fold-power strong", css())).toContain("font-size: 8.6cqw");
  });
});
