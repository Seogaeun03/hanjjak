import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/features/profile/ProfileScreen.css"), "utf8");

describe("ProfileScreen layout regressions", () => {
  it("keeps the shared paper tabs free of the old active underline", () => {
    expect(css).not.toMatch(/\.profile-sidebar nav button\.is-active::after\s*\{/);
    expect(css).toMatch(/\.profile-sidebar nav button\.is-active\s*\{[^}]*transform:\s*translateX\(6px\)/s);
  });
});
