import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cosmeticAssetVersion } from "./vite-plugins/cosmetic-asset-version.ts";
import { webpAssets } from "./vite-plugins/webp-assets.ts";

// `VITE_API_PROXY=https://hanjjak.verte.kr` 로 원격 서버에 붙일 수 있다. Cloudflare 가 Host 로 사이트를
// 고르므로 changeOrigin 이 필요하다. `vite preview` 는 server.proxy 를 그대로 쓴다.
const apiTarget = process.env.VITE_API_PROXY ?? "http://127.0.0.1:8080";
const apiOrigin = new URL(apiTarget).origin;

// game-api 의 ApiRequestGuardFilter 는 변경 요청의 Origin 이 요청 호스트와 같아야 받는다.
// 브라우저는 localhost Origin 을 보내므로 프록시를 지날 때 대상 서버 Origin 으로 바꾼다.
const rewriteOrigin = {
  changeOrigin: true,
  configure(proxy: { on(event: string, listener: (proxyReq: { getHeader(name: string): unknown; setHeader(name: string, value: string): void }) => void): void }) {
    const rewrite = (proxyReq: { getHeader(name: string): unknown; setHeader(name: string, value: string): void }) => {
      if (proxyReq.getHeader("origin")) proxyReq.setHeader("origin", apiOrigin);
    };
    proxy.on("proxyReq", rewrite);
    proxy.on("proxyReqWs", rewrite);
  },
};

export default defineConfig({
  plugins: [react(), cosmeticAssetVersion(), webpAssets()],
  server: {
    proxy: {
      "/api": { target: apiTarget, ...rewriteOrigin },
      "/ws": { target: apiTarget, ws: true, ...rewriteOrigin },
      "/admin": process.env.VITE_ADMIN_PROXY ?? "http://127.0.0.1:5174",
    },
  },
});
