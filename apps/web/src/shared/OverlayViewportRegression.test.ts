import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const noticeCss = readFileSync(new URL("./NoticeDialog.css", import.meta.url), "utf8");
const alertCss = readFileSync(new URL("./TopAlert.css", import.meta.url), "utf8");

describe("fixed feedback inside filtered native dialogs", () => {
  it("anchors the modal veil to the viewport rather than the character paper", () => {
    expect(noticeCss).toContain("top: calc(50% - 50dvh)");
    expect(noticeCss).toContain("left: calc(50% - 50vw)");
    expect(noticeCss).toContain("width: 100vw");
    expect(noticeCss).toContain("height: 100dvh");
  });

  it("anchors the top alert to the same viewport edges", () => {
    expect(alertCss).toContain("top: calc(50% - 50dvh)");
    expect(alertCss).toContain("left: calc(50% - 50vw)");
    expect(alertCss).toContain("width: 100vw");
  });
});
