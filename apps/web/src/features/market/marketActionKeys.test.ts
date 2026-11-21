import { expect, it } from "vitest";
import { marketActionKeys } from "./marketChangePolling";

/*
 * 예전에는 무슨 일을 하든 거래소의 모든 조회를 낡은 것으로 표시했다. 감자 한 조각을 팔아도
 * 보석·우편함·모든 품목의 주문장이 따라 움직였다. 여기서 못 박는 것은 "무엇이 다시 읽히는가"
 * 하나뿐이다. 값이 실제로 바뀐 자리를 빠뜨리면 화면이 거짓을 보여 주고, 남기면 요청이 는다.
 */
const text = (keys: ReturnType<typeof marketActionKeys>) => keys.map(key => JSON.stringify(key));

it("체결되지 않은 판매 등록은 그 품목과 내 주문만 다시 읽는다", () => {
  const keys = text(marketActionKeys({ account: true, instrumentIds: ["potato-1"], myOrders: true }));

  expect(keys).toContain(JSON.stringify(["market-order-book", "potato-1"]));
  expect(keys).toContain(JSON.stringify(["market-orders"]));
  expect(keys).toContain(JSON.stringify(["inventory"]));
  /* 체결된 것이 없으니 받을 것도 체결 내역도 그대로다. */
  expect(keys).not.toContain(JSON.stringify(["market-trades"]));
  expect(keys).not.toContain(JSON.stringify(["market-mails"]));
  expect(keys).not.toContain(JSON.stringify(["market-deliveries"]));
});

it("체결된 판매는 받을 쌀과 체결 내역까지 다시 읽는다", () => {
  const keys = text(marketActionKeys({ account: true, instrumentIds: ["potato-1"], myOrders: true, trades: true, settlements: true }));

  expect(keys).toContain(JSON.stringify(["market-mails"]));
  expect(keys).toContain(JSON.stringify(["market-trades"]));
  expect(keys).toContain(JSON.stringify(["market-summary"]));
  /* 산 사람의 받을 물품은 내 화면의 일이 아니다. */
  expect(keys).not.toContain(JSON.stringify(["market-deliveries"]));
});

it("물품 수령은 어떤 품목의 시세도 건드리지 않는다", () => {
  const keys = text(marketActionKeys({ account: true, deliveries: true }));

  expect(keys).toEqual([
    JSON.stringify(["auth", "session"]),
    JSON.stringify(["inventory"]),
    JSON.stringify(["gems"]),
    JSON.stringify(["market-deliveries"]),
    JSON.stringify(["market-summary"]),
  ]);
});

it("품목을 모르면 품목 조회를 건드리지 않는다", () => {
  const keys = text(marketActionKeys({ account: true, instrumentIds: [], myOrders: true }));

  expect(keys).not.toContain(JSON.stringify(["market-instruments"]));
});

it("같은 열쇠를 두 번 적지 않는다", () => {
  const keys = text(marketActionKeys({ myOrders: true, trades: true, deliveries: true, settlements: true }));

  expect(keys.length).toBe(new Set(keys).size);
});
