import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { authApi } from "../auth/api";
import { chatApi, type ChatMessage, type ChatPage, type ChatPrimaryMaterial } from "./api";
import { sanitizeChatInput } from "./inputCharset";
import chatMessageIcon from "./assets-cozy-pixel/chat-runtime-v3-raw-4.webp";
import chatMoreIcon from "./assets-cozy-pixel/chat-runtime-v3-raw-5.webp";
import chatCollapseIcon from "./assets-cozy-pixel/chat-runtime-v3-raw-1.webp";
import chatSendIcon from "./assets-cozy-pixel/chat-runtime-v3-svg-2.svg";
import chatBlockBase from "./assets-cozy-pixel/chat-block-management-base.webp";
import chatUsageGuide from "./assets-cozy-pixel/chat-usage-guide-base.webp";
import chatCloseIcon from "./assets-cozy-pixel/chat-close-final.webp";
import chatConfirmButton from "./assets-cozy-pixel/chat-confirm-button.webp";
import chatUnblockButton from "./assets-cozy-pixel/chat-unblock-final.webp";
import chatActionWarning from "./assets-cozy-pixel/chat-action-warning.webp";
import chatActionDialog from "./assets-cozy-pixel/chat-action-dialog.webp";
import chatActionConfirm from "./assets-cozy-pixel/chat-action-confirm.webp";
import chatActionCancel from "./assets-cozy-pixel/chat-action-cancel.webp";
import "./ChatPanel.css";

// v2 uses the unified HUD coordinate system. Do not reuse the old key: values
// saved by the former 460px/383px mixed layout would reopen enormously tall.
const CHAT_HEIGHT_KEY = "hanjjak.chat.height.v3";
// Desktop HUD groups are rendered at 1.2x on the 1920px Figma canvas.
// Runtime v3 is shown 10% larger than its approved 460 x 435 Figma size.
// In HUD coordinates that is 421.667 x 398.75 before the shared scale.
const MIN_CHAT_HEIGHT = 398.75;
const DEFAULT_CHAT_HEIGHT = 398.75;

const MATERIAL_LABEL: Record<ChatPrimaryMaterial, string> = {
  POTATO: "감자 전문",
  SWEET_POTATO: "고구마 전문",
  CORN: "옥수수 전문",
};

function formatChatTime(createdAt: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Seoul",
  }).format(new Date(createdAt));
}

/* GM 배지는 무지개 글씨로만 표시되므로 색을 못 읽는 경우를 위해 이름표에도 넣는다. */
function nicknameLabel(item: ChatMessage): string {
  const name = `${item.chatTitle ? `${item.chatTitle} ` : ""}${item.gameMaster ? "GM " : ""}${item.nickname}`;
  return item.primaryMaterialType ? `${name}, ${MATERIAL_LABEL[item.primaryMaterialType]}` : name;
}

function titleStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) return undefined;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const foreground = (red * 299 + green * 587 + blue * 114) / 1000 >= 150 ? "#32150e" : "#fff9ec";
  return { "--chat-title-color": color, "--chat-title-foreground": foreground } as CSSProperties;
}

