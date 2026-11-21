// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatApi, type ChatCommand, type ChatMessage } from "./api";
import { ChatPanel } from "./ChatPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChatPanel", () => {
  it("uses one simple chat composer instead of sales and purchase tabs", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["chat", "messages"], { items: [], nextCursor: null, unreadCount: 0 });
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><ChatPanel /></QueryClientProvider>);
    expect(html).toContain("채팅");
    expect(html).toContain("채팅 더보기");
    expect(html).not.toContain("chat-pinned-guide");
    expect(html).toContain("채팅 입력");
    expect(html).toContain("메시지를 입력하세요");
    expect(html).not.toContain("거래 게시판");
    expect(html).not.toContain("판매");
    expect(html).not.toContain("구매");
  });

  it("moves the QA guide and block management into the final more popovers", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["chat", "messages"], { items: [], nextCursor: null, unreadCount: 0 });
    const { container } = render(<QueryClientProvider client={client}><ChatPanel /></QueryClientProvider>);

    expect(screen.queryByText("문의 및 제보는 설정탭의 QA기능 이용 부탁드립니다.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "채팅 더보기" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "채팅 이용 안내" }));
    expect(screen.getByRole("dialog", { name: "채팅 이용 안내" })).toBeTruthy();
    expect(screen.getByText("욕설·성희롱·사기성 거래 유도는 금지됩니다.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "확인" })).toBeTruthy();
    expect(container.querySelector(".chat-pinned-guide")).toBeNull();
  });

  it("collapses to the compact chat button and opens the composer again", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["chat", "messages"], { items: [], nextCursor: null, unreadCount: 103 });
    render(<QueryClientProvider client={client}><ChatPanel /></QueryClientProvider>);

    const collapse = screen.getByRole("button", { name: "채팅 접기" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapse);

    expect(screen.queryByRole("textbox", { name: "채팅 입력" })).toBeNull();
    const open = screen.getByRole("button", { name: /채팅/ });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(open.textContent).toContain("99+");

    fireEvent.click(open);
    expect(screen.getByRole("textbox", { name: "채팅 입력" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "채팅 접기" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("asks for confirmation before preview block and report actions", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["auth", "session"], { authenticated: true, account: { accountId: "me" } });
    client.setQueryData(["chat", "messages"], { items: [{ messageId: "m1", accountId: "other", nickname: "다른농부", body: "안녕", createdAt: "2026-09-11T00:00:00Z", eventId: "e1" }], nextCursor: null, unreadCount: 0 });
    client.setQueryData(["chat", "blocks"], []);
    render(<QueryClientProvider client={client}><ChatPanel previewMode /></QueryClientProvider>);

    fireEvent.click(screen.getByLabelText("다른농부"));
    fireEvent.click(screen.getByRole("button", { name: "차단" }));
    expect(screen.getByRole("dialog", { name: "이 사용자를 차단할까요?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog", { name: "이 사용자를 차단할까요?" })).toBeNull();

    fireEvent.click(screen.getByLabelText("다른농부"));
    fireEvent.click(screen.getByRole("button", { name: "신고" }));
    expect(screen.getByRole("dialog", { name: "이 사용자를 신고할까요?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("dialog", { name: "이 사용자를 신고할까요?" }).querySelector(".chat-action-confirm")!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "이 사용자를 신고할까요?" })).toBeNull());
    expect(screen.queryByText("신고를 접수했어요.")).toBeNull();
  });

  it("hides existing messages immediately after a user is blocked", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["auth", "session"], { authenticated: true, account: { accountId: "me" } });
    client.setQueryData(["chat", "messages"], { items: [{ messageId: "m2", accountId: "blocked-user", nickname: "숨길농부", body: "이 메시지는 숨겨져야 해요", createdAt: "2026-09-11T00:00:00Z", eventId: "e2" }], nextCursor: null, unreadCount: 0 });
    client.setQueryData(["chat", "blocks"], []);
    render(<QueryClientProvider client={client}><ChatPanel previewMode /></QueryClientProvider>);

    fireEvent.click(screen.getByLabelText("숨길농부"));
    fireEvent.click(screen.getByRole("button", { name: "차단" }));
    const dialog = screen.getByRole("dialog", { name: "이 사용자를 차단할까요?" });
    fireEvent.click(dialog.querySelector(".chat-action-confirm")!);

    await waitFor(() => expect(screen.queryByText("이 메시지는 숨겨져야 해요")).toBeNull());
    expect(client.getQueryData<Array<{ accountId: string }>>(["chat", "blocks"])?.[0]?.accountId).toBe("blocked-user");
  });

  it("updates the message cache from a WebSocket event and disables polling while connected", () => {
    const sockets: Array<{ onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (event: MessageEvent) => void; close: () => void }> = [];
    vi.stubGlobal("WebSocket", class {
      onopen?: () => void;
      onclose?: () => void;
      onerror?: () => void;
      onmessage?: (event: MessageEvent) => void;
      close = vi.fn();
      constructor() { sockets.push(this); }
    });
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["chat", "messages"], { items: [], nextCursor: null, unreadCount: 0 });
    render(<QueryClientProvider client={client}><ChatPanel /></QueryClientProvider>);
    sockets[0].onopen?.();
    sockets[0].onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "message", message: { messageId: "m1", accountId: "a1", nickname: "한짝", body: "실시간", createdAt: "2026-09-11T00:00:00Z", eventId: "e1" } }) }));
    expect(client.getQueryData<{ items: ChatMessage[] }>(["chat", "messages"])?.items[0].body).toBe("실시간");
    expect(sockets[0].close).not.toHaveBeenCalled();
  });

  it("does not open a live WebSocket in preview mode", () => {
    const WebSocketMock = vi.fn();
    vi.stubGlobal("WebSocket", WebSocketMock);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["chat", "messages"], { items: [], nextCursor: null, unreadCount: 0 });

    render(<QueryClientProvider client={client}><ChatPanel previewMode /></QueryClientProvider>);

    expect(WebSocketMock).not.toHaveBeenCalled();
  });

  it("keeps the draft and message cache unchanged with no feedback when sending is disabled", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["chat", "messages"], { items: [], nextCursor: null, unreadCount: 0 });
    const pending = Promise.withResolvers<ChatCommand<{ message: ChatMessage; filterStatus: string }>>();
    const send = vi.spyOn(chatApi, "send").mockReturnValue(pending.promise);
    const { container } = render(<QueryClientProvider client={client}><ChatPanel previewMode /></QueryClientProvider>);
    const input = screen.getByRole("textbox", { name: "채팅 입력" });
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "채팅 보내기" }));
    expect((input as HTMLTextAreaElement).value).toBe("hello");
    fireEvent.click(screen.getByRole("button", { name: "채팅 보내기" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".chat-notice")).toBeNull();
    expect(client.getQueryData<{ items: ChatMessage[] }>(["chat", "messages"])?.items).toEqual([]);
    await act(async () => { pending.reject(Object.assign(new Error("CHAT_DISABLED"), { code: "CHAT_DISABLED" })); });
    expect((input as HTMLTextAreaElement).value).toBe("hello");
    expect(container.querySelector(".chat-notice")).toBeNull();
    expect(client.getQueryData<{ items: ChatMessage[] }>(["chat", "messages"])?.items).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "채팅 보내기" }));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps non-lock send failures visible", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["chat", "messages"], { items: [], nextCursor: null, unreadCount: 0 });
    vi.spyOn(chatApi, "send").mockRejectedValue(Object.assign(new Error("CHAT_BANNED"), { code: "CHAT_BANNED" }));
    render(<QueryClientProvider client={client}><ChatPanel previewMode /></QueryClientProvider>);
    const input = screen.getByRole("textbox", { name: "채팅 입력" });
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "채팅 보내기" }));
    await waitFor(() => expect(screen.getByText("채팅 이용이 제한된 계정입니다.")).toBeTruthy());
    expect(client.getQueryData<{ items: ChatMessage[] }>(["chat", "messages"])?.items).toEqual([]);
  });
  it("does not overwrite edits made while a disabled-send response is pending", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["chat", "messages"], { items: [], nextCursor: null, unreadCount: 0 });
    const pending = Promise.withResolvers<ChatCommand<{ message: ChatMessage; filterStatus: string }>>();
    vi.spyOn(chatApi, "send").mockReturnValue(pending.promise);
    render(<QueryClientProvider client={client}><ChatPanel previewMode /></QueryClientProvider>);
    const input = screen.getByRole("textbox", { name: "채팅 입력" });
    fireEvent.change(input, { target: { value: "first draft" } });
    fireEvent.click(screen.getByRole("button", { name: "채팅 보내기" }));
    fireEvent.change(input, { target: { value: "newer draft" } });
    expect((input as HTMLTextAreaElement).value).toBe("newer draft");
    await act(async () => { pending.reject(Object.assign(new Error("CHAT_DISABLED"), { code: "CHAT_DISABLED" })); });
    expect((input as HTMLTextAreaElement).value).toBe("newer draft");
    expect(client.getQueryData<{ items: ChatMessage[] }>(["chat", "messages"])?.items).toEqual([]);
  });

  it("clears only the successfully submitted draft and adds its message", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["chat", "messages"], { items: [], nextCursor: null, unreadCount: 0 });
    const pending = Promise.withResolvers<ChatCommand<{ message: ChatMessage; filterStatus: string }>>();
    vi.spyOn(chatApi, "send").mockReturnValue(pending.promise);
    render(<QueryClientProvider client={client}><ChatPanel previewMode /></QueryClientProvider>);
    const input = screen.getByRole("textbox", { name: "채팅 입력" });
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "채팅 보내기" }));
    const sentMessage = { messageId: "m1", accountId: "a1", nickname: "한짝", body: "hello", createdAt: "2026-09-11T00:00:00Z", eventId: "e1" };
    pending.resolve({ commandId: "c1", idempotencyKey: "k1", status: "SUCCEEDED", result: { message: sentMessage, filterStatus: "ALLOW" } });
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
    expect(client.getQueryData<{ items: ChatMessage[] }>(["chat", "messages"])?.items[0]).toEqual(sentMessage);
  });

  it("places the current title above the nickname with material color and animation", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["chat", "messages"], {
      items: [{ messageId: "title", accountId: "a1", nickname: "감자대장", primaryMaterialType: "POTATO", chatTitle: "감자왕", chatTitleColor: "#F4E04D", body: "안녕하세요", createdAt: "2026-09-11T00:00:00Z", eventId: "e1" }],
      nextCursor: null,
      unreadCount: 0,
    });
    render(<QueryClientProvider client={client}><ChatPanel /></QueryClientProvider>);

    const badge = document.querySelector(".chat-title-badge");
    const author = badge?.closest(".chat-message-author");
    const nickname = author?.querySelector(".chat-author-name");
    expect(badge?.textContent).toBe("감자왕");
    expect(badge?.getAttribute("style")).toContain("--chat-title-color: #F4E04D");
    expect(badge?.getAttribute("style")).toContain("--chat-title-foreground: #32150e");
    expect(author?.firstElementChild).toBe(badge);
    expect(author?.children[1]).toBe(nickname);
    expect(nickname?.textContent).toBe("감자대장");
    expect(author?.textContent).toBe("감자왕감자대장");
    expect(badge?.closest("li")?.classList.contains("material-potato")).toBe(true);
    expect(screen.getByLabelText("감자왕 감자대장, 감자 전문")).toBeTruthy();

    const css = readFileSync(resolve(process.cwd(), "src/features/chat/ChatPanel.css"), "utf8");
    expect(css).toMatch(/\.chat-message-author\s*\{[^}]*flex-direction:column/);
    expect(css).toMatch(/\.chat-title-badge\s*\{[^}]*display:block/);
    expect(css).toContain(".chat-title-badge::after");
    expect(css).toContain("@keyframes chat-title-shine");
  });

  it("prefixes game master nicknames with a rainbow GM badge and leaves other nicknames alone", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
    client.setQueryData(["chat", "messages"], {
      items: [
        { messageId: "m1", accountId: "a1", nickname: "운영자", body: "점검 안내", createdAt: "2026-09-11T00:00:00Z", eventId: "e1", gameMaster: true },
        { messageId: "m2", accountId: "a2", nickname: "한짝", body: "안녕", createdAt: "2026-09-11T00:01:00Z", eventId: "e2" },
      ],
      nextCursor: null,
      unreadCount: 0,
    });
    render(<QueryClientProvider client={client}><ChatPanel /></QueryClientProvider>);

    const badges = document.querySelectorAll(".chat-gm-badge");
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe("GM");
    expect(badges[0].parentElement?.textContent).toBe("GM운영자");
    expect(screen.getByLabelText("GM 운영자")).toBeTruthy();
    expect(screen.getByLabelText("한짝")).toBeTruthy();

    // 칩 바탕과 무지개 글자는 한 요소에 같이 둘 수 없다. 안쪽 칸이 사라지면 칩 바탕이
    // 글자 모양으로 오려져 함께 없어지므로 두 겹 구조를 테스트가 지킨다.
    expect(badges[0].firstElementChild?.tagName).toBe("SPAN");
    expect(badges[0].firstElementChild?.textContent).toBe("GM");

    // 무지개는 글자 모양으로 오려 낸 그러데이션이라, 색 하나만 있으면 구현이 깨진 것이다.
    const css = readFileSync(resolve(process.cwd(), "src/features/chat/ChatPanel.css"), "utf8");
    expect(css).toMatch(/\.chat-gm-badge\s*>\s*span/);
    expect(css).toMatch(/background-clip:\s*text/);
    expect(css).toContain("@keyframes chat-gm-rainbow");
    expect(css).toContain("@keyframes chat-gm-sparkle");

    // 주석을 일찍 닫으면 뒤따르는 규칙 하나가 통째로 버려지는데, 문자열 검사만으로는
    // 그대로 통과한다. 주석과 괄호가 맞는지, 주석 밖에 닫는 표시가 남지 않았는지 본다.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toContain("*/");
    expect((withoutComments.match(/\{/g) ?? []).length).toBe((withoutComments.match(/\}/g) ?? []).length);
  });

  it("aligns the desktop panel with the bottom navigation baseline", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/chat/ChatPanel.css"), "utf8");
    expect(css).toContain("bottom:16.667px");
    expect(css).toContain("left:16.667px");
  });

  it("keeps the Runtime v3 geometry and exact exported assets", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/chat/ChatPanel.css"), "utf8");
    const source = readFileSync(resolve(process.cwd(), "src/features/chat/ChatPanel.tsx"), "utf8");

    // Figma 460x435 rendered at the requested 110%, expressed in HUD coordinates.
    expect(css).toContain("width:421.667px");
    expect(css).toContain("min-height:398.75px");
    expect(css).toContain("top:89.833px");
    expect(css).toContain("width:374.917px");
    expect(css).toContain("height:42.167px");

    expect(source).toContain("chat-runtime-v3-raw-4.webp");
    expect(source).toContain("chat-runtime-v3-raw-5.webp");
    expect(source).toContain("chat-runtime-v3-raw-1.webp");
    expect(source).toContain("chat-runtime-v3-svg-2.svg");
  });
});
