// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MarketLedger } from "./MarketLedger";
import type { MarketOrder, MarketTrade } from "./api";

afterEach(cleanup);

/*
 * 지난 거래의 총 금액은 내 체결 기록에서 다시 맞춰 낸다. 그 기록을 부르는 길이 막혀 있던
 * 동안에는 모든 줄의 총 금액이 빈칸이었다. 기록이 있으면 금액이 적히는지 여기서 지킨다.
 */
const order: MarketOrder = {
  orderId: "order-1",
  instrumentId: "corn-1",
  itemId: "CORN_M1",
  displayName: "미니 옥수수",
  side: "BUY",
  timeInForce: "GTC",
  initialQuantity: 62,
  filledQuantity: 62,
  remainingQuantity: 0,
  limitUnitPrice: 120,
  reservedRice: 0,
  status: "FILLED",
  priorityAt: "2026-09-16T01:00:00Z",
  createdAt: "2026-09-16T01:00:00Z",
  updatedAt: "2026-09-16T01:05:00Z",
  expiresAt: null,
};
const trades: MarketTrade[] = [
  { tradeId: "trade-1", instrumentId: "corn-1", itemId: "CORN_M1", displayName: "미니 옥수수", side: "BUY", quantity: 40, unitPrice: 110, totalPrice: 4_400, fee: null, settlementAmount: null, filledAt: "2026-09-16T01:01:00Z" },
  { tradeId: "trade-2", instrumentId: "corn-1", itemId: "CORN_M1", displayName: "미니 옥수수", side: "BUY", quantity: 22, unitPrice: 120, totalPrice: 2_640, fee: null, settlementAmount: null, filledAt: "2026-09-16T01:04:00Z" },
];

function pastFigures() {
  return [...document.querySelectorAll(".market-plaza-past-row .market-plaza-order-figures > div")].map(row => row.textContent ?? "");
}
function ledger(feed: MarketTrade[]) {
  return <MarketLedger active={[]} closed={[order]} trades={feed} lowestAsk={{}} loading={false} busy={false} settled={new Set<string>()} onUpdate={() => undefined} onCancel={() => undefined} />;
}

it("지난 거래는 체결 기록을 합한 총 금액을 보여 준다", () => {
  render(ledger(trades));

  expect(pastFigures()).toEqual(["수량62개", "총 금액7,040 쌀"]);
});

/* 오래된 거래는 기록이 남아 있는 범위를 넘어간다. 그때는 틀린 금액 대신 빈 값을 적는다. */
it("맞춰 낼 기록이 없으면 총 금액 자리를 비워 둔다", () => {
  render(ledger([]));

  expect(pastFigures()[1]).toBe("총 금액—");
});
