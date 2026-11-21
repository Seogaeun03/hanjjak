import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = () => readFileSync(resolve(process.cwd(), "src/features/cosmetics/cosmetics.css"), "utf8");

describe("CosmeticsScreen layout regressions", () => {
  it("keeps the shared shortcut out of the cosmetics grid flow", () => {
    const directChildren = css().match(/\.cosmetic-screen\s*>\s*\*\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(directChildren).not.toMatch(/position\s*:/);
  });

  it("reserves header space before the legendary pickup tabs", () => {
    const styles = css();
    const headingRule = [...styles.matchAll(/\.cosmetic-screen\s*>\s*\.cosmetic-screen-heading\s*\{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((rule) => rule.includes("grid-template-columns")) ?? "";

    expect(headingRule).not.toMatch(/transform\s*:/);
    expect(headingRule).toMatch(/margin-top:\s*26px/);
  });

  it("keeps the gacha showcase dominant while tightening the draw controls", () => {
    const styles = css();
    const featureLayout = [...styles.matchAll(/\.cosmetic-screen:not\(\.cosmetic-reveal-screen\):not\(\.cosmetic-selector-screen\) \.cosmetic-feature-layout \{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((rule) => rule.includes("388px")) ?? "";
    const drawButtons = [...styles.matchAll(/\.cosmetic-screen:not\(\.cosmetic-reveal-screen\):not\(\.cosmetic-selector-screen\) \.cosmetic-draw-panel \.cosmetic-cost-buttons \{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((rule) => rule.includes("translateY(-17px)")) ?? "";
    const milestoneTrack = [...styles.matchAll(/\.cosmetic-screen:not\(\.cosmetic-reveal-screen\):not\(\.cosmetic-selector-screen\) \.cosmetic-banner-card > \.cosmetic-milestone \.cosmetic-milestone-track progress \{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((rule) => rule.includes("24px")) ?? "";
    const milestone = [...styles.matchAll(/\.cosmetic-screen:not\(\.cosmetic-reveal-screen\):not\(\.cosmetic-selector-screen\) \.cosmetic-banner-card > \.cosmetic-milestone \{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((rule) => rule.includes("-36px")) ?? "";
    const milestoneButton = [...styles.matchAll(/\.cosmetic-screen:not\(\.cosmetic-reveal-screen\):not\(\.cosmetic-selector-screen\) \.cosmetic-banner-card > \.cosmetic-milestone \.cosmetic-milestone-progress > button \{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((rule) => rule.includes("translate: 0 8px")) ?? "";
    const drawCostText = [...styles.matchAll(/\.cosmetic-screen:not\(\.cosmetic-reveal-screen\):not\(\.cosmetic-selector-screen\) \.cosmetic-draw-panel \.cosmetic-draw-cost > span \{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((rule) => rule.includes("20px")) ?? "";
    const drawCostIcon = [...styles.matchAll(/\.cosmetic-screen:not\(\.cosmetic-reveal-screen\):not\(\.cosmetic-selector-screen\) \.cosmetic-draw-panel \.cosmetic-draw-cost img \{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((rule) => rule.includes("38px")) ?? "";

    expect(featureLayout).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 388px/);
    expect(featureLayout).toMatch(/gap:\s*12px/);
    expect(drawButtons).toMatch(/transform:\s*translateY\(-17px\)/);
    expect(milestone).toMatch(/margin-top:\s*-36px/);
    expect(milestoneTrack).toMatch(/height:\s*24px/);
    expect(milestoneButton).toMatch(/translate:\s*0 8px/);
    expect(milestoneButton).not.toMatch(/transform:/);
    expect(drawCostText).toMatch(/font-size:\s*20px/);
    expect(drawCostIcon).toMatch(/width:\s*38px/);
    expect(drawCostIcon).toMatch(/height:\s*38px/);
  });
});
