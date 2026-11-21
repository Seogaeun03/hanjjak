import { useCallback, useEffect, useState } from "react";

/**
 * 배너를 어느 화면 위에서든 보이고 눌리게 하는 두 가지를 함께 마련한다.
 *
 * 장비·스킬·보석·거래소·마이페이지는 네이티브 `<dialog>` 를 `showModal()` 로 연다. 그런 창이
 * 열리면 두 가지가 한꺼번에 걸린다.
 *
 * 하나는 그리는 층이다. 그렇게 열린 창은 브라우저의 top layer 에 그려져서, 바깥에 둔
 * 요소는 `z-index` 를 아무리 올려도 그 아래로 깔린다. 그래서 배너도 popover 로 같은 층에
 * 올린다. top layer 에 오르면 조상에 걸린 `transform` 이나 `overflow` 와도 무관해진다.
 *
 * 다른 하나는 누를 수 있는 범위다. 모달 창이 열린 동안에는 그 창 바깥이 전부 inert 라서,
 * 위에 그려져 있어도 닫기 단추가 눌리지 않는다. 이건 층을 올려서 풀 수 없고, 배너를 그
 * 창 **안으로** 옮겨 심어야 풀린다.
 *
 * @returns `host` 는 배너를 심을 자리(열려 있는 모달 창, 없으면 `null` — 문서 본문),
 *   `ref` 는 그 자리에 심긴 요소를 top layer 로 올리는 갈고리.
 */
export function useBannerHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const find = () => setHost((current) => {
      const next = topmostModal();
      return next === current ? current : next;
    });
    find();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(find);
    observer.observe(document.body, { attributes: true, attributeFilter: ["open"], childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  /*
   * 자리를 옮기면 popover 는 스스로 닫힌다. 옮겨 심을 때마다 갈고리가 다시 불리므로
   * 여기서 한 번 더 올리면 된다.
   */
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element?.isConnected || typeof element.showPopover !== "function") return;
    // popover 를 모르는 브라우저에서는 그냥 평범한 fixed 요소로 남는다. 창 아래로 깔릴 수는
    // 있어도 사라지지는 않는다.
    try {
      element.showPopover();
    } catch { /* 이미 열려 있거나 지원하지 않는 경우. 어느 쪽이든 더 할 일이 없다. */ }
  }, []);

  return { host, ref };
}

/** 가장 나중에 열린 모달 창. 창이 겹쳐 열려도 배너는 맨 앞 창 안에 있어야 눌린다. */
function topmostModal(): HTMLElement | null {
  const open = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")];
  const modal = open.filter((dialog) => {
    try {
      return dialog.matches(":modal");
    } catch {
      // `:modal` 을 모르는 브라우저에서는 열린 창을 모두 모달로 본다. 배너를 안에 심어도
      // top layer 에 올라가는 것은 그대로다.
      return true;
    }
  });
  return modal.at(-1) ?? null;
}
