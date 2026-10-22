# README 的图和 GIF 怎么生成

`docs/media/` 里的素材都从这里出，改了界面就重跑一遍。

| 文件 | 来源 | 命令 |
|---|---|---|
| `window-*.png` `tasks-*.png` `calendar-en.png` | 真 App（debug 包 + 演示数据），只截窗口 | `bash realshot.sh` |
| `*.gif` | 浏览器预览（`pnpm -C frontend dev`，演示时钟 2026-09-30 10:00）+ Playwright 录屏 | `node scenes.mjs` 然后按 `results.json` 里的 trim / dur 跑 `./togif.sh <name> <trim> <dur>` |
| `archive.png` `detail-dark.png` | 浏览器预览截图 | `node stills.mjs` |

第一次：`npm install && npx playwright install chromium`；GIF 编码用 [gifski](https://gif.ski)（`brew install gifski`，没有就退回 ffmpeg）。
场景脚本在 `scenes.mjs`（一个场景一段，`node scenes.mjs drag` 只录一个）；浮动窗口的外观（内边距、阴影）在 `pw.mjs`。
