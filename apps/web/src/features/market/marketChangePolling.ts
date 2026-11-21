import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { marketApi, type MarketChangeState, type MarketUnreadStream } from "./api";

export const MARKET_CHANGE_POLL_INTERVAL = 3_000;

export type MarketChangeDiff = {
  stale: boolean;
  accountChanged: boolean;
  changedInstrumentIds: string[];
  changedStreams: MarketUnreadStream[];
};

function revisionMap(state: MarketChangeState): Map<string, number> {
  return new Map(state.instruments.map((instrument) => [instrument.instrumentId, instrument.marketRevision]));
}

function sequenceMap(state: MarketChangeState): Map<MarketUnreadStream, number> {
  return new Map(state.unread.map((entry) => [entry.stream, entry.latestSequence]));
}

export function diffMarketChangeState(previous: MarketChangeState, current: MarketChangeState): MarketChangeDiff {
  const beforeRevisions = revisionMap(previous);
  const afterRevisions = revisionMap(current);
  const beforeSequences = sequenceMap(previous);
  const afterSequences = sequenceMap(current);
  const instrumentIds = new Set([...beforeRevisions.keys(), ...afterRevisions.keys()]);
  const streams = new Set([...beforeSequences.keys(), ...afterSequences.keys()]);
  const changedInstrumentIds = [...instrumentIds].filter((id) => beforeRevisions.get(id) !== afterRevisions.get(id));
  const changedStreams = [...streams].filter((stream) => beforeSequences.get(stream) !== afterSequences.get(stream));
  const stale = current.accountStateVersion < previous.accountStateVersion
    || [...afterRevisions].some(([id, revision]) => revision < (beforeRevisions.get(id) ?? revision))
    || [...afterSequences].some(([stream, sequence]) => sequence < (beforeSequences.get(stream) ?? sequence));
  return { stale, accountChanged: current.accountStateVersion !== previous.accountStateVersion, changedInstrumentIds, changedStreams };
}

async function invalidate(client: QueryClient, queryKey: QueryKey): Promise<void> {
  await client.invalidateQueries({ queryKey });
}

/** 한 품목을 따라다니는 조회들. 값이 움직이면 이만큼이 같이 낡는다. */
function instrumentKeys(instrumentId: string): QueryKey[] {
  return [
    ["market-order-book", instrumentId],
    ["market-price-levels", instrumentId],
    ["market-order-quote", instrumentId],
    ["market-candles", instrumentId],
  ];
}

async function invalidateAll(client: QueryClient, keys: QueryKey[]): Promise<void> {
  const unique = new Map(keys.map((key) => [JSON.stringify(key), key]));
  await Promise.all([...unique.values()].map((key) => invalidate(client, key)));
}

/*
 * 내가 한 일이 실제로 무엇을 건드렸는지 적는다. 예전에는 무슨 일을 하든 거래소의 모든
 * 조회를 한꺼번에 낡은 것으로 표시했다. 감자 한 조각을 팔아도 보석·우편함·모든 품목의
 * 주문장이 따라 움직였고, 간단 목록이 펼쳐져 있으면 그 한 번이 서른 번 가까운 요청이 됐다.
 */
export type MarketActionEffect = {
  /** 지갑·재고·보석이 움직였다. */
  account?: boolean;
  /** 값이 움직인 품목. 그 품목의 주문장·가격대·견적만 낡는다. */
  instrumentIds?: string[];
  /** 내 주문 목록이 움직였다. */
  myOrders?: boolean;
  /** 체결 내역이 늘었다. */
  trades?: boolean;
  /** 받을 물품이 늘거나 줄었다. */
  deliveries?: boolean;
  /** 받을 쌀이 늘거나 줄었다. */
  settlements?: boolean;
};

/** 한 일이 낡게 만든 조회 열쇠. 순수 함수라 무엇이 다시 읽히는지 시험으로 못 박을 수 있다. */
export function marketActionKeys(effect: MarketActionEffect): QueryKey[] {
  const keys: QueryKey[] = [];
  if (effect.account) keys.push(["auth", "session"], ["inventory"], ["gems"]);
  const instrumentIds = effect.instrumentIds ?? [];
  if (instrumentIds.length > 0) keys.push(["market-instruments"]);
  for (const instrumentId of instrumentIds) keys.push(...instrumentKeys(instrumentId));
  if (effect.myOrders) keys.push(["market-orders"]);
  if (effect.trades) keys.push(["market-trades"]);
  if (effect.deliveries) keys.push(["market-deliveries"]);
  if (effect.settlements) keys.push(["market-mails"]);
  /* 요약의 숫자와 읽지 않음 표시는 내 것이 움직일 때만 낡는다. */
  if (effect.myOrders || effect.trades || effect.deliveries || effect.settlements) keys.push(["market-summary"]);
  const unique = new Map(keys.map((key) => [JSON.stringify(key), key]));
  return [...unique.values()];
}

export function refreshAfterMarketAction(client: QueryClient, effect: MarketActionEffect): Promise<void> {
  return invalidateAll(client, marketActionKeys(effect));
}

export async function refreshChangedMarketQueries(client: QueryClient, diff: MarketChangeDiff): Promise<void> {
  if (diff.stale) return;
  const keys: QueryKey[] = [];
  if (diff.accountChanged) keys.push(["auth", "session"], ["inventory"], ["gems"]);
  if (diff.changedInstrumentIds.length > 0) keys.push(["market-instruments"]);
  for (const instrumentId of diff.changedInstrumentIds) keys.push(...instrumentKeys(instrumentId));
  const changed = new Set(diff.changedStreams);
  if (changed.has("FILLS")) keys.push(["market-orders"], ["market-trades"], ["market-summary"]);
  if (changed.has("DELIVERIES")) keys.push(["market-deliveries"], ["market-summary"]);
  if (changed.has("SETTLEMENTS")) keys.push(["market-mails"], ["market-summary"]);
  if (changed.has("EXPIRATIONS")) keys.push(["market-orders"], ["market-deliveries"], ["market-summary"]);
  await invalidateAll(client, keys);
}

export function useMarketChangePolling(enabled: boolean): void {
  const client = useQueryClient();
  const previous = useRef<MarketChangeState | null>(null);
  const changes = useQuery({
    queryKey: ["market-change-state"],
    queryFn: marketApi.changeState,
    enabled,
    refetchInterval: enabled ? MARKET_CHANGE_POLL_INTERVAL : false,
    refetchIntervalInBackground: false,
    retry: false,
  });

  useEffect(() => {
    if (!changes.data) return;
    if (!previous.current) {
      previous.current = changes.data;
      return;
    }
    const diff = diffMarketChangeState(previous.current, changes.data);
    if (diff.stale) return;
    previous.current = changes.data;
    void refreshChangedMarketQueries(client, diff);
  }, [changes.data, client]);
}
