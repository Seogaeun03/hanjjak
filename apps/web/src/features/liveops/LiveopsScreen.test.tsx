// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveopsState } from "./api";
import { LiveopsScreen } from "./LiveopsScreen";

function renderLiveops() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><LiveopsScreen /></QueryClientProvider>);
}

afterEach(cleanup);

const state = vi.fn();
const draw = vi.fn();
vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, liveopsApi: { state: () => state(), draw: (count: 1 | 10) => draw(count) } };
});

const baseState: LiveopsState = {
  eventId: "hunt-ticket-gacha-2026-09",
  displayName: "사냥 이벤트 뽑기",
  startsAt: "2026-10-01T00:00:00+09:00",
  endsAt: "2026-10-15T00:00:00+09:00",
  open: true,
  halted: false,
  ticketBalance: 12,
  grantedToday: 7,
  dailyCap: 40,
  secondsPerTicket: 180,
  outcomes: [
    { kind: "PRIZE", prizeId: "prize.gifticon.cyburger", displayName: "싸이버거 기프티콘", millionths: 100, probabilityDisplay: "0.01%", quantity: null, minQuantity: null, maxQuantity: null },
    { kind: "GEM_BOX", prizeId: null, displayName: null, millionths: 100000, probabilityDisplay: "10%", quantity: 1, minQuantity: null, maxQuantity: null },
    { kind: "COSMETIC_TICKET", prizeId: null, displayName: null, millionths: 100000, probabilityDisplay: "10%", quantity: 1, minQuantity: null, maxQuantity: null },
    { kind: "RICE", prizeId: null, displayName: null, millionths: 799900, probabilityDisplay: "79.99%", quantity: null, minQuantity: 10, maxQuantity: 100 },
  ],
  prizes: [{ prizeId: "prize.gifticon.cyburger", displayName: "싸이버거 기프티콘", total: 5, claimed: 1, remaining: 4, alreadyWon: false }],
};

