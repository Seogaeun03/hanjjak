import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/features/mail/MailScreen.css"), "utf8");

describe("MailScreen layout regressions", () => {
  it("keeps the side tabs clipped to the paper without an active underline", () => {
    expect(css).toMatch(/\.mail-sidebar\s*\{[^}]*right:\s*calc\(100% - 150px\)/s);
    expect(css).not.toMatch(/\.mail-sidebar nav button\.is-active::after\s*\{/);
  });

  it("keeps the close control in the same heading column on every mail tab", () => {
    expect(css).toMatch(/\.mail-close\s*\{[^}]*grid-column:\s*4;/s);
  });
});
