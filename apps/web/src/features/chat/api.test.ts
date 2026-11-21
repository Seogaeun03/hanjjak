import { describe, expect, it, vi } from "vitest";
import { chatApi } from "./api";

describe("chat api", () => {
  it("sends messages with an idempotency key", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { result: { messageId: "m1" } } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await chatApi.send("hello");
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/chat/messages");
    expect((fetcher.mock.calls[0][1]?.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
    fetcher.mockRestore();
  });

  // 이 경로가 비어 있어서 BLOCKED_POLICY 가 일반 실패 문구로 바뀌는 버그가 남아 있었다.
  it("carries the server judgement code on the thrown error", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ code: "BLOCKED_POLICY", messageKey: "error.blocked.policy", retryable: false }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    ));
    await expect(chatApi.send("금칙어")).rejects.toMatchObject({ code: "BLOCKED_POLICY" });
    fetcher.mockRestore();
  });

  it("carries the chat ban code as well", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ code: "CHAT_BANNED", messageKey: "error.chat.banned", retryable: false }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    ));
    await expect(chatApi.send("안녕")).rejects.toMatchObject({ code: "CHAT_BANNED" });
    fetcher.mockRestore();
  });

  it("uses separate board and report endpoints", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { items: [] } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await chatApi.board();
    await chatApi.report("board", "p1", "SPAM");
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/chat/board");
    expect(fetcher.mock.calls[1][0]).toBe("/api/v1/chat/board/p1/reports");
    fetcher.mockRestore();
  });
});
