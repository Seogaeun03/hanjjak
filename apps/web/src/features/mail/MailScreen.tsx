import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  mailApi,
  mailDateLabel,
  mailTitle,
  noticeApi,
  rewardLabel,
  type MailMessage,
  type MailReward,
  type Notice,
} from "./api";
import { TopAlert } from "../../shared/TopAlert";
import mailTitleIcon from "../../shared/assets/cozy-hud-v1-webp/top-utilities/mail-normalized-v2.webp";
import riceIcon from "../equipment/assets-cozy-pixel/currency-rice-gold-256.png";
import closeIcon from "../../shared/assets/cozy-hud-v9/close-button-v9.png";
import { giftMailOnly } from "./mailFilters";
import { cosmeticArtUrl, cosmeticDisplayName } from "../cosmetics/cosmetic-art";
import "./MailScreen.css";

export { MARKET_MAIL_TYPES, giftMailOnly } from "./mailFilters";

export type MailDataSource = Pick<typeof mailApi, "list" | "claim" | "claimAll" | "read" | "remove">;
export type NoticeDataSource = Pick<typeof noticeApi, "list" | "read" | "remove">;
export type MailTab = "notice" | "mail";

/** 아직 받지 않은 것이 위로 온다. 받은 것은 기록으로 남아 아래에 쌓인다. */
export function sortMailForReading(items: MailMessage[]): MailMessage[] {
  return [...items].sort((left, right) => {
    const leftWaiting = left.rewardStatus === "PENDING";
    const rightWaiting = right.rewardStatus === "PENDING";
    if (leftWaiting !== rightWaiting) return leftWaiting ? -1 : 1;
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function claimableRice(items: MailMessage[]): number {
  return items.filter((mail) => mail.rewardStatus === "PENDING").reduce((total, mail) => total + mail.riceAmount, 0);
}

/**
 * 한 줄에 필요한 것만 모은 모양. 알림과 메시지는 오는 곳이 다르지만 읽고 지우는
 * 몸짓은 같아서, 화면 쪽에서는 하나로 합쳐 두면 목록을 두 벌 만들지 않아도 된다.
 */
type Entry = {
  id: string;
  title: string;
  body: string;
  sender: string;
  sentAt: string;
  read: boolean;
  rice: number;
  rewards: MailReward[];
  /** null 이면 받을 것이 없다. */
  claimable: boolean | null;
};

function noticeEntry(notice: Notice): Entry {
  return {
    id: notice.noticeId,
    title: notice.title,
    body: notice.body,
    sender: notice.senderName,
    sentAt: notice.publishedAt,
    read: notice.readAt != null,
    rice: 0,
    rewards: [],
    claimable: null,
  };
}

function mailEntry(mail: MailMessage): Entry {
  return {
    id: mail.mailId,
    title: mailTitle(mail),
    body: mail.body?.trim() || "",
    sender: mail.senderName?.trim() || "한짝 운영팀",
    sentAt: mail.createdAt,
    read: mail.readAt != null,
    rice: mail.riceAmount,
    rewards: mail.rewards ?? [],
    claimable: mail.rewardStatus === "NONE" ? null : mail.rewardStatus === "PENDING",
  };
}

const TABS: Array<{ id: MailTab; label: string; tone: "red" | "blue" }> = [
  { id: "notice", label: "알림", tone: "red" },
  { id: "mail", label: "메시지", tone: "blue" },
];

export function MailScreen({ dataSource = mailApi, notices = noticeApi, initialTab = "notice", onClose }: {
  dataSource?: MailDataSource;
  notices?: NoticeDataSource;
  initialTab?: MailTab;
  onClose?: () => void;
}) {
  const client = useQueryClient();
  const [tab, setTab] = useState<MailTab>(initialTab);
  const [openId, setOpenId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!onClose) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const mails = useQuery({ queryKey: ["mails"], queryFn: () => dataSource.list(), retry: false });
  const noticeBox = useQuery({ queryKey: ["notices"], queryFn: () => notices.list(), retry: false });

  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: ["mails"] }),
    client.invalidateQueries({ queryKey: ["notices"] }),
    client.invalidateQueries({ queryKey: ["auth", "session"] }),
  ]);
  const fail = (fallback: string) => () => setFailure(fallback);
  const claim = useMutation({
    mutationFn: ({ mailId, cosmeticId }: { mailId: string; cosmeticId?: string | null }) => dataSource.claim(mailId, crypto.randomUUID(), cosmeticId),
    onSuccess: () => { setFailure(null); void refresh(); },
    onError: fail("보상을 받지 못했어요. 가방에 빈 자리가 있는지 확인해 주세요."),
  });
  const claimAll = useMutation({
    mutationFn: () => dataSource.claimAll(crypto.randomUUID()),
    onSuccess: () => { setFailure(null); void refresh(); },
    onError: fail("보상을 모두 받지 못했어요."),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { await (tab === "mail" ? dataSource.remove(id) : notices.remove(id)); },
    onSuccess: () => { setFailure(null); setOpenId(null); void refresh(); },
    onError: fail("지우지 못했어요."),
  });

  const items = sortMailForReading(giftMailOnly(mails.data?.items ?? []));
  const waiting = items.filter((mail) => mail.rewardStatus === "PENDING");
  const unreadNotices = noticeBox.data?.unreadCount ?? 0;
  const busy = claim.isPending || claimAll.isPending || remove.isPending;
  const onMail = tab === "mail";
  const entries = onMail ? items.map(mailEntry) : (noticeBox.data?.items ?? []).map(noticeEntry);
  const active = onMail ? mails : noticeBox;

  /* 펼치는 순간이 읽은 순간이다. 목록을 스치기만 한 것은 읽은 것이 아니다. */
  const open = (entry: Entry) => {
    if (openId === entry.id) { setOpenId(null); return; }
    setOpenId(entry.id);
    if (entry.read) return;
    const mark = onMail ? dataSource.read(entry.id) : notices.read(entry.id);
    void mark.then(() => refresh()).catch(() => setFailure("읽음으로 바꾸지 못했어요."));
  };

  const badge = (id: MailTab) => (id === "mail" ? waiting.length : unreadNotices);

  return <section
    className="mail-screen"
    role="dialog"
    aria-modal="true"
    aria-labelledby="mail-title"
    onPointerDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
  >
    {failure && <TopAlert message={failure} action={<button type="button" onClick={() => { setFailure(null); void active.refetch(); }}>다시 확인</button>} />}

    <div className="mail-paper">
      <aside className="mail-sidebar" aria-label="메시지함 메뉴">
        <nav>{TABS.map((entry) => <button
          key={entry.id}
          type="button"
          className={`mail-tab-${entry.tone}${tab === entry.id ? " is-active" : ""}`}
          aria-current={tab === entry.id ? "page" : undefined}
          onClick={() => { setTab(entry.id); setOpenId(null); }}
        >{entry.label}{badge(entry.id) > 0 && <em>{badge(entry.id)}</em>}</button>)}</nav>
      </aside>

      <header className="mail-heading">
        <h2 id="mail-title"><img src={mailTitleIcon} alt="" aria-hidden="true" /><span>{onMail ? "메시지" : "알림"}</span></h2>
        {onMail && <>
          <p className="mail-summary">
            <img src={riceIcon} alt="" aria-hidden="true" />
            <span>받을 쌀</span>
            <strong>{claimableRice(items).toLocaleString()}</strong>
          </p>
          <button
            type="button"
            className="mail-claim-all"
            disabled={busy || waiting.length === 0}
            onClick={() => claimAll.mutate()}
          >{claimAll.isPending ? "받는 중…" : "모두 받기"}</button>
        </>}
        {onClose && <button type="button" className="mail-close" aria-label="메시지함 닫기" onClick={onClose}>
          <img src={closeIcon} alt="" aria-hidden="true" />
        </button>}
      </header>

      <div className="mail-body">
        {active.isLoading && <p className="mail-empty" role="status">{onMail ? "메시지를" : "알림을"} 불러오는 중입니다.</p>}
        {active.error && <p className="mail-empty is-error" role="alert">
          {onMail ? "메시지를" : "알림을"} 불러오지 못했습니다.
          <button type="button" onClick={() => void active.refetch()}>다시 불러오기</button>
        </p>}
        {!active.isLoading && !active.error && entries.length === 0 && <p className="mail-empty">
          {onMail ? "아직 도착한 메시지가 없어요." : "아직 도착한 알림이 없어요."}
        </p>}
        {entries.length > 0 && <ul className="mail-list">{entries.map((entry) => <li
          key={entry.id}
          className={`${entry.read ? "is-read" : ""}${entry.claimable === false ? " is-claimed" : ""}`}
        >
          <button
            type="button"
            className="mail-row-head"
            aria-expanded={openId === entry.id}
            onClick={() => open(entry)}
          >
            <span className={`mail-row-mark${entry.read ? " is-read" : ""}`} aria-hidden="true" />
            <span className="mail-row-copy">
              <strong>{entry.title}</strong>
              <small>{entry.sender} · {mailDateLabel(entry.sentAt)}</small>
            </span>
            {entry.claimable === true && <b className="mail-row-tag">받을 보상</b>}
            {entry.claimable === false && <span className="mail-row-done">받음</span>}
          </button>

          {openId === entry.id && <div className="mail-detail">
            {entry.body && <p className="mail-detail-body">{entry.body}</p>}
            {(entry.rice > 0 || entry.rewards.length > 0) && <ul className="mail-reward-list">
              {entry.rice > 0 && <li><img src={riceIcon} alt="" aria-hidden="true" />쌀 ×{entry.rice.toLocaleString()}</li>}
              {entry.rewards.map((reward, index) => <li key={`${entry.id}-${index}`}>{rewardLabel(reward)}</li>)}
            </ul>}
            {entry.rewards.filter(reward => reward.kind === "COSMETIC_CHOICE").map((reward, rewardIndex) => <div className="mail-cosmetic-choice" key={`${entry.id}-choice-${rewardIndex}`}>
              <strong>받을 후드집업을 골라주세요</strong>
              <div>{(reward.cosmeticIds ?? []).map(cosmeticId => <button
                type="button"
                key={cosmeticId}
                className={selectedChoices[entry.id] === cosmeticId ? "is-selected" : ""}
                aria-pressed={selectedChoices[entry.id] === cosmeticId}
                onClick={() => setSelectedChoices(current => ({ ...current, [entry.id]: cosmeticId }))}
              >
                <img src={cosmeticArtUrl({ cosmeticId, slot: "TOP" }) ?? undefined} alt="" aria-hidden="true" />
                <span>{cosmeticDisplayName({ cosmeticId, slot: "TOP" })}</span>
              </button>)}</div>
            </div>)}
            <div className="mail-detail-actions">
              {entry.claimable === true && <button
                type="button"
                className="mail-detail-claim"
                disabled={busy || (entry.rewards.some(reward => reward.kind === "COSMETIC_CHOICE") && !selectedChoices[entry.id])}
                aria-label={`${entry.title} 보상 받기`}
                onClick={() => claim.mutate({ mailId: entry.id, cosmeticId: selectedChoices[entry.id] })}
              >{claim.isPending ? "받는 중…" : "받기"}</button>}
              {entry.claimable === true
                ? <small className="mail-detail-hint">보상을 받아야 지울 수 있어요.</small>
                : <button
                  type="button"
                  className="mail-detail-delete"
                  disabled={busy}
                  aria-label={`${entry.title} 지우기`}
                  onClick={() => remove.mutate(entry.id)}
                >삭제</button>}
            </div>
          </div>}
        </li>)}</ul>}
      </div>
    </div>
  </section>;
}
