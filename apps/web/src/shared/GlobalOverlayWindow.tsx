import { useEffect, useRef, type ReactNode } from "react";
import "./GlobalOverlayWindow.css";

/* 거래소·우편은 인벤토리나 장비 같은 창 위에 겹쳐 뜬다. 그 창들은 showModal() 로 열려
   브라우저 top layer 에 앉기 때문에, 겹쳐 뜨는 쪽이 z-index 를 아무리 올려도 그 아래로
   깔린다. 그래서 이쪽도 같은 top layer 에 modal 로 올린다. 나중에 연 modal 이 위에 서고,
   아래 창은 inert 가 되어 뒤쪽 닫기 버튼이나 바깥 클릭이 대신 눌리는 일도 사라진다. */
export function GlobalOverlayWindow({ onClose, labelledBy, children }: { onClose: () => void; labelledBy: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    /* showModal() 은 안쪽 첫 단추로 초점을 옮기고, 브라우저는 그걸 :focus-visible 로
       쳐서 누른 적 없는 탭에 초점 테두리를 그린다. 틀에 초점을 두면 Tab 은 그대로
       첫 단추부터 도는데 테두리는 생기지 않는다. */
    element.focus();
    return () => { if (element.open) element.close(); };
  }, []);

  /* tabIndex 로 틀 자체를 초점 대상으로 만든다. 그러지 않으면 showModal() 이 안쪽
     첫 단추로 초점을 옮기고, 브라우저가 그걸 :focus-visible 로 쳐서 누른 적 없는
     탭에 초점 테두리가 그려진다. */
  return <dialog
    ref={dialog}
    className="global-overlay-window"
    tabIndex={-1}
    aria-labelledby={labelledBy}
    onCancel={(event) => {
      event.preventDefault();
      onClose();
    }}
  >{children}</dialog>;
}
