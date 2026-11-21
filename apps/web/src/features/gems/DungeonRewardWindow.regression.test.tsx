// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GemsScreen } from "./GemsScreen";
import type { GemDungeonChallenge, GemDungeonToday, GemState } from "./api";
import { observeServerTime } from "../../shared/serverClock";

/*
 * 보상 창은 서버 시각으로만 열린다. 서버는 minimumCompleteAt 전에 들어온 확정을
 * GEM_DUNGEON_COMPLETE_TOO_EARLY 로 되돌리고, 그로부터 completionWindowSeconds 가 지나면
 * EXPIRED 로 닫아 버린다. 둘 다 보석함도 입장권도 건드리지 않고 끝난다. 그래서 화면이
 * 브라우저 시계로 그 창을 재거나 사람 손가락에 맡기면 클리어가 통째로 사라진다.
 */

let serverSkewMs = 0;
let completeCalls: string[] = [];
let todayCalls = 0;
let completeRejection: string | null = null;
let resolvedStatus: GemDungeonChallenge["status"] = "SUCCEEDED";

const serverTime = () => new Date(Date.now() + serverSkewMs).toISOString();
const serverNowValue = () => Date.now() + serverSkewMs;

function state(): GemState {
  return {
    unlocked: true, tickets: 2, secondsUntilNextTicket: 600, todayBoss: "BERSERK",
    gemBoxQuantity: 0, gems: [], presets: {}, lockedPresets: [], contentVersion: "test",
  };
}

function challenge(overrides: Partial<GemDungeonChallenge> = {}): GemDungeonChallenge {
  return {
    challengeId: "berserk-stage-2",
    boss: "BERSERK",
    stage: 2,
    status: "ACTIVE",
    minimumCompleteAt: new Date(serverNowValue() - 5_000).toISOString(),
    expiresAt: new Date(serverNowValue() + 10_000).toISOString(),
    rewardGemBoxes: 11,
    contentVersion: "gem-dungeon-v3-30stage-applied",
    battle: {
      success: true, failureCode: null, elapsedTicks: 40, remainingPlayerHp: 900, remainingBossHp: 0,
      events: [
        { sequence: 1, tick: 0, type: "BATTLE_START", skillId: null, amount: 0, playerHp: 900, bossHp: 10_487, critical: false },
        { sequence: 2, tick: 40, type: "VICTORY", skillId: null, amount: 0, playerHp: 900, bossHp: 0, critical: false },
      ],
    },
    ...overrides,
  };
}

function today(active: GemDungeonChallenge | null): GemDungeonToday {
  return {
    boss: "BERSERK", tickets: 2, secondsUntilNextTicket: 600,
    progress: [{ boss: "SURVIVAL", highestClearedStage: 0 }, { boss: "BERSERK", highestClearedStage: 1 }, { boss: "ARMORED", highestClearedStage: 0 }],
    nextChallengeStage: 2, sweepStage: 1, nextChallengeRewardGemBoxes: 11, sweepRewardGemBoxesPerTicket: 3,
    activeChallenge: active, testBossSelectionEnabled: false, rankings: {},
  };
}

function mount(active: GemDungeonChallenge | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(["gems"], state());
  client.setQueryData(["gem-dungeons", "today", undefined], today(active));
  client.setQueryData(["skills"], { activeLoadout: [] });
  client.setQueryData(["cosmetic-collection"], { contentVersion: "t", states: [], equipment: {}, color: null, uniqueRegisteredCount: 0, setStars: {}, setEffects: {}, totalEffects: [] });
  client.setQueryData(["cosmetic-catalog"], { contentVersion: "t", cosmetics: [], sets: [] });
  render(<QueryClientProvider client={client}><GemsScreen mode="dungeon" /></QueryClientProvider>);
  return client;
}

