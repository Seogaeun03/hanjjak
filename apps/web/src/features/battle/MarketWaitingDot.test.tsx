// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { BattleUtilityNavigation } from "./BattleHud";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function withQuery(element: ReactElement, seed: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(client);
  return <QueryClientProvider client={client}>{element}</QueryClientProvider>;
}

const marketButton = () => screen.getByRole("button", { name: "거래소" });

function summary(claimableDeliveries: number, claimableSettlements: number) {
  return { activeOrders: 0, closedOrders: 0, recoveryReviewOrders: 0, claimableDeliveries, claimableSettlements, unread: [] };
}

/* 팔린 쌀도 도착한 물건도 거래소에 쌓여 있다가 받으러 가야 한다. 열어 보기 전에는
   기다리는 것이 있는지 알 길이 없어, 단추에 점 하나로 알린다. */
it("받을 것이 있으면 거래소 단추에 점을 찍는다", async () => {
  render(withQuery(
    <BattleUtilityNavigation onNavigate={vi.fn()} />,
    (client) => { client.setQueryData(["market-summary"], summary(0, 2)); client.setQueryData(["mails"], { items: [] }); },
  ));

  await waitFor(() => expect(marketButton().querySelector(".cozy-utility-dot")).not.toBeNull());
});

it("도착한 물품만 있어도 점을 찍는다", async () => {
  render(withQuery(
    <BattleUtilityNavigation onNavigate={vi.fn()} />,
    (client) => { client.setQueryData(["market-summary"], summary(3, 0)); client.setQueryData(["mails"], { items: [] }); },
  ));

  await waitFor(() => expect(marketButton().querySelector(".cozy-utility-dot")).not.toBeNull());
});

it("받을 것이 없으면 점을 찍지 않는다", async () => {
  render(withQuery(
    <BattleUtilityNavigation onNavigate={vi.fn()} />,
    (client) => { client.setQueryData(["market-summary"], summary(0, 0)); client.setQueryData(["mails"], { items: [] }); },
  ));

  await waitFor(() => expect(marketButton()).toBeTruthy());
  expect(marketButton().querySelector(".cozy-utility-dot")).toBeNull();
});
