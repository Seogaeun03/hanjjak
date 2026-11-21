import { mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// Kept apart from vite.config.ts so that tsc never loads Vitest's types: they pull in happy-dom's
// declarations, which do not compile against the pinned @types/node.
export default mergeConfig(viteConfig, {
  test: {
    setupFiles: ["./src/test-setup.ts"],
    maxWorkers: 4,
    clearMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    fakeTimers: { shouldClearNativeTimers: true },
    // e2e 는 Playwright 가 실제 브라우저에서 돌린다. Vitest 가 집어가면 happy-dom 에서
    // 레이아웃 없이 돌아 의미 없이 실패한다.
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
  },
});
