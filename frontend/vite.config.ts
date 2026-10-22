// Tauri 形态（偏离基线，见 docs/memory/decisions.md「基线偏离」）：
// - 端口单一真相源是 ../backend/tauri.conf.json 的 build.devUrl（1420），strictPort（Tauri 只认这个端口）；
//   CLI `--port` 可覆盖（第二波 unit 的浏览器预览用 1421–1423）。
// - 没有 HTTP 后端，删掉了 /api 代理；前后端走 Tauri IPC。
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

function devPort(): number {
  const conf = JSON.parse(
    readFileSync(new URL("../backend/tauri.conf.json", import.meta.url), "utf8"),
  ) as { build?: { devUrl?: string } };
  const port = Number(new URL(conf.build?.devUrl ?? "http://localhost:1420").port);
  return Number.isFinite(port) && port > 0 ? port : 1420;
}

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: devPort(),
    strictPort: true,
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome120" : "safari16",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    include: ["src/**/*.test.ts?(x)"],
    environment: "happy-dom",
    setupFiles: ["src/test-setup.ts"],
  },
});
