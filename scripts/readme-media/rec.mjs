// Record one scene to vid/<name>.webm and print the trim offset (seconds of load to cut).
import { rename, readdir, mkdir } from "node:fs/promises";
import { chromium, WIN, PAD, FRAME_CSS } from "./pw.mjs";

export async function dismiss(page) {
  const b = page.getByRole("button", { name: /知道了|Got it/ });
  if (await b.count()) { await b.first().click(); await page.waitForTimeout(250); }
}

export async function scene(name, { dark = false, locale = "zh-CN", extraCss = "" } = {}, run) {
  const dir = `vid/${name}`; await (await import("node:fs/promises")).rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const size = { width: WIN.w + PAD * 2, height: WIN.h + PAD * 2 };
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme: dark ? "dark" : "light", locale, recordVideo: { dir, size } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const t0 = Date.now();
  await page.goto("http://localhost:1420/?now=2026-09-30T10:00");
  await page.addStyleTag({ content: FRAME_CSS + extraCss });
  await page.waitForSelector("text=/日历|Calendar/");
  await page.waitForTimeout(500);
  await dismiss(page);
  await page.mouse.move(size.width / 2, size.height - 20);
  await page.waitForTimeout(500);
  const t1 = Date.now();
  await run(page);
  await page.waitForTimeout(900);
  const t2 = Date.now();
  await ctx.close();
  await browser.close();
  const [f] = await readdir(dir);
  await rename(`${dir}/${f}`, `vid/${name}.webm`);
  const trim = Math.max(0, (t1 - t0) / 1000 - 0.45);
  const dur = (t2 - t1) / 1000 + 0.45;
  console.log(`${name}: trim=${trim.toFixed(2)} dur=${dur.toFixed(2)}`);
  return { trim, dur };
}

/** Smooth pointer drag in steps (works with @dnd-kit pointer sensors). */
export async function drag(page, from, to, { steps = 24, hold = 120, settle = 200 } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(hold);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps, e = 1 - Math.pow(1 - k, 2); // ease-out
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(settle);
  await page.mouse.up();
}

export async function center(loc) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("no box for " + loc);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}
