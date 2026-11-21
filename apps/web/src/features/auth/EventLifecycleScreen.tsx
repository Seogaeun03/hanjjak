import { useEffect, useMemo, useState } from "react";
import type { EventLifecycleState } from "./eventLifecycleApi";
import { OfflineRewardPanel } from "../runtime/OfflineRewardPanel";
import "./EventLifecycleScreen.css";

function dateTime(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));
}

export function formatLifecycleCountdown(seconds: number): string {
  const remaining = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(remaining / 3_600);
  const minutes = Math.floor((remaining % 3_600) / 60);
  return `${hours}시간 ${minutes}분 ${remaining % 60}초`;
}

export function EventLifecycleScreen({ lifecycle, authenticated }: { lifecycle: EventLifecycleState; authenticated: boolean }) {
  const waiting = lifecycle.phase === "PRE_START";
  const restricted = lifecycle.phase === "DAILY_RESTRICTED";
  const startTime = lifecycle.dailyRestrictionStartsAt?.slice(0, 5);
  const endTime = lifecycle.dailyRestrictionEndsAt?.slice(0, 5);
  const countdownTarget = waiting ? lifecycle.startsAt : restricted ? lifecycle.nextDailyRestrictionTransitionAt : null;
  const serverOffset = useMemo(() => Date.parse(lifecycle.serverTime) - Date.now(), [lifecycle.serverTime]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!countdownTarget) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [countdownTarget, lifecycle.serverTime]);
  const remainingSeconds = countdownTarget ? (Date.parse(countdownTarget) - (now + serverOffset)) / 1_000 : null;
  const title = waiting ? <>한짝 이벤트 서버 준비 중</> : restricted ? <>오늘의 모험은<br />잠시 쉬어 갑니다</> : <>한짝 이벤트가 종료되었습니다</>;
  const detail = waiting
    ? lifecycle.startsAt ? `${dateTime(lifecycle.startsAt)}에 시작합니다.` : "관리자가 시작 시간을 준비하고 있습니다."
    : restricted
      ? `${startTime ?? "설정 시각"}부터 ${endTime ?? "설정 시각"}까지는 게임 접속·자동 전투·거래소 이용을 쉬어 갑니다. ${authenticated ? "오프라인 보상은 아래에서 받을 수 있습니다." : "기존 로그인 세션이 있으면 오프라인 보상만 받을 수 있습니다."}`
      : "이벤트 진행·재화·아이템은 본 서버로 이전되지 않습니다.";
  return <main className={`event-lifecycle-screen${restricted ? " daily-restricted" : ""}`}>
    <section className="event-lifecycle-card" aria-labelledby="event-lifecycle-title">
      <span className="event-lifecycle-eyebrow">HANJJAK EVENT</span>
      <h1 id="event-lifecycle-title">{title}</h1>
      <p>{detail}</p>
      {remainingSeconds !== null && <div className="event-lifecycle-countdown" role="timer" aria-label={`${waiting ? "서버 오픈" : "플레이 재개"}까지 ${formatLifecycleCountdown(remainingSeconds)}`}>
        <small>{waiting ? "서버 오픈까지" : "플레이 재개까지"}</small>
        <strong>{formatLifecycleCountdown(remainingSeconds)}</strong>
      </div>}
      {!waiting && !restricted && <a href={lifecycle.mainServerUrl}>한짝 본 서버로 이동</a>}
      {waiting && <button type="button" onClick={() => window.location.reload()}>상태 다시 확인</button>}
      {restricted && authenticated && <><small className="event-lifecycle-resume">제한 종료 뒤 게임 화면으로 자동 복귀합니다.</small><OfflineRewardPanel force /></>}
    </section>
  </main>;
}
