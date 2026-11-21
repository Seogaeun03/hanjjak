// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProfileScreen } from "./ProfileScreen";

afterEach(() => cleanup());

it("renders every profile section in the cozy pixel paper dialog", () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], {
    authenticated: true,
    account: {
      accountId: "account-1",
      characterId: "character-1",
      email: "player@example.com",
      nickname: "한짝용사",
      level: 24,
      experience: 294_720,
      rice: 15_820,
    },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProfileScreen open onClose={() => {}} />
    </QueryClientProvider>,
  );

  expect(html).toContain('<dialog class="profile-window profile-window--profile"');
  expect(html).toContain("마이페이지");
  expect(html).toContain('aria-current="page"');
  expect(html).toContain(">내 정보</button>");
  expect(html).toContain(">소셜</button>");
  expect(html).toContain(">설정</button>");
  expect(html).toContain("계정 정보");
  expect(html).toContain("캐릭터 상태");
  expect(html).not.toContain("닉네임 변경");
  expect(html).toContain('aria-label="닉네임 수정"');
  expect(html).toContain("비밀번호 변경");
  expect(html).toContain("현재 비밀번호");
  expect(html).toContain("새 비밀번호 확인");
  expect(html).toContain("변경 가능");
  expect(html).not.toContain("서버 연결 준비 중");
  expect(html).not.toContain("새 비밀번호는 8자 이상 입력하세요.");
  expect(html).toContain('autoComplete="current-password"');
  expect(html).toContain('autoComplete="new-password"');
  expect(html).toContain("식별 정보");
  expect(html).toContain("account-1");
  expect(html).toContain("character-1");
  expect(html).toContain("294,720");
  expect(html).toContain("15,820");
  expect(html).toContain("<details");
  expect(html).not.toContain("profile-identity");
  expect(html).not.toContain("주력 재료");
  expect(html).not.toContain("profile-tabs");
  client.clear();
});

it("renders verified SSAFY affiliation and multiple cohort history", () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], {
    authenticated: true,
    account: {
      accountId: "account-ssafy",
      characterId: "character-ssafy",
      email: "ssafy@example.com",
      nickname: "싸피용사",
      level: 15,
      experience: 15_000,
      rice: 100_000,
      ssafyAffiliation: {
        currentCohort: 15,
        cohortHistory: [14, 15],
        multipleCohorts: true,
        region: "DAEJEON",
        regionReason: "SINGLE_REGION",
        verificationStatus: "VERIFIED",
        lastAttemptedAt: "2026-09-20T00:00:00Z",
        lastVerifiedAt: "2026-09-20T00:00:00Z",
      },
    },
  });

  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProfileScreen open onClose={() => {}} />
    </QueryClientProvider>,
  );

  expect(html).toContain("SSAFY 기수");
  expect(html).toContain("15기 · 여러 기수 이력");
  expect(html).toContain("SSAFY 지역");
  expect(html).toContain("대전");
  expect(html).toContain("SSAFY GitLab 확인 완료");
  client.clear();
});

it("renders the social login tab between profile and settings", () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], {
    authenticated: true,
    account: {
      accountId: "account-1",
      characterId: "character-1",
      email: "player@example.com",
      nickname: "한짝용사",
      level: 24,
      experience: 294_720,
      rice: 15_820,
    },
  });
  client.setQueryData(["auth", "social-providers"], [
    { id: "google", displayName: "Google", enabled: true },
    { id: "kakao", displayName: "Kakao", enabled: true },
    { id: "naver", displayName: "Naver", enabled: true },
    { id: "gitlab", displayName: "SSAFY GitLab", enabled: true },
  ]);
  client.setQueryData(["auth", "social-connections"], { passwordEnabled: true, providers: [] });

  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProfileScreen open initialTab="social" onClose={() => {}} />
    </QueryClientProvider>,
  );

  expect(html).toContain('<h2 id="profile-title">소셜</h2>');
  expect(html.indexOf(">내 정보</button>")).toBeLessThan(html.indexOf(">소셜</button>"));
  expect(html.indexOf(">소셜</button>")).toBeLessThan(html.indexOf(">설정</button>"));
  expect(html).toContain("profile-tab-red");
  expect(html).toContain("profile-tab-blue is-active");
  expect(html).toContain("소셜 로그인 연결");
  expect(html).toContain("Google");
  expect(html).toContain("Kakao");
  expect(html).toContain("Naver");
  expect(html).toContain("SSAFY GitLab");
  client.clear();
});

it("renders browser and account settings inside the same paper dialog", () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], {
    authenticated: true,
    account: {
      accountId: "account-1",
      characterId: "character-1",
      email: "player@example.com",
      nickname: "한짝용사",
      level: 24,
      experience: 294_720,
      rice: 15_820,
    },
  });

  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProfileScreen open initialTab="settings" onClose={() => {}} />
    </QueryClientProvider>,
  );

  expect(html).toContain('<h2 id="profile-title">설정</h2>');
  expect(html).not.toContain("전체 소리");
  expect(html).not.toContain('aria-label="게임 볼륨"');
  expect(html).toContain("QA 신고하기");
  expect(html).toContain("로그아웃");
  expect(html).not.toContain("게임에서 재생되는 모든 소리를 켜거나 끕니다.");
  expect(html).not.toContain("소리와 화면 설정은 이 브라우저에 자동으로 저장됩니다.");
  expect(html).not.toContain("settings-scene");
  client.clear();
});

it("asks for the current rice cost before opening nickname editing", () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], {
    authenticated: true,
    account: {
      accountId: "account-1",
      characterId: "character-1",
      email: "player@example.com",
      nickname: "한짝용사",
      level: 24,
      experience: 294_720,
      rice: 800_000,
      nicknameChangeCost: 500_000,
    },
  });

  render(<QueryClientProvider client={client}><ProfileScreen open inline onClose={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "닉네임 수정" }));
  expect(screen.getByRole("dialog", { name: "닉네임 변경" }).textContent).toContain("닉네임 변경에 500,000쌀이 소모됩니다.");
  fireEvent.click(screen.getByRole("button", { name: "예" }));
  expect((screen.getByRole("textbox", { name: "새 닉네임" }) as HTMLInputElement).value).toBe("한짝용사");
  client.clear();
});

it("keeps nickname editing closed when rice is insufficient", () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], {
    authenticated: true,
    account: {
      accountId: "account-1",
      characterId: "character-1",
      email: "player@example.com",
      nickname: "한짝용사",
      level: 24,
      experience: 294_720,
      rice: 299_999,
      nicknameChangeCost: 300_000,
    },
  });

  render(<QueryClientProvider client={client}><ProfileScreen open inline onClose={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "닉네임 수정" }));
  expect(screen.getByText("보유 쌀이 부족합니다.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "예" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("textbox", { name: "새 닉네임" })).toBeNull();
  client.clear();
});

it("closes the nickname confirmation without editing when no is selected", () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], {
    authenticated: true,
    account: {
      accountId: "account-1",
      characterId: "character-1",
      email: "player@example.com",
      nickname: "한짝용사",
      level: 24,
      experience: 294_720,
      rice: 300_000,
      nicknameChangeCost: 300_000,
    },
  });

  render(<QueryClientProvider client={client}><ProfileScreen open inline onClose={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "닉네임 수정" }));
  fireEvent.click(screen.getByRole("button", { name: "아니오" }));
  expect(screen.queryByRole("dialog", { name: "닉네임 변경" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "새 닉네임" })).toBeNull();
  client.clear();
});
