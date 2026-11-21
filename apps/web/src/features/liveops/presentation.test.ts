import { describe, expect, it } from "vitest";
import { liveopsErrorMessage } from "./presentation";

describe("liveops presentation", () => {
  it("maps stable and unknown server error codes to non-empty Korean copy", () => {
    for (const code of [
      "AUTHENTICATION_REQUIRED",
      "LIVEOPS_EVENT_NOT_FOUND",
      "LIVEOPS_EVENT_HALTED",
      "INVALID_DRAW_COUNT",
      "INSUFFICIENT_EVENT_TICKETS",
      "LIVEOPS_PRIZE_AWARD_CONFLICT",
      "UNKNOWN_SERVER_CODE",
    ]) {
      const message = liveopsErrorMessage(code);
      expect(message).not.toBe("");
      expect(message).toMatch(/[가-힣]/);
    }
  });

  it("gives specific guidance for the codes the draw endpoint actually throws", () => {
    expect(liveopsErrorMessage("LIVEOPS_EVENT_HALTED")).toContain("중단");
    expect(liveopsErrorMessage("INSUFFICIENT_EVENT_TICKETS")).toContain("티켓");
    expect(liveopsErrorMessage("INVALID_DRAW_COUNT")).toContain("횟수");
  });

  it("falls back to readable guidance for a code it does not recognize", () => {
    const message = liveopsErrorMessage("SOME_FUTURE_SERVER_CODE");
    expect(message).not.toBe("");
    expect(message).toMatch(/[가-힣]/);
  });
});
