import { useCallback, useEffect, useState } from "react";
import type { EventLifecycleState } from "@hanjjak/client-sdk";
import { createApiClient } from "@hanjjak/client-sdk";
import { adminErrorMessage } from "./presentation";

const api = createApiClient().admin;

function localInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function instant(value: string): string | null { return value ? new Date(value).toISOString() : null; }
function display(value: string | null): string { return value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value)) : "미설정"; }
function restrictionWindow(state: EventLifecycleState): string {
  if (!state.dailyRestrictionEnabled || !state.dailyRestrictionStartsAt || !state.dailyRestrictionEndsAt) return "사용 안 함";
  return `매일 ${state.dailyRestrictionStartsAt.slice(0, 5)}부터 ${state.dailyRestrictionEndsAt.slice(0, 5)}까지${state.dailyRestrictionEndsOnNextDay ? " (다음 날 종료)" : ""}`;
}

export function EventLifecycleView() {
  const [state, setState] = useState<EventLifecycleState | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [dailyRestrictionEnabled, setDailyRestrictionEnabled] = useState(false);
  const [dailyRestrictionStartsAt, setDailyRestrictionStartsAt] = useState("22:00");
  const [dailyRestrictionEndsAt, setDailyRestrictionEndsAt] = useState("08:00");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    setPending(true); setMessage(null);
    try {
      const next = await api.eventLifecycle();
      setState(next); setStartsAt(localInput(next.startsAt)); setEndsAt(localInput(next.endsAt));
      setDailyRestrictionEnabled(next.dailyRestrictionEnabled);
      setDailyRestrictionStartsAt(next.dailyRestrictionStartsAt?.slice(0, 5) || "22:00");
      setDailyRestrictionEndsAt(next.dailyRestrictionEndsAt?.slice(0, 5) || "08:00");
    } catch (error) { setMessage(adminErrorMessage(error)); } finally { setPending(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function save() {
    if (!state) return;
    setPending(true); setMessage(null);
    try {
      const result = await api.updateEventLifecycle(
        instant(startsAt), instant(endsAt), dailyRestrictionEnabled,
        dailyRestrictionEnabled ? dailyRestrictionStartsAt : null,
        dailyRestrictionEnabled ? dailyRestrictionEndsAt : null,
        state.version, reason,
      );
      setState(result.after); setStartsAt(localInput(result.after.startsAt)); setEndsAt(localInput(result.after.endsAt));
      setDailyRestrictionEnabled(result.after.dailyRestrictionEnabled);
      setDailyRestrictionStartsAt(result.after.dailyRestrictionStartsAt?.slice(0, 5) || "22:00");
      setDailyRestrictionEndsAt(result.after.dailyRestrictionEndsAt?.slice(0, 5) || "08:00");
      setReason("");
      setMessage(result.replayed ? "이전 요청 결과를 다시 확인했습니다." : "이벤트 운영 시간을 실시간으로 적용했습니다.");
    } catch (error) { setMessage(adminErrorMessage(error)); } finally { setPending(false); }
  }
  if (!state) return <section className="state"><p>{pending ? "이벤트 설정을 불러오는 중입니다." : message ?? "이벤트 설정을 불러오지 못했습니다."}</p><button className="secondary" onClick={() => void load()}>다시 시도</button></section>;
  return <div className="content">
    <section className="overview-head"><div><p>서버 UTC가 이벤트 수명주기를, KST가 매일의 사용자 이용 제한 시간을 판정합니다.</p><span>현재 서버 시각 {display(state.serverTime)}</span></div><button className="secondary" onClick={() => void load()} disabled={pending}>↻ 새로고침</button></section>
    {message && <div className="alert" role="status">{message}</div>}
    <article className="panel lifecycle-panel">
      <header className="panel-title"><div><h2>이벤트 수명주기</h2><p>{state.serviceId} · {state.phase} · version {state.version}</p></div></header>
      <div className="lifecycle-grid"><label>이벤트 시작 시각<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label>이벤트 종료 시각<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div>
      <dl className="detail-list"><div><dt>시작</dt><dd>{display(state.startsAt)}</dd></div><div><dt>종료</dt><dd>{display(state.endsAt)}</dd></div><div><dt>안내 종료</dt><dd>{display(state.noticeEndsAt)}</dd></div><div><dt>마지막 변경</dt><dd>{state.updatedByUsername ?? "없음"}</dd></div></dl>
      <section className="daily-restriction-settings" aria-labelledby="daily-restriction-title">
        <div><h3 id="daily-restriction-title">매일 사용자 이용 제한</h3><p>제한 중에는 게임 접속·자동 전투·거래소를 막고, 이미 확정된 오프라인 보상 조회와 수령만 허용합니다.</p></div>
        <label className="restriction-toggle"><input type="checkbox" checked={dailyRestrictionEnabled} onChange={(event) => setDailyRestrictionEnabled(event.target.checked)} /><span>이용 제한 사용</span></label>
        <div className="lifecycle-grid"><label>제한 시작 (KST)<input type="time" value={dailyRestrictionStartsAt} disabled={!dailyRestrictionEnabled} onChange={(event) => setDailyRestrictionStartsAt(event.target.value)} /></label><label>제한 종료 (KST)<input type="time" value={dailyRestrictionEndsAt} disabled={!dailyRestrictionEnabled} onChange={(event) => setDailyRestrictionEndsAt(event.target.value)} /></label></div>
        <p className="restriction-summary">현재 설정: {restrictionWindow({ ...state, dailyRestrictionEnabled, dailyRestrictionStartsAt: dailyRestrictionEnabled ? dailyRestrictionStartsAt : null, dailyRestrictionEndsAt: dailyRestrictionEnabled ? dailyRestrictionEndsAt : null, dailyRestrictionEndsOnNextDay: dailyRestrictionEnabled && dailyRestrictionStartsAt > dailyRestrictionEndsAt })}</p>
      </section>
      <label>운영 사유<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="변경 사유를 3자 이상 입력하세요." /></label>
      <p className="muted">저장 즉시 새 시간표가 적용됩니다. 현재가 제한 시간에 포함되면 진행 중인 게임·전투 세션이 종료되고 제한 시작까지의 오프라인 보상이 고정됩니다.</p>
      <button className="primary" type="button" disabled={pending || reason.trim().length < 3 || dailyRestrictionEnabled && (!dailyRestrictionStartsAt || !dailyRestrictionEndsAt || dailyRestrictionStartsAt === dailyRestrictionEndsAt)} onClick={() => void save()}>{pending ? "저장 중…" : "이벤트 운영 시간 저장"}</button>
    </article>
  </div>;
}
