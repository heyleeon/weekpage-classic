import { open } from "./pw.mjs";
async function dismiss(page) {
  const b = page.getByRole("button", { name: /知道了|Got it/ });
  if (await b.count()) { await b.first().click(); await page.waitForTimeout(300); }
}
// Chinese, light: tasks page, detail, settings
{
  const { browser, page } = await open({ dark: false });
  await dismiss(page);
  await page.keyboard.press("Meta+2");
  await page.waitForTimeout(700);
  await page.screenshot({ path: "s-tasks-light.png" });
  await page.locator("[data-testid=task-grid-scroll]").getByText("交会议 PPT", { exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "s-detail-light.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.keyboard.press("Meta+,");
  await page.waitForTimeout(600);
  await page.screenshot({ path: "s-settings-light.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // archive page
  const arch = page.getByRole("button", { name: /归档/ });
  console.log("archive buttons:", await arch.count());
  if (await arch.count()) { await arch.first().click(); await page.waitForTimeout(600); await page.screenshot({ path: "s-archive-light.png" }); }
  await browser.close();
}
// Dark tasks
{
  const { browser, page } = await open({ dark: true });
  await dismiss(page);
  await page.keyboard.press("Meta+2");
  await page.waitForTimeout(700);
  await page.screenshot({ path: "s-tasks-dark.png" });
  await page.locator("[data-testid=task-grid-scroll]").getByText("交会议 PPT", { exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "s-detail-dark.png" });
  await browser.close();
}
// English calendar
{
  const { browser, page } = await open({ dark: false, locale: "en-US" });
  await dismiss(page);
  await page.screenshot({ path: "s-cal-en.png" });
  await browser.close();
}
console.log("done");
