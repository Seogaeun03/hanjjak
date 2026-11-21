import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: { port: 5174, proxy: {
    "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:8080",
    "/cosmetics": process.env.VITE_WEB_ASSET_PROXY ?? "http://127.0.0.1:5173",
    "/assets/characters": process.env.VITE_WEB_ASSET_PROXY ?? "http://127.0.0.1:5173",
    "/assets/cosmetics": process.env.VITE_WEB_ASSET_PROXY ?? "http://127.0.0.1:5173",
  } },
});
