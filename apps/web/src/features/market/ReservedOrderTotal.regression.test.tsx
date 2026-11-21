// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { TradeTicket } from "./MarketScreen";
import type { MarketInstrument, MarketOrderQuote, MarketOrderSide } from "./api";

afterEach(cleanup);

const instrument: MarketInstrument = {
  instrumentId: "potato-1",
  canonicalKey: "material:potato_m1",
  itemId: "POTATO_M1",
  displayName: "감자 한 조각",
  category: "MATERIAL",
  attributes: {},
  status: "ACTIVE",
  bestBidUnitPrice: 90,
  bestAskUnitPrice: 95,
  lastTradeUnitPrice: 90,
  marketRevision: 1,
};

/* 지정가 주문은 맞은편에 사람이 없어 지금 당장 오갈 것이 없다. 서버 견적은 그 사실대로
   0을 돌려주는데, 그 0을 그대로 쓰면 값을 걸어 둔 사람에게 "0쌀"이라고 답하게 된다. */
function reservedQuote(side: MarketOrderSide, quantity: number, unitPrice: number): MarketOrderQuote {
  return {
    instrumentId: instrument.instrumentId,
    side,
    timeInForce: "GTC",
    requestedQuantity: quantity,
    limitUnitPrice: unitPrice,
    expectedFilledQuantity: 0,
    expectedRemainingQuantity: quantity,
    lowestFilledUnitPrice: null,
    highestFilledUnitPrice: null,
    weightedAverageUnitPrice: null,
    totalPrice: 0,
    expectedFee: 0,
    expectedSettlementAmount: 0,
    availableRice: 1_000_000,
    availableQuantity: 1_000,
    marketRevision: 1,
  };
}

function Ticket({ side, quantity, unitPrice }: { side: MarketOrderSide; quantity: number; unitPrice: number }) {
  return <TradeTicket
    selected={instrument}
    side={side}
    setSide={() => undefined}
    view="book"
    timeInForce="GTC"
    setTimeInForce={() => undefined}
    quantity={quantity}
    setQuantity={() => undefined}
    unitPrice={unitPrice}
    setUnitPrice={() => undefined}
    availableQuantity={1_000}
    availableRice={1_000_000}
    quote={reservedQuote(side, quantity, unitPrice)}
    quotePending={false}
    quoteError={null}
    busy={false}
    locked={false}
    confirmation={null}
    onCancel={() => undefined}
    onSubmit={() => undefined}
  />;
}

it("지정가 주문의 최대 대기 시간을 24시간으로 안내한다", () => {
  render(<Ticket side="SELL" quantity={20} unitPrice={90} />);

  expect(screen.getByText("최대 24시간 대기")).toBeTruthy();
});

it("예약 구매는 수량과 한도가를 곱한 결제액을 보여 준다", () => {
  render(<Ticket side="BUY" quantity={20} unitPrice={95} />);

  const total = document.querySelector(".market-quote-total strong");
  expect(total?.textContent).toContain("1,900");
});

/* 판매는 서버가 체결액의 1/10을 수수료로 뗀다. 곱한 값을 그대로 보여 주면 10% 부풀려진다. */
it("예약 판매는 수수료를 뺀 받을 쌀을 보여 준다", () => {
  render(<Ticket side="SELL" quantity={20} unitPrice={90} />);

  const rows = [...document.querySelectorAll(".market-quote div")].map((row) => row.textContent ?? "");
  expect(rows.some((row) => row.includes("예상 판매금액") && row.includes("1,800"))).toBe(true);
  expect(rows.some((row) => row.includes("판매 수수료") && row.includes("180"))).toBe(true);

  const total = document.querySelector(".market-quote-total strong");
  expect(total?.textContent).toContain("1,620");
});
