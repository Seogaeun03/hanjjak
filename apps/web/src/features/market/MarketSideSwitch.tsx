import type { ReactNode } from "react";
import type { MarketOrderSide } from "./api";
import "./MarketSideSwitch.css";

/*
 * 사는 쪽과 파는 쪽은 거래소와 광장이 각자 그리다 색이 서로 반대가 됐다. 한 곳에서만
 * 그려 두 화면이 같은 것을 보게 한다. 단추 하나를 누르면 방향이 넘어가고, 지금 어느
 * 쪽인지는 손잡이가 앉은 자리로 읽는다.
 */
export function MarketSideSwitch({ side, onChange, disabled = false, buyIcon, sellIcon }: {
  side: MarketOrderSide;
  onChange: (next: MarketOrderSide) => void;
  disabled?: boolean;
  buyIcon?: ReactNode;
  sellIcon?: ReactNode;
}) {
  const buying = side === "BUY";
  return <button
    type="button"
    className={`market-side-switch ${buying ? "is-buy" : "is-sell"}`}
    disabled={disabled}
    aria-label={`거래 방향 ${buying ? "구매" : "판매"}. 누르면 ${buying ? "판매" : "구매"}로 바뀝니다.`}
    onClick={() => onChange(buying ? "SELL" : "BUY")}
  >
    <span className="market-side-switch-thumb" aria-hidden="true" />
    <span className="market-side-switch-face is-buy-face" aria-hidden="true">{buyIcon}구매</span>
    <span className="market-side-switch-face is-sell-face" aria-hidden="true">{sellIcon}판매</span>
  </button>;
}
