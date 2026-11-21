/**
 * 서버 시계와 브라우저 시계의 차이.
 *
 * 던전 보상 창은 서버가 찍은 `minimumCompleteAt` 부터 `completionWindowSeconds` 까지다.
 * 화면이 그 창을 `Date.now()` 로 재면, 브라우저 시계가 앞선 만큼 일찍 눌러
 * `GEM_DUNGEON_COMPLETE_TOO_EARLY` 로 거절당하고, 뒤처진 만큼 늦게 눌러 창이 닫힌 뒤
 * `EXPIRED` 가 된다. 둘 다 보상도 입장권도 그대로 날아간다. 그래서 응답마다 실려 오는
 * `serverTime` 으로 오차를 재 두고, 시간을 따지는 화면은 브라우저 시계 대신 이 값을 쓴다.
 */
let offsetMilliseconds = 0;

/**
 * 응답 한 건으로 오차를 다시 잰다.
 *
 * `serverTime` 은 서버가 응답을 만든 순간이라, 요청이 가는 구간과 응답이 오는 구간 사이
 * 어딘가다. 왕복의 중간을 그 순간으로 보면 두 구간이 대칭인 한 편향이 남지 않는다.
 * 실패 응답도 같은 봉투를 쓰므로, 거절당한 요청 하나로도 시계가 제자리를 찾는다.
 */
export function observeServerTime(serverTime: string | undefined, requestStartedAt: number, responseReceivedAt: number): void {
  if (!serverTime) return;
  const stampedAt = Date.parse(serverTime);
  if (Number.isNaN(stampedAt)) return;
  offsetMilliseconds = stampedAt - (requestStartedAt + responseReceivedAt) / 2;
}

/** 서버 시계로 환산한 지금. 아직 한 번도 재지 않았으면 브라우저 시계 그대로다. */
export function serverNow(): number {
  return Date.now() + offsetMilliseconds;
}
