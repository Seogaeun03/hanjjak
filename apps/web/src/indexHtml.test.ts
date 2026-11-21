import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("application viewport", () => {
  it("uses the physical device width so portrait phones select the mobile HUD", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(html).toMatch(
      /<meta\s+name=["']viewport["']\s+content=["'][^"']*width=device-width[^"']*initial-scale=1(?:\.0)?[^"']*["']\s*\/?>/i,
    );
  });
});
