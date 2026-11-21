// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { MarketSideSwitch } from "./MarketSideSwitch";
import type { MarketOrderSide } from "./api";

afterEach(cleanup);

function Switchable({ start = "BUY" as MarketOrderSide }) {
  const [side, setSide] = useState<MarketOrderSide>(start);
  return <MarketSideSwitch side={side} onChange={setSide} />;
}

const control = () => screen.getByRole("button") as HTMLButtonElement;

/* 단추 하나가 방향을 쥐고 있다. 누를 때마다 반대편으로 넘어가야 한다. */
it("누를 때마다 구매와 판매가 번갈아 바뀐다", () => {
  render(<Switchable />);

  expect(control().className).toContain("is-buy");
  fireEvent.click(control());
  expect(control().className).toContain("is-sell");
  fireEvent.click(control());
  expect(control().className).toContain("is-buy");
});

/* 지금 어느 쪽인지와, 누르면 어디로 가는지를 둘 다 말해 준다. 손잡이 위치만으로는
   화면을 못 보는 사람에게 아무것도 전해지지 않는다. */
it("지금 방향과 누른 뒤 방향을 이름으로 알린다", () => {
  render(<Switchable />);

  expect(control().getAttribute("aria-label")).toBe("거래 방향 구매. 누르면 판매로 바뀝니다.");
  fireEvent.click(control());
  expect(control().getAttribute("aria-label")).toBe("거래 방향 판매. 누르면 구매로 바뀝니다.");
});

it("판매에서 시작하면 판매로 그려진다", () => {
  render(<Switchable start="SELL" />);
  expect(control().className).toContain("is-sell");
});

it("잠겨 있으면 방향이 바뀌지 않는다", () => {
  const onChange = vi.fn();
  render(<MarketSideSwitch side="BUY" onChange={onChange} disabled />);

  expect(control().disabled).toBe(true);
  fireEvent.click(control());
  expect(onChange).not.toHaveBeenCalled();
});