describe("LiveopsScreen", () => {
  beforeEach(() => {
    state.mockReset();
    draw.mockReset();
  });

  it("티켓 잔액과 오늘 적립량을 보여 준다", async () => {
    state.mockResolvedValue(baseState);
    renderLiveops();
    expect(await screen.findByText("12")).toBeTruthy();
    expect(screen.getByText("7 / 40")).toBeTruthy();
  });

  it("게임풍 공뽑기 기계와 티켓 적립 현황을 함께 보여 준다", async () => {
    state.mockResolvedValue(baseState);
    renderLiveops();
    expect(await screen.findByRole("img", { name: "알록달록 캡슐이 든 이벤트 공뽑기 기계" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "이벤트 티켓 적립 현황" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "오늘 티켓 적립량" })).toBeTruthy();
  });

  it("뽑기 결과를 보상 카드 대화상자로 보여 주고 닫는다", async () => {
    state.mockResolvedValue(baseState);
    draw.mockResolvedValue({ eventId: baseState.eventId, ticketCost: 1, riceGained: 25, cosmeticTicketsGained: 0, gemBoxesGained: 0, ticketBalance: 11, lines: [{ kind: "RICE", prizeId: null, prizeDisplayName: null, quantity: 25 }] });
    renderLiveops();
    fireEvent.click(await screen.findByRole("button", { name: "1회 뽑기" }));
    const dialog = await screen.findByRole("dialog", { name: "뽑기 결과" });
    expect(dialog.textContent).toContain("쌀");
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(screen.queryByRole("dialog", { name: "뽑기 결과" })).toBeNull();
  });

  it("확률표와 남은 경품 재고를 숨기지 않는다", async () => {
    state.mockResolvedValue(baseState);
    renderLiveops();
    expect(await screen.findByText("0.01%")).toBeTruthy();
    // 보석함과 치장 뽑기권이 같은 10%라 둘 다 잡힌다.
    expect(screen.getAllByText("10%")).toHaveLength(2);
    expect(screen.getByText("79.99%")).toBeTruthy();
    expect(screen.getByText("4 / 5")).toBeTruthy();
  });

  it("보석함 칸을 확률표와 뽑기 결과에 모두 보여 준다", async () => {
    state.mockResolvedValue(baseState);
    draw.mockResolvedValue({
      eventId: baseState.eventId, ticketCost: 1, riceGained: 0, cosmeticTicketsGained: 0, gemBoxesGained: 1, ticketBalance: 11,
      lines: [{ kind: "GEM_BOX", prizeId: null, prizeDisplayName: null, quantity: 1 }],
    });
    renderLiveops();

    const odds = await screen.findByRole("table", { name: "보상 확률" });
    expect(odds.textContent).toContain("보석함");

    fireEvent.click(screen.getByRole("button", { name: "1회 뽑기" }));
    const dialog = await screen.findByRole("dialog", { name: "뽑기 결과" });
    expect(dialog.textContent).toContain("보석함");
  });

  it("가방이 꽉 차 거부되면 티켓이 쓰이지 않았다는 것까지 알려 준다", async () => {
    state.mockResolvedValue(baseState);
    draw.mockRejectedValue(new Error("INVENTORY_CAPACITY_EXCEEDED"));
    renderLiveops();
    fireEvent.click(await screen.findByRole("button", { name: "1회 뽑기" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("가방");
    expect(alert.textContent).toContain("티켓은 사용되지 않았습니다");
    expect(alert.textContent).not.toContain("INVENTORY_CAPACITY_EXCEEDED");
  });

  it("기간이 끝나도 티켓이 남아 있으면 뽑을 수 있다", async () => {
    // 잔여 티켓은 경품만 못 뽑는 재화다. 화면을 닫아 버리면 쓸 길이 사라진다.
    state.mockResolvedValue({ ...baseState, open: false, outcomes: baseState.outcomes.filter((o) => o.kind !== "PRIZE") });
    renderLiveops();
    const button = await screen.findByRole("button", { name: "1회 뽑기" });
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText("0.01%")).toBeNull();
  });

  it("기간이 끝나고 티켓도 없으면 화면을 닫는다", async () => {
    state.mockResolvedValue({ ...baseState, open: false, ticketBalance: 0 });
    const { container } = renderLiveops();
    await waitFor(() => expect(screen.queryByText("사냥 이벤트 뽑기")).toBeNull());
    expect(container.textContent).toContain("진행 중인 이벤트가 없습니다");
  });

  it("비상정지 중에는 뽑기 단추를 잠근다", async () => {
    state.mockResolvedValue({ ...baseState, halted: true });
    renderLiveops();
    const button = await screen.findByRole("button", { name: "1회 뽑기" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("티켓이 모자라면 십회 단추를 잠근다", async () => {
    state.mockResolvedValue({ ...baseState, ticketBalance: 3 });
    renderLiveops();
    const ten = await screen.findByRole("button", { name: "10회 뽑기" });
    expect(ten.hasAttribute("disabled")).toBe(true);
    expect((await screen.findByRole("button", { name: "1회 뽑기" })).hasAttribute("disabled")).toBe(false);
  });

  it("실패한 뽑기는 서버 코드가 아니라 번역된 한국어 안내를 보여준다", async () => {
    state.mockResolvedValue(baseState);
    draw.mockRejectedValue(new Error("INSUFFICIENT_EVENT_TICKETS"));
    renderLiveops();
    fireEvent.click(await screen.findByRole("button", { name: "1회 뽑기" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("티켓");
    expect(alert.textContent).not.toContain("INSUFFICIENT_EVENT_TICKETS");
  });

  it("알 수 없는 서버 코드도 읽을 수 있는 한국어 문구로 보여준다", async () => {
    state.mockResolvedValue(baseState);
    draw.mockRejectedValue(new Error("SOME_FUTURE_SERVER_CODE"));
    renderLiveops();
    fireEvent.click(await screen.findByRole("button", { name: "1회 뽑기" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toBe("");
    expect(alert.textContent).toMatch(/[가-힣]/);
    expect(alert.textContent).not.toContain("SOME_FUTURE_SERVER_CODE");
  });

  it("최초 로딩이 실패하면 번역된 안내와 다시 시도 단추를 보여주고, 다시 시도하면 복구한다", async () => {
    state.mockRejectedValueOnce(new Error("LIVEOPS_EVENT_HALTED"));
    state.mockResolvedValueOnce(baseState);
    renderLiveops();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("중단");
    expect(alert.textContent).not.toContain("LIVEOPS_EVENT_HALTED");

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("사냥 이벤트 뽑기")).toBeTruthy();
  });
});
