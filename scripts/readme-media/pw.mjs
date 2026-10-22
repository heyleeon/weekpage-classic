// Shared harness: Playwright from ./node_modules (see README.md in this folder).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const { chromium } = require("playwright");
export const BASE = "http://localhost:1420/?now=2026-09-30T10:00";
export const WIN = { w: 1280, h: 860 };
export const PAD = 56;

/** Floating-window look: pad #root so the rounded frame sits on the wallpaper with a shadow. */
export const FRAME_CSS = `
  #root { padding: ${PAD}px; box-sizing: border-box; }
  #root > div { height: 100% !important; box-shadow: 0 24px 70px rgba(0,0,0,.28), 0 2px 10px rgba(0,0,0,.12); }
  * { caret-color: auto; }
`;

export async function open({ dark = false, locale = "zh-CN", scale = 1, headless = true, video = null, extraCss = "" } = {}) {
  const browser = await chromium.launch({ headless, channel: "chromium" });
  const ctx = await browser.newContext({
    viewport: { width: WIN.w + PAD * 2, height: WIN.h + PAD * 2 },
    deviceScaleFactor: scale,
    colorScheme: dark ? "dark" : "light",
    locale,
    ...(video ? { recordVideo: { dir: video, size: { width: WIN.w + PAD * 2, height: WIN.h + PAD * 2 } } } : {}),
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.addStyleTag({ content: FRAME_CSS + extraCss });
  await page.waitForSelector("text=/日历|Calendar/", { timeout: 15000 });
  await page.waitForTimeout(600);
  return { browser, ctx, page };
}
