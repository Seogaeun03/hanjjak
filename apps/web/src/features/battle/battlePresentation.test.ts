import { describe, expect, it } from "vitest";
import { battleFailureAnalysis, battleFallbackNotice, battleRetryPresentation, battleRetryProgressLabel, battleStageProgressLabel, checkpointComplete, experienceProgress, mergeRewardLines } from "./battlePresentation";

describe("battle presentation", () => {
  it("derives current-level experience from cumulative experience", () => {
    expect(experienceProgress(13, 80_284)).toEqual({ current: 2_284, required: 13_000, percent: 17.6 });
    expect(experienceProgress(500, 999_999_999)).toEqual({ current: 0, required: 0, percent: 100 });
  });

  it("accumulates confirmed reward quantities by item", () => {
    const first = [{ itemId: "POTATO_M1", requestedQuantity: 2, grantedQuantity: 2, discardedQuantity: 0 }];
    const second = [{ itemId: "POTATO_M1", requestedQuantity: 3, grantedQuantity: 1, discardedQuantity: 2, skippedQuantity: 1 }];
    expect(mergeRewardLines(first, second)).toEqual([{ itemId: "POTATO_M1", requestedQuantity: 5, grantedQuantity: 3, discardedQuantity: 2, skippedQuantity: 1 }]);
  });

  it("marks only reached monster checkpoints complete", () => {
    expect(checkpointComplete(14, 10)).toBe(true);
    expect(checkpointComplete(14, 15)).toBe(false);
  });

  it("presents the one-second revival wait only for failed cycles", () => {
    expect(battleRetryPresentation("PLAYER_DIED", 2_000)).toEqual({ failureReason: "플레이어 사망", secondsRemaining: 1 });
    expect(battleRetryPresentation("TIME_LIMIT", 2_000)).toEqual({ failureReason: "보스 제한시간 초과", secondsRemaining: 1 });
    expect(battleRetryPresentation(null, null)).toBeNull();
  });

  it("classifies boss-only and normal-stage failures", () => {
    const result = (failureCode: string | null, defeatedNormals: number) => ({ success: false, failureCode, remainingHp: 0, defeatedNormals, elapsedTicks: 30 });

    expect(battleFailureAnalysis(result("PLAYER_DIED", 0), true)).toEqual({
      title: "보스전에서 전투 불능",
      reason: "보스의 공격을 버티지 못해 HP가 0이 됐습니다.",
      recommendation: "갑옷·투구를 강화하고 보스 패턴 전에 전투를 끝낼 공격력도 함께 점검해 보세요.",
    });
    expect(battleFailureAnalysis(result("PLAYER_DIED", 0), false).title).toBe("일반 구간에서 전투 불능");
    expect(battleFailureAnalysis(result("PLAYER_DIED", 20), false).title).toBe("보스전에서 전투 불능");
    expect(battleFailureAnalysis(result("TIME_LIMIT", 0), true).title).toBe("보스 제한시간 초과");
    expect(battleFailureAnalysis(result("UNKNOWN", 0), true).title).toBe("전투를 완료하지 못함");
  });

  it("explains the fall back to the previous stage only when the stage actually changed", () => {
    expect(battleFallbackNotice("stage.04-10", "stage.04-09")).toBe("4-9에서 경험치를 모은 뒤 4-10 재도전");
    expect(battleFallbackNotice("stage.05-01", "stage.04-10")).toBe("4-10에서 경험치를 모은 뒤 5-1 재도전");
    expect(battleFallbackNotice("stage.01-01", "stage.01-01")).toBeNull();
    expect(battleFallbackNotice(null, "stage.01-01")).toBeNull();
    expect(battleFallbackNotice("stage.04-07", "stage.02-03")).toBeNull();
  });

  it("stays quiet when the next stage is not exactly one behind the stage just played", () => {
    expect(battleFallbackNotice("stage.01-05", "stage.01-06")).toBeNull();
    expect(battleFallbackNotice("stage.01-06", "stage.01-04")).toBeNull();
    expect(battleFallbackNotice("stage.04-10", "stage.05-01")).toBeNull();
    expect(battleFallbackNotice(undefined, "stage.03-04")).toBeNull();
    expect(battleFallbackNotice("", "stage.03-04")).toBeNull();
  });

  it("labels double-digit chapters and stages without dropping a digit", () => {
    expect(battleFallbackNotice("stage.10-01", "stage.09-10")).toBe("9-10에서 경험치를 모은 뒤 10-1 재도전");
    expect(battleFallbackNotice("stage.10-10", "stage.10-09")).toBe("10-9에서 경험치를 모은 뒤 10-10 재도전");
  });

  it("uses boss-specific progress and retry labels", () => {
    expect(battleStageProgressLabel(true, 0)).toBe("보스");
    expect(battleStageProgressLabel(false, 7)).toBe("7 / 20");
    expect(battleStageProgressLabel(undefined, 0)).toBeNull();
    expect(battleRetryProgressLabel(true)).toBe("보스 재도전");
    expect(battleRetryProgressLabel(false)).toBe("일반 몬스터 0/20 재시작");
    expect(battleRetryProgressLabel(undefined)).toBeNull();
  });
});