beforeEach(() => {
  serverSkewMs = 0;
  completeCalls = [];
  todayCalls = 0;
  completeRejection = null;
  resolvedStatus = "SUCCEEDED";
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-00000000d005" });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "POST" && url.endsWith("/complete")) {
      completeCalls.push(url);
      if (completeRejection) return { ok: false, status: 422, json: async () => ({ serverTime: serverTime(), code: completeRejection }) };
      return { ok: true, json: async () => ({ serverTime: serverTime(), data: { challenge: challenge({ status: resolvedStatus }), state: { ...state(), gemBoxQuantity: 11, tickets: 1 } } }) };
    }
    if (method === "GET" && url.startsWith("/api/v1/gem-dungeons/today")) {
      todayCalls += 1;
      return { ok: true, json: async () => ({ serverTime: serverTime(), data: today(null) }) };
    }
    throw new Error(`unexpected ${method} ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("승리한 도전은 사람이 누르기를 기다리지 않고 바로 확정한다", async () => {
  observeServerTime(serverTime(), Date.now(), Date.now());
  mount(challenge());

  await waitFor(() => expect(screen.getByText("보석함 11개를 받았습니다")).toBeTruthy());
  expect(completeCalls).toHaveLength(1);

  // 확정했다고 결과 화면을 걷어 가면, 무엇을 받았는지 볼 틈이 없다.
  expect(document.querySelector(".battle-verdict.victory")).toBeTruthy();
  expect(screen.getByRole("button", { name: "다음 도전" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "나가기" })).toBeTruthy();
  // 이미 끝난 도전에는 확정도 포기도 남아 있으면 안 된다.
  expect(screen.queryByRole("button", { name: "결과 확정" })).toBeNull();
  expect(screen.queryByRole("button", { name: "도전 포기" })).toBeNull();
});

it("확정을 마친 결과 화면에서 나가면 서버를 다시 부르지 않고 선택 화면으로 돌아간다", async () => {
  observeServerTime(serverTime(), Date.now(), Date.now());
  mount(challenge());
  await waitFor(() => expect(screen.getByText("보석함 11개를 받았습니다")).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: "나가기" }));

  await waitFor(() => expect(screen.getByText("던전 랭킹")).toBeTruthy());
  expect(completeCalls).toHaveLength(1);
});

/* 이 회귀가 실제 신고였다. 브라우저 시계가 앞서 있으면 화면은 전투가 끝났다고 보지만
   서버는 아직 창을 열지 않았다. 그대로 확정을 보내면 422 로 되돌아오고, 유저에게는
   "눌러도 아무 일도 안 일어난다"로 보인다. */
it("브라우저 시계가 서버보다 앞서 있어도 창이 열리기 전에는 확정하지 않는다", async () => {
  serverSkewMs = -30_000;
  observeServerTime(serverTime(), Date.now(), Date.now());
  mount(challenge({
    minimumCompleteAt: new Date(serverNowValue() + 2_000).toISOString(),
    expiresAt: new Date(serverNowValue() + 17_000).toISOString(),
  }));

  await waitFor(() => expect(screen.getByLabelText("보스 체력")).toBeTruthy());

  expect(document.querySelector(".battle-verdict")).toBeNull();
  expect(screen.queryByRole("button", { name: "결과 확정" })).toBeNull();
  expect(completeCalls).toHaveLength(0);
});

/* 확정이 막히면 화면이 말을 해야 한다. 아무 말도 없으면 유저에게는 "눌러도 무반응"이고,
   보상이 사라진 줄도 모른 채 다음 도전으로 넘어간다. */
it("확정이 거절당하면 이유를 말하고 다시 누를 길을 남긴다", async () => {
  completeRejection = "INVENTORY_CAPACITY_EXCEEDED";
  observeServerTime(serverTime(), Date.now(), Date.now());
  mount(challenge());

  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

  expect(screen.getByRole("alert").textContent).toBe("가방이 가득 차 보석함을 받지 못했습니다. 자리를 비우고 다시 시도하세요.");
  expect(screen.getByRole("button", { name: "결과 확정" })).toBeTruthy();
  expect(completeCalls).toHaveLength(1);
});

/* 탭을 닫아 둔 사이 창이 닫히면 서버는 EXPIRED 로 돌려준다. 전투는 이겼지만 보상은 없다.
   여기서 "받았습니다"라고 하면 화면이 없는 보석함을 준 셈이 된다. */
it("창이 닫힌 뒤 확정되면 받지 못했다고 말한다", async () => {
  const expired = challenge({
    minimumCompleteAt: new Date(serverNowValue() - 40_000).toISOString(),
    expiresAt: new Date(serverNowValue() - 25_000).toISOString(),
  });
  resolvedStatus = "EXPIRED";
  observeServerTime(serverTime(), Date.now(), Date.now());
  mount(expired);

  await waitFor(() => expect(document.querySelector(".battle-verdict")).toBeTruthy());

  expect(screen.queryByText("보석함 11개를 받았습니다")).toBeNull();
  expect(screen.getByText("보상 시간이 지나 이번 클리어는 기록되지 않았습니다")).toBeTruthy();
});