function storedNumber(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(key);
  if (stored === null) return fallback;
  const value = Number(stored);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export function ChatPanel({ previewMode = false }: { previewMode?: boolean }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(true);
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [panelHeight, setPanelHeight] = useState(() => storedNumber(CHAT_HEIGHT_KEY, DEFAULT_CHAT_HEIGHT, MIN_CHAT_HEIGHT, 900));
  const [overlay, setOverlay] = useState<"more" | "guide" | "blocks" | null>(null);
  const [pendingAction, setPendingAction] = useState<{ action: "block" | "report"; item: ChatMessage } | null>(null);
  const [socketReady, setSocketReady] = useState(false);
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: authApi.session, retry: false });
  const messages = useQuery({ queryKey: ["chat", "messages"], queryFn: () => chatApi.messages(), refetchInterval: socketReady ? false : open ? 5_000 : false, retry: false });
  const blocked = useQuery({ queryKey: ["chat", "blocks"], queryFn: () => chatApi.blocks(), retry: false });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyEditVersion = useRef(0);
  const sending = useRef(false);
  // IME 조합 중에는 걸러내지 않는다. 조합 중 값에는 아직 완성되지 않은 자모가 들어 있어
  // 그대로 필터를 태우면 한글 입력이 끊긴다. 조합이 끝난 뒤 한 번에 정리한다.
  const composingRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const resizeRef = useRef<{ pointerId: number; startY: number; startHeight: number; maxHeight: number } | null>(null);
  const openRef = useRef(open);

  useEffect(() => { openRef.current = open; }, [open]);

  function maximumPanelHeight(): number {
    const panel = panelRef.current;
    if (!panel) return DEFAULT_CHAT_HEIGHT;
    const panelRect = panel.getBoundingClientRect();
    const renderedScale = panel.offsetHeight > 0 ? panelRect.height / panel.offsetHeight : 1;
    const historyBottom = document.querySelector<HTMLElement>(".cozy-history-trigger")?.getBoundingClientRect().bottom ?? 176;
    return Math.max(MIN_CHAT_HEIGHT, Math.floor((panelRect.bottom - historyBottom - 8) / renderedScale));
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: panelHeight, maxHeight: maximumPanelHeight() };
  }

  function resizePanel(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = resizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const renderedScale = panelRef.current ? panelRef.current.getBoundingClientRect().height / panelRef.current.offsetHeight : 1;
    setPanelHeight(Math.min(drag.maxHeight, Math.max(MIN_CHAT_HEIGHT, drag.startHeight + (drag.startY - event.clientY) / renderedScale)));
  }

  function finishResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    resizeRef.current = null;
  }

  useEffect(() => {
    if (previewMode || typeof WebSocket === "undefined") return;
    let stopped = false;
    let retryTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let socket: WebSocket | undefined;
    let retryDelay = 1_000;

    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/chat`);
      socket.onopen = () => { retryDelay = 1_000; setSocketReady(true); };
      socket.onclose = () => {
        setSocketReady(false);
        if (!stopped) {
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      };
      socket.onerror = () => setSocketReady(false);
      socket.onmessage = (event) => {
        let payload: { type?: string; message?: ChatMessage };
        try { payload = JSON.parse(event.data) as { type?: string; message?: ChatMessage }; } catch { return; }
        if (payload.type !== "message" || !payload.message) return;
        client.setQueryData<ChatPage>(["chat", "messages"], (current) => {
          const items = [payload.message!, ...(current?.items ?? [])].filter((item, index, all) => all.findIndex((candidate) => candidate.messageId === item.messageId) === index);
          return { items: items.slice(0, 30), nextCursor: current?.nextCursor ?? null, unreadCount: openRef.current ? 0 : (current?.unreadCount ?? 0) + 1 };
        });
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
      setSocketReady(false);
    };
  }, [client, previewMode]);

  useEffect(() => {
    const addPreviewMessage = (event: Event) => {
      const message = (event as CustomEvent<ChatMessage>).detail;
      if (!message) return;
      client.setQueryData<ChatPage>(["chat", "messages"], (current) => ({
        items: [message, ...(current?.items ?? [])].slice(0, 30),
        nextCursor: current?.nextCursor ?? null,
        unreadCount: openRef.current ? 0 : (current?.unreadCount ?? 0) + 1,
      }));
    };
    window.addEventListener("hanjjak:preview-chat", addPreviewMessage);
    return () => window.removeEventListener("hanjjak:preview-chat", addPreviewMessage);
  }, [client]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { window.localStorage.setItem(CHAT_HEIGHT_KEY, String(panelHeight)); }, [panelHeight]);
  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".chat-more, .chat-more-popover")) setOverlay((current) => current === "more" ? null : current);
      if (!target.closest(".chat-guide-popover, .chat-blocks-popover, .chat-more-popover")) setOverlay((current) => current === "guide" || current === "blocks" ? null : current);
      if (!target.closest(".chat-message-list strong, .chat-item-actions")) setActiveMenuId(null);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOverlay(null);
      setActiveMenuId(null);
      setPendingAction(null);
    };
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, []);
  useEffect(() => {
    const clampHeight = () => setPanelHeight((current) => Math.min(current, maximumPanelHeight()));
    window.addEventListener("resize", clampHeight);
    return () => window.removeEventListener("resize", clampHeight);
  }, []);

  async function send() {
    // 조합이 끝나지 않은 채 전송될 수 있으므로 여기서 한 번 더 거른다.
    const value = sanitizeChatInput(body).trim();
    if (!value || sending.current) return;
    sending.current = true;
    const draftEditVersion = bodyEditVersion.current;
    const submittedBody = value;
    try {
      const result = await chatApi.send(submittedBody);
      if (bodyEditVersion.current === draftEditVersion) { bodyEditVersion.current += 1; setBody(""); }
      setNotice(null);
      const message = result.result.message;
      client.setQueryData<ChatPage>(["chat", "messages"], (current) => {
        const items = [message, ...(current?.items ?? [])].filter((item, index, all) => all.findIndex((candidate) => candidate.messageId === item.messageId) === index);
        return { items: items.slice(0, 30), nextCursor: current?.nextCursor ?? null, unreadCount: current?.unreadCount ?? 0 };
      });
      void client.invalidateQueries({ queryKey: ["chat", "messages"] }).catch(() => undefined);
    } catch (error) {
      const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
      if (code === "CHAT_DISABLED") return;
      if (bodyEditVersion.current === draftEditVersion) setBody("");
      setNotice(code === "BLOCKED_POLICY" ? "보낼 수 없는 표현이 포함되어 있어요." : code === "CHAT_BANNED" ? "채팅 이용이 제한된 계정입니다." : "채팅을 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      sending.current = false;
    }
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    const { action, item } = pendingAction;
    try {
      if (action === "block") {
        if (previewMode) {
          client.setQueryData(["chat", "blocks"], (current: { accountId: string; nickname: string; createdAt: string }[] | undefined) => current?.some((entry) => entry.accountId === item.accountId) ? current : [...(current ?? []), { accountId: item.accountId, nickname: item.nickname, createdAt: new Date().toISOString() }]);
        } else {
          await chatApi.block(item.accountId);
          client.setQueryData(["chat", "blocks"], (current: { accountId: string; nickname: string; createdAt: string }[] | undefined) => current?.some((entry) => entry.accountId === item.accountId) ? current : [...(current ?? []), { accountId: item.accountId, nickname: item.nickname, createdAt: new Date().toISOString() }]);
        }
      } else if (!previewMode) await chatApi.report("messages", item.messageId, "OTHER");
      setPendingAction(null);
      setActiveMenuId(null);
    } catch {
      setPendingAction(null);
      setNotice("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  if (!open) return <aside className="chat-panel is-closed" aria-label="채팅">
    <button type="button" className="chat-open" onClick={() => {
      client.setQueryData<ChatPage>(["chat", "messages"], (current) => current ? { ...current, unreadCount: 0 } : current);
      setOpen(true);
    }} aria-expanded={false}>
      <img className="chat-message-icon" src={chatMessageIcon} alt="" />
      <span>채팅</span>
      {(messages.data?.unreadCount ?? 0) > 0 && <b>{(messages.data?.unreadCount ?? 0) > 99 ? "99+" : messages.data?.unreadCount}</b>}
    </button>
  </aside>;

  return <aside
    ref={panelRef}
    className="chat-panel is-open"
    aria-label="채팅"
    style={{ height: `${panelHeight}px` } as CSSProperties}
  >
    <div
      className="chat-resize-handle"
      role="separator"
      aria-label="채팅창 높이 조절"
      aria-orientation="horizontal"
      tabIndex={0}
      onPointerDown={startResize}
      onPointerMove={resizePanel}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        setPanelHeight((current) => Math.min(maximumPanelHeight(), Math.max(MIN_CHAT_HEIGHT, current + (event.key === "ArrowUp" ? 16 : -16))));
      }}
    ><span /></div>
    <header className="chat-panel-header">
      <div className="chat-panel-title">
        <img className="chat-message-icon" src={chatMessageIcon} alt="" />
        <h2>채팅</h2>
      </div>
      <div className="chat-header-actions">
        <button type="button" className="chat-more" aria-label="채팅 더보기" aria-expanded={overlay === "more"} onClick={() => setOverlay((current) => current === "more" ? null : "more")}><img src={chatMoreIcon} alt="" /></button>
        <button type="button" className="chat-collapse" onClick={() => { setOpen(false); setActiveMenuId(null); setOverlay(null); }} aria-label="채팅 접기" aria-expanded={true}><img src={chatCollapseIcon} alt="" /></button>
      </div>
    </header>
    {notice && <p className="chat-notice" role="status">{notice}<button type="button" aria-label="안내 닫기" onClick={() => setNotice(null)}>×</button></p>}
    {overlay === "more" && <div className="chat-more-popover" role="menu">
      <button type="button" role="menuitem" onClick={() => setOverlay("blocks")}>차단 관리</button>
      <button type="button" role="menuitem" onClick={() => setOverlay("guide")}>채팅 이용 안내</button>
    </div>}
    {overlay === "guide" && <section className="chat-guide-popover" role="dialog" aria-modal="false" aria-labelledby="chat-guide-title" style={{ backgroundImage: `url(${chatUsageGuide})` }}>
      <h3 id="chat-guide-title">채팅 이용 안내</h3>
      <button type="button" className="chat-overlay-close" aria-label="채팅 이용 안내 닫기" onClick={() => setOverlay(null)}><img src={chatCloseIcon} alt="" /></button>
      <div className="chat-guide-copy"><p>욕설·성희롱·사기성 거래 유도는 금지됩니다.</p><p>문의 및 제보는 설정의 버그 문의를 이용해 주세요.</p></div>
      <button type="button" className="chat-guide-confirm" onClick={() => setOverlay(null)} style={{ backgroundImage: `url(${chatConfirmButton})` }}>확인</button>
    </section>}
    {overlay === "blocks" && <section id="chat-blocks-list" className="chat-blocks-popover" role="dialog" aria-modal="false" aria-labelledby="chat-blocks-title" style={{ backgroundImage: `url(${chatBlockBase})` }}>
      <h3 id="chat-blocks-title">차단 관리</h3>
      <button type="button" className="chat-overlay-close" aria-label="차단 관리 닫기" onClick={() => setOverlay(null)}><img src={chatCloseIcon} alt="" /></button>
      {blocked.data?.length ? <div className="chat-blocks" aria-label="차단 목록">{blocked.data.map((item) => <div key={item.accountId}><span>{item.nickname}</span><button type="button" style={{ backgroundImage: `url(${chatUnblockButton})` }} onClick={() => {
        if (previewMode) {
          client.setQueryData(["chat", "blocks"], (current: typeof blocked.data) => current?.filter((blockedUser) => blockedUser.accountId !== item.accountId) ?? []);
          return;
        }
        void chatApi.unblock(item.accountId).then(() => {
          client.setQueryData(["chat", "blocks"], (current: typeof blocked.data) => current?.filter((blockedUser) => blockedUser.accountId !== item.accountId) ?? []);
          return client.invalidateQueries({ queryKey: ["chat", "blocks"] });
        });
      }}>차단 해제</button></div>)}</div> : <p className="chat-blocks-empty">차단한 사용자가 없습니다.</p>}
    </section>}
    <ChatMessages
      items={(messages.data?.items ?? []).filter((message) => !(blocked.data ?? []).some((blockedUser) => blockedUser.accountId === message.accountId))}
      loading={messages.isLoading}
      ownAccountId={session.data?.account?.accountId ?? null}
      activeMenuId={activeMenuId}
      onOpenMenu={setActiveMenuId}
      onRequestAction={(action, item) => setPendingAction({ action, item })}
    />
    <div className="chat-composer">
      <div className="chat-input-shell">
        <textarea
          ref={inputRef}
          value={body}
          maxLength={240}
          placeholder="메시지를 입력하세요"
          aria-label="채팅 입력"
          onChange={(event) => { bodyEditVersion.current += 1; setBody(composingRef.current ? event.target.value : sanitizeChatInput(event.target.value)); }}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={(event) => { composingRef.current = false; bodyEditVersion.current += 1; setBody(sanitizeChatInput(event.currentTarget.value)); }}
          rows={1}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !composingRef.current) { event.preventDefault(); void send(); } }}
        />
        <span aria-hidden="true">{body.length} / 240</span>
      </div>
      <button type="button" className="chat-send" aria-label="채팅 보내기" disabled={!body.trim()} onClick={() => void send()}><img src={chatSendIcon} alt="" /><span className="sr-only">보내기</span></button>
    </div>
    {pendingAction && createPortal(<div className="chat-action-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) { setPendingAction(null); setActiveMenuId(null); } }}>
      <section className="chat-action-confirmation" role="dialog" aria-modal="true" aria-labelledby="chat-action-title" style={{ backgroundImage: `url(${chatActionDialog})` }}>
        <img className="chat-action-warning" src={chatActionWarning} alt="" />
        <h3 id="chat-action-title">이 사용자를 {pendingAction.action === "block" ? "차단" : "신고"}할까요?</h3>
        <button type="button" className="chat-action-confirm" onClick={() => void confirmPendingAction()} style={{ backgroundImage: `url(${chatActionConfirm})` }}>{pendingAction.action === "block" ? "차단" : "신고"}</button>
        <button type="button" className="chat-action-cancel" onClick={() => { setPendingAction(null); setActiveMenuId(null); }} style={{ backgroundImage: `url(${chatActionCancel})` }}>취소</button>
      </section>
    </div>, document.body)}
  </aside>;
}

function ChatMessages({ items, loading, ownAccountId, activeMenuId, onOpenMenu, onRequestAction }: { items: ChatMessage[]; loading: boolean; ownAccountId: string | null; activeMenuId: string | null; onOpenMenu: (messageId: string | null) => void; onRequestAction: (action: "block" | "report", item: ChatMessage) => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  const followLatestRef = useRef(true);
  /*
   * 사용자가 목록을 읽기 위해 위로 올렸다면 새 메시지가 와도 현재 위치를
   * 유지한다. 목록이 이미 하단에 붙어 있을 때만 최신 메시지를 따라간다.
   */
  const latestMessageId = items[0]?.messageId ?? null;

  useEffect(() => {
    if (!followLatestRef.current) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [latestMessageId, loading]);

  if (loading) return <p className="chat-state" role="status">채팅을 불러오는 중…</p>;
  if (items.length === 0) return <p className="chat-state">첫 메시지를 남겨보세요.</p>;
  return <ol ref={listRef} className="chat-message-list" onScroll={(event) => {
    const list = event.currentTarget;
    followLatestRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 20;
  }}>{[...items].reverse().map((item) => <li key={item.messageId} className={item.primaryMaterialType ? `material-${item.primaryMaterialType.toLowerCase().replace("_", "-")}` : undefined}>
    <strong
      className={`chat-message-author${item.accountId === ownAccountId ? " is-own" : ""}`}
      aria-label={nicknameLabel(item)}
      onClick={() => {
        if (item.accountId === ownAccountId) {
          onOpenMenu(null);
          return;
        }
        onOpenMenu(activeMenuId === item.messageId ? null : item.messageId);
      }}
    >
      {item.chatTitle && <span className="chat-title-badge" style={titleStyle(item.chatTitleColor)}>{item.chatTitle}</span>}
      <span className="chat-author-name">{item.gameMaster && <span className="chat-gm-badge"><span>GM</span></span>}{item.nickname}</span>
    </strong>
    <p>{item.body}</p>
    <time dateTime={item.createdAt}>{formatChatTime(item.createdAt)}</time>
    {activeMenuId === item.messageId && <div className="chat-item-actions">
      <button type="button" onClick={() => onRequestAction("block", item)}>차단</button>
      <button type="button" onClick={() => onRequestAction("report", item)}>신고</button>
    </div>}
  </li>)}</ol>;
}
