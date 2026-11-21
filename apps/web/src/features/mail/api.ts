export type MailRewardKind = "ITEM" | "GEM" | "COSMETIC" | "COSMETIC_CHOICE" | "TICKET";
export type MailReward = {
  kind: MailRewardKind;
  quantity: number;
  itemId?: string | null;
  cosmeticId?: string | null;
  cosmeticIds?: string[] | null;
  gemLevel?: number | null;
  gemOption?: string | null;
  displayName?: string | null;
  autoRegister?: boolean;
};
/** NONE 은 받을 것이 없는 안내 우편, PENDING 은 아직 안 받은 보상, CLAIMED 는 받아 간 보상. */
export type MailRewardStatus = "NONE" | "PENDING" | "CLAIMED";

export type MailMessage = {
  mailId: string;
  type: string;
  riceAmount: number;
  rewardStatus: MailRewardStatus;
  createdAt: string;
  claimedAt: string | null;
  title: string | null;
  body: string | null;
  senderName: string | null;
  readAt: string | null;
  rewards: MailReward[];
};
export type MailPage = { items: MailMessage[]; nextCursor: string | null; totalItems: number };
export type MailClaimResult = { mailId: string; riceAmount: number; claimedAt: string; walletBalance: number; rewards: MailReward[] };
export type MailClaimAllResult = { claimedMailIds: string[]; totalRiceAmount: number; walletBalance: number; rewards: MailReward[] };
export type MailReadResult = { mailId: string; readAt: string };
export type MailDeleteResult = { mailId: string; deletedAt: string };

export type Notice = {
  noticeId: string;
  title: string;
  body: string;
  senderName: string;
  publishedAt: string;
  expiresAt: string | null;
  readAt: string | null;
};
export type NoticePage = { items: Notice[]; unreadCount: number };
export type NoticeReadResult = { noticeId: string; readAt: string };
export type NoticeDeleteResult = { noticeId: string; deletedAt: string };

type Envelope<T> = { data: T };
type CommandResult<T> = { commandId: string; idempotencyKey: string; status: string; result: T };
type ErrorEnvelope = { code?: string; messageKey?: string };

export class MailApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as Envelope<T> & ErrorEnvelope;
  if (!response.ok) throw new MailApiError(response.status, body.code || body.messageKey || `HTTP_${response.status}`);
  return body.data;
}

/* 받기는 두 번 눌러도 한 번만 들어가야 한다. 서버가 키로 같은 명령을 알아본다. */
function commandHeaders(key: string): HeadersInit {
  return { Accept: "application/json", "Content-Type": "application/json", "Idempotency-Key": key };
}

/* 읽음·삭제는 같은 요청을 두 번 보내도 결과가 같다. 멱등 키까지 붙일 이유가 없다. */
function post(path: string): Promise<Response> {
  return fetch(path, { method: "POST", credentials: "include", headers: { Accept: "application/json" } });
}

export const mailApi = {
  list: (claimable?: boolean, cursor?: string | null) => {
    const search = new URLSearchParams();
    if (claimable !== undefined) search.set("claimable", String(claimable));
    if (cursor) search.set("cursor", cursor);
    const query = search.toString();
    return fetch(`/api/v1/mails${query ? `?${query}` : ""}`, { credentials: "include", headers: { Accept: "application/json" } }).then(json<MailPage>);
  },
  claim: (mailId: string, key: string, cosmeticId?: string | null) => fetch(`/api/v1/mails/${mailId}/claim`, {
    method: "POST", credentials: "include", headers: commandHeaders(key), body: JSON.stringify({ cosmeticId: cosmeticId ?? null }),
  }).then(json<CommandResult<MailClaimResult>>),
  claimAll: (key: string) => fetch("/api/v1/mails/claim-all", {
    method: "POST", credentials: "include", headers: commandHeaders(key),
  }).then(json<CommandResult<MailClaimAllResult>>),
  read: (mailId: string) => post(`/api/v1/mails/${mailId}/read`).then(json<MailReadResult>),
  remove: (mailId: string) => post(`/api/v1/mails/${mailId}/delete`).then(json<MailDeleteResult>),
};

export const noticeApi = {
  list: () => fetch("/api/v1/notices", { credentials: "include", headers: { Accept: "application/json" } }).then(json<NoticePage>),
  read: (noticeId: string) => post(`/api/v1/notices/${noticeId}/read`).then(json<NoticeReadResult>),
  remove: (noticeId: string) => post(`/api/v1/notices/${noticeId}/delete`).then(json<NoticeDeleteResult>),
};

const TYPE_LABELS: Record<string, string> = {
  MARKET_SETTLEMENT: "거래소 판매 정산",
  ADMIN_GIFT: "운영자 지급",
};

/** 메일 종류를 사람 말로. 모르는 종류가 와도 빈 줄을 남기지 않는다. */
export function mailTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? "보관함 지급";
}

/** 운영자가 붙인 제목이 있으면 그 제목이 우선이다. 없는 옛 우편만 종류로 부른다. */
export function mailTitle(mail: MailMessage): string {
  return mail.title?.trim() || mailTypeLabel(mail.type);
}

/**
 * 보낸 시각은 날짜만으로 부족하다. 같은 날 여러 통이 오면 순서를 읽을 수 없기 때문이다.
 * 대신 연도와 초는 생략한다 — 읽을 것만 늘어난다.
 */
export function mailDateLabel(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const minute = `${date.getHours()}`.padStart(2, "0") + ":" + `${date.getMinutes()}`.padStart(2, "0");
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${minute}`;
}

/** 보상 한 줄을 사람 말로. 보낼 때 굳혀 둔 이름이 있으면 그것을 쓴다. */
export function rewardLabel(reward: MailReward): string {
  const name = reward.displayName?.trim()
    || reward.itemId
    || reward.cosmeticId
    || (reward.gemLevel ? `${reward.gemLevel}단계 보석` : null)
    || (reward.kind === "COSMETIC_CHOICE" ? "싸피 후드집업 선택권" : null)
    || (reward.kind === "TICKET" ? "치장 뽑기권" : "보상");
  return `${name} ×${reward.quantity.toLocaleString()}`;
}
