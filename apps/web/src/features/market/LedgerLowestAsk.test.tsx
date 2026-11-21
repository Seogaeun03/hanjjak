// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarketLedger } from "./MarketLedger";
import type { MarketOrder } from "./api";

afterEach(cleanup);

/* 처음 걸어 둔 수량은 남은 수량을 보면 알 수 있다. 그 자리에서 정작 알고 싶은 것은
   지금 같은 물품이 얼마에 올라와 있는지, 내 값이 그보다 비싼지였다. */
const order: MarketOrder = {
  orderId: "order-1",
  instrumentId: "potato-1",
  itemId: "POTATO_M1",
  displayName: "감자 한 조각",
  side: "SELL",
  timeInForce: "GTC",
  initialQuantity: 30,
  filledQuantity: 10,
  remainingQuantity: 20,
  limitUnitPrice: 120,
  reservedRice: 0,
  status: "PARTIALLY_FILLED",
  priorityAt: "2026-09-16T00:00:00Z",
  createdAt: "2026-09-16T00:00:00Z",
  updatedAt: "2026-09-16T00:00:00Z",
  expiresAt: null,
};

function figures() {
  return [...document.querySelectorAll(".market-plaza-active-card .market-plaza-order-figures > div")].map(row => row.textContent ?? "");
}

it("진행 중 거래는 처음 수량 대신 지금 매물의 최저가를 보여 준다", () => {
  render(<MarketLedger active={[order]} closed={[]} trades={[]} lowestAsk={{ "potato-1": 95 }} loading={false} busy={false} settled={new Set<string>()} onUpdate={() => undefined} onCancel={() => undefined} />);

  expect(figures()).toEqual(["현재 최저가95 쌀", "남은 수량20개", "개당120 쌀"]);
  expect(screen.queryByText("30개")).toBeNull();
});

/* 아무도 팔지 않는 물품은 최저가가 없다. 없는 값을 0으로 적으면 공짜로 읽힌다. */
it("올라온 매물이 없으면 최저가 자리를 비워 둔다", () => {
  render(<MarketLedger active={[order]} closed={[]} trades={[]} lowestAsk={{ "potato-1": null }} loading={false} busy={false} settled={new Set<string>()} onUpdate={() => undefined} onCancel={() => undefined} />);

  expect(figures()[0]).toBe("현재 최저가—");
});

it("진행 중 주문의 남은 수량을 9,999개보다 크게 수정할 수 있다", () => {
  const onUpdate = vi.fn();
  render(<MarketLedger active={[order]} closed={[]} trades={[]} lowestAsk={{ "potato-1": 95 }} loading={false} busy={false} settled={new Set<string>()} onUpdate={onUpdate} onCancel={() => undefined} />);

  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  fireEvent.change(screen.getByLabelText("감자 한 조각 남은 수량"), { target: { value: "15000" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));

  expect(onUpdate).toHaveBeenCalledWith("order-1", { quantity: 15_000 });
});

it("수정 중 현재 최저가를 한 번에 가격 칸에 넣는다", () => {
  const onUpdate = vi.fn();
  render(<MarketLedger active={[order]} closed={[]} trades={[]} lowestAsk={{ "potato-1": 95 }} loading={false} busy={false} settled={new Set<string>()} onUpdate={onUpdate} onCancel={() => undefined} />);

  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  fireEvent.click(screen.getByRole("button", { name: "최저가 설정" }));

  expect((screen.getByLabelText("감자 한 조각 개당 가격") as HTMLInputElement).value).toBe("95");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(onUpdate).toHaveBeenCalledWith("order-1", { limitUnitPrice: 95 });
});
