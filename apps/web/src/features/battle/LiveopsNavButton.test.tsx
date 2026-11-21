// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { BattleUtilityNavigation } from "./BattleHud";
import { LiveopsScreen } from "../liveops/LiveopsScreen";
import type { LiveopsDrawResult, LiveopsState } from "../liveops/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function withQuery(element: ReactElement, seed: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["mails"], { items: [] });
  client.setQueryData(["market-summary"], { activeOrders: 0, closedOrders: 0, recoveryReviewOrders: 0, claimableDeliveries: 0, claimableSettlements: 0, unread: [] });
  seed(client);
  return <QueryClientProvider client={client}>{element}</QueryClientProvider>;
}

function liveopsState(overrides: Partial<LiveopsState>): LiveopsState {
  return {
    eventId: "hunt-ticket-gacha-2026-09",
    displayName: "사냥 티켓 경품 뽑기",
    startsAt: "2026-09-21T00:00:00+09:00",
    endsAt: "2026-09-28T00:00:00+09:00",
    open: true,
    halted: false,
    ticketBalance: 0,
    grantedToday: 0,
    dailyCap: 100,
    secondsPerTicket: 180,
    outcomes: [],
    prizes: [],
    ...overrides,
  };
}

const eventButton = () => screen.queryByRole("button", { name: "이벤트" });

/* 이 단추가 없으면 이벤트 화면으로 들어갈 길이 아예 없다. 실제로 그랬다 — 화면과 라우팅은
   다 붙어 있었는데 메인 화면 HUD 에 단추가 없어 아무도 닿을 수 없었다. PRIMARY_NAV_ITEMS
   쪽에 넣어 둔 항목은 usesLegacyAppHeader 가 모든 화면에서 false 라 그려지지 않는다. */
it("이벤트가 열려 있으면 메인 화면에 이벤트 단추를 띄운다", async () => {
  const onNavigate = vi.fn();
  render(withQuery(
    <BattleUtilityNavigation onNavigate={onNavigate} />,
    (client) => client.setQueryData(["liveops-state"], liveopsState({ open: true })),
  ));

  await waitFor(() => expect(eventButton()).not.toBeNull());
  const labels = Array.from(document.querySelectorAll(".cozy-utility-nav > button"))
    .map((button) => button.getAttribute("aria-label"));
  expect(labels[0]).toBe("이벤트");
  fireEvent.click(eventButton()!);
  expect(onNavigate).toHaveBeenCalledWith("liveops");
});

/* 기간이 끝나도 남은 티켓은 계속 쓸 수 있다. 여기서 단추를 감추면 남은 티켓이 갇힌다. */
it("기간이 끝나도 티켓이 남아 있으면 단추를 남긴다", async () => {
  render(withQuery(
    <BattleUtilityNavigation onNavigate={vi.fn()} />,
    (client) => client.setQueryData(["liveops-state"], liveopsState({ open: false, ticketBalance: 4 })),
  ));

  await waitFor(() => expect(eventButton()).not.toBeNull());
});

/* LiveopsScreen 은 `open || ticketBalance > 0` 이 아니면 "진행 중인 이벤트가 없습니다"만
   보여 준다. 같은 조건으로 감춰야 막다른 단추가 생기지 않는다. */
it("열려 있지도 않고 티켓도 없으면 단추를 감춘다", async () => {
  render(withQuery(
    <BattleUtilityNavigation onNavigate={vi.fn()} />,
    (client) => client.setQueryData(["liveops-state"], liveopsState({ open: false, ticketBalance: 0 })),
  ));

  await waitFor(() => expect(screen.getByRole("button", { name: "거래소" })).toBeTruthy());
  expect(eventButton()).toBeNull();
});

it("상태를 아직 받지 못했으면 단추를 띄우지 않는다", async () => {
  render(withQuery(<BattleUtilityNavigation onNavigate={vi.fn()} />, () => {}));

  await waitFor(() => expect(screen.getByRole("button", { name: "거래소" })).toBeTruthy());
  expect(eventButton()).toBeNull();
});

/* 티켓이 쌓였다는 것은 들어가 보기 전에는 알 길이 없어, 메시지·거래소 단추와 같은 방식으로
   점 하나로 알린다. */
it("쓸 티켓이 있으면 이벤트 단추에 점을 찍는다", async () => {
  render(withQuery(
    <BattleUtilityNavigation onNavigate={vi.fn()} />,
    (client) => client.setQueryData(["liveops-state"], liveopsState({ ticketBalance: 3 })),
  ));

  await waitFor(() => expect(eventButton()).not.toBeNull());
  expect(eventButton()!.querySelector(".cozy-utility-dot")).not.toBeNull();
});

it("쓸 티켓이 없으면 점을 찍지 않는다", async () => {
  render(withQuery(
    <BattleUtilityNavigation onNavigate={vi.fn()} />,
    (client) => client.setQueryData(["liveops-state"], liveopsState({ ticketBalance: 0 })),
  ));

  await waitFor(() => expect(eventButton()).not.toBeNull());
  expect(eventButton()!.querySelector(".cozy-utility-dot")).toBeNull();
});

it("마지막 티켓을 뽑기에 쓰면 공용 상태를 즉시 갱신해 점을 지운다", async () => {
  const before = liveopsState({ ticketBalance: 1 });
  const after = liveopsState({ ticketBalance: 0 });
  const drawResult: LiveopsDrawResult = {
    eventId: before.eventId,
    ticketCost: 1,
    riceGained: 100,
    cosmeticTicketsGained: 0,
    gemBoxesGained: 0,
    ticketBalance: 0,
    lines: [{ kind: "RICE", prizeId: null, prizeDisplayName: null, quantity: 100 }],
  };
  const state = vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after);
  const draw = vi.fn().mockResolvedValue(drawResult);

  render(withQuery(<>
    <BattleUtilityNavigation onNavigate={vi.fn()} activeRoute="liveops" />
    <LiveopsScreen dataSource={{ state, draw }} />
  </>, (client) => client.setQueryData(["liveops-state"], before)));

  fireEvent.click(await screen.findByRole("button", { name: "1회 뽑기" }));
  await waitFor(() => expect(eventButton()!.querySelector(".cozy-utility-dot")).toBeNull());
});
