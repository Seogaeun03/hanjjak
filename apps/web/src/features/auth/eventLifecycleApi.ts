export type EventLifecyclePhase = "DISABLED" | "PRE_START" | "RUNNING" | "DAILY_RESTRICTED" | "ENDED_NOTICE" | "POST_NOTICE";
export type EventLifecycleState = {
  serviceId: string;
  enabled: boolean;
  phase: EventLifecyclePhase;
  startsAt: string | null;
  endsAt: string | null;
  noticeEndsAt: string | null;
  dailyRestrictionEnabled: boolean;
  dailyRestrictionStartsAt: string | null;
  dailyRestrictionEndsAt: string | null;
  dailyRestrictionTimeZone: string;
  dailyRestrictionEndsOnNextDay: boolean;
  nextDailyRestrictionTransitionAt: string | null;
  version: number;
  serverTime: string;
  mainServerUrl: string;
  updatedAt: string | null;
  updatedByUsername: string | null;
};

type Envelope<T> = { data: T };

export async function fetchEventLifecycle(): Promise<EventLifecycleState> {
  const response = await fetch("/api/v1/event-lifecycle", { credentials: "include", headers: { Accept: "application/json" } });
  const body = await response.json() as Envelope<EventLifecycleState>;
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return body.data;
}
