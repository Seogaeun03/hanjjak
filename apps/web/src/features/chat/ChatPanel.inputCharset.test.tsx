// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import { chatApi } from "./api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderChat() {
  vi.stubGlobal("WebSocket", class { close() {} });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
  client.setQueryData(["auth", "session"], { authenticated: true, account: { accountId: "account-me" } });
  client.setQueryData(["chat", "messages"], { items: [], nextCursor: null, unreadCount: 0 });
  render(<QueryClientProvider client={client}><ChatPanel /></QueryClientProvider>);
  return screen.getByRole("textbox", { name: "채팅 입력" }) as HTMLInputElement;
}

describe("chat input rejects characters outside the allowed set", () => {
  it("keeps 한글 · 영문 · 숫자 · 공백 · 허용 기호", () => {
    const input = renderChat();
    fireEvent.change(input, { target: { value: "감자 10개 potato ★ 팝니다!" } });
    expect(input.value).toBe("감자 10개 potato ★ 팝니다!");
  });

  it("strips emoji, 가나 and 키릴 as they are typed or pasted", () => {
    const input = renderChat();
    fireEvent.change(input, { target: { value: "안녕😀하세요" } });
    expect(input.value).toBe("안녕하세요");

    fireEvent.change(input, { target: { value: "테스트あいうАБВ" } });
    expect(input.value).toBe("테스트");
  });
});

describe("chat input stays usable while the Korean IME composes", () => {
  /*
   * 조합 중에 필터를 태우면 React가 input 값을 다시 써서 IME 조합 버퍼가 끊긴다.
   * 조합 중에는 손대지 않고, 조합이 끝난 뒤에 한 번만 정리해야 한다.
   */
  it("leaves the composing value untouched and sanitizes once composition ends", () => {
    const input = renderChat();

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "ㅎ" } });
    expect(input.value).toBe("ㅎ");
    fireEvent.change(input, { target: { value: "하" } });
    expect(input.value).toBe("하");
    fireEvent.change(input, { target: { value: "한글" } });
    expect(input.value).toBe("한글");

    fireEvent.compositionEnd(input);
    expect(input.value).toBe("한글");
  });

  it("does not send on the Enter that confirms an IME candidate", async () => {
    const send = vi.spyOn(chatApi, "send").mockResolvedValue({
      commandId: "c", idempotencyKey: "k", status: "OK",
      result: { message: { messageId: "m", accountId: "account-me", nickname: "나", body: "한글", createdAt: "2026-09-16T10:00:00+09:00", eventId: "e" }, filterStatus: "ALLOW" },
    });
    const input = renderChat();

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "한글" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledWith("한글"));
  });

  it("never sends a body carrying disallowed characters", async () => {
    const send = vi.spyOn(chatApi, "send").mockResolvedValue({
      commandId: "c", idempotencyKey: "k", status: "OK",
      result: { message: { messageId: "m", accountId: "account-me", nickname: "나", body: "안녕", createdAt: "2026-09-16T10:00:00+09:00", eventId: "e" }, filterStatus: "ALLOW" },
    });
    const input = renderChat();

    // 조합 중 상태를 빠져나오지 못한 채 전송되더라도 send() 에서 다시 걸러진다.
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "안녕😀" } });
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(send).toHaveBeenCalledWith("안녕"));
  });
});
