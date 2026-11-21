import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { observeServerTime, serverNow } from "./serverClock";

const BROWSER_NOW = Date.UTC(2026, 8, 22, 3, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BROWSER_NOW);
});

afterEach(() => vi.useRealTimers());

/** 응답 한 건을 왕복 0ms 로 관측한다. 두 시계가 같다고 알려 오차를 지운다. */
function alignToBrowserClock() {
  observeServerTime(new Date(BROWSER_NOW).toISOString(), BROWSER_NOW, BROWSER_NOW);
}

it("브라우저 시계가 서버보다 앞서 있으면 지금을 서버 쪽으로 되돌린다", () => {
  observeServerTime(new Date(BROWSER_NOW - 30_000).toISOString(), BROWSER_NOW, BROWSER_NOW);

  expect(serverNow()).toBe(BROWSER_NOW - 30_000);
});

it("브라우저 시계가 뒤처져 있으면 지금을 앞당긴다", () => {
  observeServerTime(new Date(BROWSER_NOW + 45_000).toISOString(), BROWSER_NOW, BROWSER_NOW);

  expect(serverNow()).toBe(BROWSER_NOW + 45_000);
});

/* serverTime 은 서버가 응답을 만든 순간이라, 받은 시각과 견주면 돌아오는 구간만큼 어긋난다.
   왕복의 절반을 그 순간으로 보면 두 구간이 대칭인 한 오차가 남지 않는다. */
it("왕복 시간의 절반을 서버가 시각을 찍은 순간으로 본다", () => {
  observeServerTime(new Date(BROWSER_NOW - 100).toISOString(), BROWSER_NOW - 200, BROWSER_NOW);

  expect(serverNow()).toBe(BROWSER_NOW);
});

it("serverTime 이 없거나 읽히지 않으면 직전에 잰 오차를 유지한다", () => {
  observeServerTime(new Date(BROWSER_NOW - 5_000).toISOString(), BROWSER_NOW, BROWSER_NOW);

  observeServerTime(undefined, BROWSER_NOW, BROWSER_NOW);
  observeServerTime("한짝", BROWSER_NOW, BROWSER_NOW);

  expect(serverNow()).toBe(BROWSER_NOW - 5_000);
});

it("보정이 없으면 브라우저 시계를 그대로 쓴다", () => {
  alignToBrowserClock();

  expect(serverNow()).toBe(BROWSER_NOW);
});
