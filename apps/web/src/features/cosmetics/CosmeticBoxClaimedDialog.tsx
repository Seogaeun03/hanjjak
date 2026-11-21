import { useEffect, useRef } from "react";
import selectorBoxIcon from "./assets-cozy-pixel/cosmetic-selector-box-v1.png";

type Props = {
  count: number;
  /** 화면 전환을 쥔 쪽이 없으면 안내만 하고 이동 버튼은 내린다. */
  onGoToInventory?: () => void;
  onClose: () => void;
};

/** 받은 상자는 인벤토리로 들어간다. 어디로 갔는지 모른 채 화면을 떠나지 않게 바로 알려 준다. */
export function CosmeticBoxClaimedDialog({ count, onGoToInventory, onClose }: Props) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    return () => previous?.focus();
  }, []);

  const keepFocusInside = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return <div className="cosmetic-box-claimed-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialog} className="cosmetic-box-claimed" role="dialog" aria-modal="true" aria-labelledby="cosmetic-box-claimed-title" onKeyDown={keepFocusInside}>
      <img src={selectorBoxIcon} alt="" aria-hidden="true" />
      <h2 id="cosmetic-box-claimed-title">치장 선택권 박스 {count}개 수령하였습니다.</h2>
      <p>아이템 탭에서 상자를 열어 치장을 고를 수 있습니다.</p>
      <div className="cosmetic-box-claimed-actions">
        {onGoToInventory && <button type="button" onClick={onGoToInventory}>인벤토리로 이동</button>}
        <button type="button" className="is-secondary" onClick={onClose}>취소</button>
      </div>
    </section>
  </div>;
}
