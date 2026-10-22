import { scene, drag, center } from "./rec.mjs";
const want = new Set(process.argv.slice(2));
const all = !want.size;
const results = {};

const grid = (page) => page.locator("[data-testid=task-grid-scroll]");
const cell = (page, d) => page.locator(`[data-date="${d}"]`);
const calItem = (page, text) => page.locator("[data-kind]", { hasText: text }).first();

if (all || want.has("hero")) results.hero = await scene("hero", {}, async (page) => {
  await page.keyboard.press("Meta+2");
  await page.waitForTimeout(1000);
  await grid(page).getByText("交会议 PPT", { exact: true }).click();
  await page.waitForTimeout(2700);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await page.keyboard.press("Meta+1");
  await page.waitForTimeout(700);
});

if (all || want.has("quickadd")) results.quickadd = await scene("quickadd", {}, async (page) => {
  const c = await center(cell(page, "2026-10-15"));
  await page.mouse.dblclick(c.x, c.box.y + c.box.height * 0.55);
  await page.waitForTimeout(500);
  await page.keyboard.type("下午3点半 和 A 喝咖啡", { delay: 75 });
  await page.waitForTimeout(1100);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
});

if (all || want.has("drag")) results.drag = await scene("drag", {}, async (page) => {
  const from = await center(calItem(page, "牙医复查"));
  const to = await center(cell(page, "2026-10-13"));
  await drag(page, from, { x: to.x, y: to.box.y + 46 }, { steps: 30, hold: 150, settle: 300 });
  await page.waitForTimeout(1300);
  await page.getByRole("button", { name: /^撤销$/ }).click();
  await page.waitForTimeout(900);
});

if (all || want.has("weeks")) results.weeks = await scene("weeks", {}, async (page) => {
  const c = await center(cell(page, "2026-10-14"));
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(550); }
  await page.waitForTimeout(500);
  await page.keyboard.press("t");
  await page.waitForTimeout(900);
});

if (all || want.has("swipe")) results.swipe = await scene("swipe", {}, async (page) => {
  const c = await center(cell(page, "2026-10-14"));
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < 16; i++) { await page.mouse.wheel(18, 0); await page.waitForTimeout(16); }
  await page.waitForTimeout(1500);
  for (let i = 0; i < 16; i++) { await page.mouse.wheel(-18, 0); await page.waitForTimeout(16); }
  await page.waitForTimeout(1200);
});

if (all || want.has("steps")) results.steps = await scene("steps", {}, async (page) => {
  await page.keyboard.press("Meta+2");
  await page.waitForTimeout(900);
  await grid(page).getByText("交会议 PPT", { exact: true }).click();
  await page.waitForTimeout(2600);
  const row = await center(page.locator("[data-swipe-row]", { hasText: "做 10 页初稿" }).first());
  await drag(page, { x: row.box.x + 40, y: row.y }, { x: row.box.x + 170, y: row.y }, { steps: 18, hold: 80, settle: 120 });
  await page.waitForTimeout(1000);
  const row2 = await center(page.locator("[data-swipe-row]", { hasText: "找同事过一遍" }).first());
  await drag(page, { x: row2.box.x + row2.box.width - 60, y: row2.y }, { x: row2.box.x + row2.box.width - 230, y: row2.y }, { steps: 18, hold: 80, settle: 120 });
  await page.waitForTimeout(900);
  const del = page.getByRole("button", { name: /^删除$/ }).first();
  if (await del.count()) { await del.click(); await page.waitForTimeout(1100); }
});


if (all || want.has("inbox")) results.inbox = await scene("inbox", {}, async (page) => {
  await page.keyboard.press("Meta+2");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /^收件箱/ }).first().click();
  await page.waitForTimeout(600);
  const row = page.locator("[data-testid=inbox-list] > *").first();
  await row.hover();
  await page.waitForTimeout(600);
  const btn = row.getByRole("button", { name: /变任务/ });
  console.log("toTask buttons in row:", await btn.count());
  await btn.first().click({ force: true });
  await page.waitForTimeout(1300);
  await page.keyboard.press("Meta+Enter");
  await page.waitForTimeout(1800);
});

await (await import("node:fs/promises")).writeFile("results.json", JSON.stringify(results, null, 1)); console.log(JSON.stringify(results));
