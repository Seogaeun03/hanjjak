// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ChatPanel scalable paper frame", () => {
  it("keeps the approved expanded shell header and footer fixed while its center grows", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/chat/ChatPanel.css"), "utf8");
    const frameRule = css.match(/\.chat-panel\.is-open::before \{[^}]+\}/)?.[0] ?? "";
    const collapsedRule = css.match(/\.chat-open \{[^}]+\}/)?.[0] ?? "";
    expect(frameRule).toContain("border-image-source:url(\"./assets-cozy-pixel/chat-panel-expanded-fine-v4.png\")");
    expect(frameRule).toContain("border-image-slice:275 56 56 56 fill");
    expect(frameRule).toContain("border-image-repeat:stretch round");
    expect(frameRule).not.toContain("center/100% 100% no-repeat");
    expect(collapsedRule).toContain("chat-panel-collapsed-fine-v4.png");
    expect(collapsedRule).toContain("center/100% 100% no-repeat");
  });

  it("renders every desktop nickname at the same enlarged size", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/chat/ChatPanel.css"), "utf8");
    const sharedCopyRule = css.match(/\.chat-message-list strong,\.chat-message-list p \{[^}]+\}/)?.[0] ?? "";
    expect(sharedCopyRule).toContain("font-size:19.25px");

    // 내 닉네임만 따로 키웠다가 되돌린 자리다. 크기를 다시 나누면 한 줄만 튄다.
    const ownRule = css.match(/\.chat-message-list strong\.is-own \{[^}]+\}/)?.[0] ?? "";
    expect(ownRule).not.toContain("font-size");
  });

  it("distinguishes all three professions by nickname color", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/chat/ChatPanel.css"), "utf8");
    expect(css).toContain(".chat-message-list .material-potato strong { color:#704126;");
    expect(css).toContain(".chat-message-list .material-sweet-potato strong { color:#982a59;");
    expect(css).toContain(".chat-message-list .material-corn strong { color:#d69b16;");
  });

  it("keeps the approved desktop width and scales the whole panel on smaller viewports", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/chat/ChatPanel.css"), "utf8");
    const openRule = css.match(/\.chat-panel\.is-open \{[^}]+\}/)?.[0] ?? "";
    const responsiveRule = css.match(/@media \(max-width:1279px\),\(max-height:719px\) \{[\s\S]+?\n\}/)?.[0] ?? "";
    expect(openRule).toContain("width:421.667px");
    expect(responsiveRule).toContain("transform:scale(.82)");
    expect(responsiveRule).toContain("transform-origin:bottom left");
  });

  it("keeps the collapsed bar tall and the expanded resize divider above its header content", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/chat/ChatPanel.css"), "utf8");
    const closedRule = css.match(/\.chat-panel\.is-closed \{[^}]+\}/)?.[0] ?? "";
    const handleRule = css.match(/\.chat-resize-handle \{[^}]+\}/)?.[0] ?? "";
    const collapsedIconRule = css.match(/\.chat-open \.chat-message-icon \{[^}]+\}/)?.[0] ?? "";
    const collapsedCopyRule = css.match(/\.chat-open>span \{[^}]+\}/)?.[0] ?? "";

    expect(closedRule).toContain("height:96.25px");
    expect(handleRule).toContain("top:13.75px");
    expect(collapsedIconRule).toContain("top:50%");
    expect(collapsedIconRule).toContain("transform:translateY(-50%)");
    expect(collapsedCopyRule).toContain("top:50%");
    expect(collapsedCopyRule).toContain("transform:translateY(-50%)");
  });

  it("keeps the header fixed while messages scroll above the fixed composer", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/chat/ChatPanel.css"), "utf8");
    const listRule = css.match(/\.chat-message-list \{[^}]+\}/)?.[0] ?? "";
    const composerRule = css.match(/\.chat-composer \{[^}]+\}/)?.[0] ?? "";
    const blocksRule = css.match(/\.chat-blocks \{[^}]+\}/)?.[0] ?? "";

    expect(listRule).toContain("top:89.833px");
    expect(listRule).toContain("bottom:65.083px");
    expect(listRule).toContain("overflow-y:auto");
    expect(composerRule).toContain("position:absolute");
    expect(composerRule).toContain("bottom:18.333px");
    expect(blocksRule).toContain("width:315px");
    expect(blocksRule).toContain("height:174px");
    expect(blocksRule).toContain("overflow-y:auto");
  });
});
