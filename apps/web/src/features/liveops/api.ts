export const LIVEOPS_EVENT_ID = "hunt-ticket-gacha-2026-09";

export type LiveopsOutcomeKind = "PRIZE" | "COSMETIC_TICKET" | "GEM_BOX" | "RICE";
export type LiveopsOutcome = { kind: LiveopsOutcomeKind; prizeId: string | null; displayName: string | null; millionths: number; probabilityDisplay: string; quantity: number | null; minQuantity: number | null; maxQuantity: number | null };
export type LiveopsPrize = { prizeId: string; displayName: string; total: number; claimed: number; remaining: number; alreadyWon: boolean };
export type LiveopsState = { eventId: string; displayName: string; startsAt: string; endsAt: string; open: boolean; halted: boolean; ticketBalance: number; grantedToday: number; dailyCap: number; secondsPerTicket: number; outcomes: LiveopsOutcome[]; prizes: LiveopsPrize[] };
export type LiveopsDrawLine = { kind: LiveopsOutcomeKind; prizeId: string | null; prizeDisplayName: string | null; quantity: number };
export type LiveopsDrawResult = { eventId: string; ticketCost: number; riceGained: number; cosmeticTicketsGained: number; gemBoxesGained: number; ticketBalance: number; lines: LiveopsDrawLine[] };

type Envelope<T> = { data: T };
type ErrorEnvelope = { code?: string; messageKey?: string };

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as Envelope<T> & ErrorEnvelope;
  if (!response.ok) throw Object.assign(new Error(body.code || body.messageKey || `HTTP ${response.status}`), body);
  return body.data;
}

function commandHeaders(): HeadersInit {
  return { Accept: "application/json", "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() };
}

export const liveopsApi = {
  state: (eventId: string = LIVEOPS_EVENT_ID) =>
    fetch(`/api/v1/liveops/${encodeURIComponent(eventId)}`, { credentials: "include", headers: { Accept: "application/json" } }).then(json<LiveopsState>),
  draw: (count: 1 | 10, eventId: string = LIVEOPS_EVENT_ID) =>
    fetch(`/api/v1/liveops/${encodeURIComponent(eventId)}/draws`, { method: "POST", credentials: "include", headers: commandHeaders(), body: JSON.stringify({ count }) }).then(json<LiveopsDrawResult>),
};
