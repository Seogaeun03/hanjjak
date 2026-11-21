import { defineConfig, devices } from "@playwright/test";

/*
 * 자리 계산은 브라우저만 한다. happy-dom 은 레이아웃을 돌리지 않아 vitest 로는 칸이
 * 서로 덮는지 잴 수 없고, 그래서 HUD 겹침 버그가 두 번 연속으로 눈으로만 잡혔다.
 * 이 설정은 그 검사만을 위한 것이다. 전투 미리보기는 로그인도 API 도 타지 않으므로
 * 개발 서버 하나면 충분하다.
 */
const PORT = Number(process.env.LAYOUT_TEST_PORT ?? 5180);

export default defineConfig({
  testDir: "./e2e",
  /* 자리 검사는 서로 다른 뷰포트를 오가므로 한 페이지를 공유하면 안 된다. */
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["json", { outputFile: "e2e-results.json" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    /* 실패한 자리를 눈으로 확인할 수 있어야 고칠 수 있다. */
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/battle-hud-preview.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
