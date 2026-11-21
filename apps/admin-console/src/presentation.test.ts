import { describe, expect, it } from "vitest";
import { ApiError } from "@hanjjak/client-sdk";
import { adminAuthErrorFromHash, adminErrorMessage, defaultEconomyRange } from "./presentation";

describe("admin presentation", () => {
  it("maps permission failures without exposing server details", () => {
    expect(adminErrorMessage(new ApiError(403, "ADMIN_PERMISSION_DENIED", false))).toBe("이 화면을 조회할 권한이 없습니다.");
    expect(adminErrorMessage(new ApiError(400, "INVALID_CHAT_TITLE_COLOR", false))).toBe("칭호 색상은 #RRGGBB 형식으로 입력해 주세요.");
    expect(adminErrorMessage(new ApiError(500, "INTERNAL_SECRET_DETAIL", false))).toBe("요청을 처리하지 못했습니다. (INTERNAL_SECRET_DETAIL)");
  });
  it("maps local login failures without revealing credentials or server details", () => {
    expect(adminErrorMessage(new ApiError(401, "ADMIN_LOCAL_LOGIN_FAILED", false))).toBe("ID 또는 비밀번호를 확인해 주세요.");
    expect(adminErrorMessage(new ApiError(429, "ADMIN_RATE_LIMITED", true))).toBe("로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("maps OAuth callback fragments without exposing provider details", () => {
    expect(adminAuthErrorFromHash("#admin-auth-error=ADMIN_GITLAB_ACCESS_DENIED")).toBe("허용된 GitLab 계정이 아닙니다.");
    expect(adminAuthErrorFromHash("#other=value")).toBe("");
  });

  it("starts economy lookup at a seven day inclusive range", () => {
    expect(defaultEconomyRange(new Date("2026-09-09T12:00:00Z"))).toEqual({ from: "2026-09-03", to: "2026-09-09" });
  });
});
