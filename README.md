# WeekPage Classic

用全局快捷键呼出的悬浮窗口，把**日历、待办、收件箱和任务看板**放在一起。数据只在本机（SQLite），不注册、不联网同步。macOS + Windows，Tauri 2（Rust）+ React。

[English](#english)

> **维护模式**：这是 WeekPage 1.0，2026-10-11 冻结，2026-10-22 以 MIT 开源。只修 bug，不加功能。想要多设备同步，看作者在做的新版 [weekpage.app](https://weekpage.app)（不共用代码和数据格式）。

## 能做什么

- **日历**：2 / 3 / 4 周网格，上下滑动翻周；双击直接输入，时间自动识别（「下午3点开会」）；条目可以拖到别的日子；中国大陆的法定节假日、调休和节气。
- **待办与收件箱**：随手记一笔，之后再定日期、变成任务，或删掉。
- **任务看板**：卡片带时间条和关键点（我来做 / 等别人 / 检查点）；关键点过了日期没勾就标红，菜单栏图标出红点。
- **系统集成**：全局快捷键（macOS ⌃⌥Space，Windows Ctrl+Alt+Space）、失焦隐藏（可钉住）、菜单栏 / 托盘、开机自启、到点通知、白天 / 黑夜主题、中英双语，所有操作都能撤销。

## 下载

- **macOS 13+**（Apple 芯片和 Intel 通用）：到 [Releases](https://github.com/heyleeon/weekpage-classic/releases/latest) 下载 `WeekPage_<版本>_universal.dmg`，已签名并经 Apple 公证，打开后把 WeekPage 拖进「应用程序」。
- **Windows**：还没有安装包，请按下面的步骤从源码构建。

## 隐私

数据库、设置和备份都在本机。App 唯一的联网请求：每周最多一次，从 jsDelivr 拉一份节假日数据（`chinese-days.json`），失败就用打包时自带的那份，不带任何个人数据。CSP 只放行这一个域名（`backend/tauri.conf.json`）。

## 从源码构建

### 准备

- Node 24 + pnpm 10
- Rust：rustup（仓库根 `rust-toolchain.toml` 固定 1.97.1 + rustfmt + clippy，第一次 cargo 会自动装）
- macOS：Xcode Command Line Tools；Windows：WebView2（Win11 自带）+ MSVC Build Tools
- **Windows 上 clone 之前**：打开「开发者模式」，并执行 `git config --global core.symlinks true`——`.claude/` 里是指向 `.agents/` 的软链接，没开就会变成普通文本文件（`bash scripts/sync-agent-config.sh --heal` 可以修复）。

```bash
pnpm -C frontend install
```

### 跑起来

```bash
# 浏览器预览（内存假后端 + demo 数据，用来对稿 / 截图）
pnpm -C frontend dev
# → http://localhost:1420/?now=2026-09-30T10:00

# 真 App（开发身份「WeekPage Dev」），带演示数据和固定时钟
WEEKPAGE_SEED=demo WEEKPAGE_FAKE_NOW=2026-09-30T10:00 pnpm -C frontend tauri:dev
```

- 开发身份的快捷键是 **⌃⌥⇧Space**（Windows Ctrl+Alt+Shift+Space），按一次呼出、再按一次隐藏。
- `WEEKPAGE_SEED=demo`：空库启动时写入演示数据；`WEEKPAGE_FAKE_NOW=YYYY-MM-DDTHH:MM`：假时钟（从这一刻继续走）。
- `WEEKPAGE_DATA_DIR` / `WEEKPAGE_LOG_DIR`：换数据 / 日志目录，试东西时用 `$(mktemp -d)` 不弄脏仓库里的 `data/`。
- 以上开关都只在 debug 构建生效，完整列表见 [`.env.template`](.env.template)。debug 构建的数据默认在仓库根 `data/`，日志在 `logs/`（都不入库）。

### 命令

| 命令 | 作用 |
|---|---|
| `bash scripts/check.sh` | 全部检查（提交前必跑）：镜像 → CJK → 边界 → biome → tsc → vitest → fmt → clippy → cargo test |
| `bash scripts/check.sh fe` / `be` | 只跑前端 / 后端那半 |
| `bash scripts/check.sh win` | 在 macOS 上交叉检查 Windows 目标能否编译（需 `rustup target add x86_64-pc-windows-gnu` + `brew install mingw-w64`，没有就 SKIP） |
| `bash scripts/gen-contracts.sh` | 改了 Rust 类型 / 命令 / seed 后，重新生成 `frontend/src/types/bindings.ts` 与 demo 快照 |
| `pnpm -C frontend tauri:build:debug` | debug 包：`backend/target/debug/bundle/macos/WeekPage Dev.app` |
| `pnpm -C frontend tauri:release` | 正式包（正式身份，ad-hoc 签名）：`backend/target/release/bundle/macos/WeekPage.app` + `dmg/` |
| `bash scripts/release.sh --publishable` | 发版用的 DMG：universal、Developer ID 签名、公证（凭据的写法见脚本开头） |
| `WEEKPAGE_DEBUG_SMOKE=1 WEEKPAGE_DATA_DIR=$(mktemp -d) backend/target/debug/weekpage` | 冒烟：显示 → 隐藏 → 显示 → 发一条通知 → 退出码 0 |

### 开发身份与正式身份

| | 开发（默认） | 正式 |
|---|---|---|
| 配置 | `backend/tauri.conf.json` | 叠加 `backend/tauri.release.conf.json` |
| identifier / 名字 | `app.weekpage.dev` / WeekPage Dev | `app.weekpage` / WeekPage |
| 默认快捷键 | macOS ⌃⌥⇧Space · Windows Ctrl+Alt+Shift+Space | macOS ⌃⌥Space · Windows Ctrl+Alt+Space |
| 开机自启 | 永不 | 首次启动默认开 |
| 数据 | 仓库 `data/` `logs/` | 系统应用数据 / 日志目录 |

除了 `tauri:release`，任何构建（`tauri dev`、`tauri build --debug`、`cargo test`）都是开发身份，不会和装好的正式版抢单实例或快捷键。

**要发布自己的改版**：先把两份配置里的 `identifier` 换成你自己的（比如 `com.example.myweek`），名字和图标也换掉（见下面「许可证」）。不换的话，你的包和官方的 WeekPage 会共用同一个数据目录，互相覆盖数据。

### 装到 macOS

```bash
pnpm -C frontend tauri:release
osascript -e 'quit app id "app.weekpage"' 2>/dev/null   # 已装的旧版先退出
rm -rf "/Applications/WeekPage.app"
ditto "backend/target/release/bundle/macos/WeekPage.app" "/Applications/WeekPage.app"
open "/Applications/WeekPage.app"
```

- ad-hoc 签名、未公证：本机构建的包能直接打开；从别的机器拷来的要先 `xattr -dr com.apple.quarantine "/Applications/WeekPage.app"`。
- 首次启动会注册开机自启（`~/Library/LaunchAgents/WeekPage.plist`，系统设置 → 登录项里能看到），第一次到点提醒时请求通知权限。
- 数据在 `~/Library/Application Support/app.weekpage/`：`task-desk.db`（改名前的文件名，没改；设置也在这个库里）+ 每天一份备份 `backups/task-desk-YYYYMMDD.db`；日志在 `~/Library/Logs/app.weekpage/`。
- Spotlight 搜「WeekPage」打开；已经在运行时只会把原窗口叫出来。

### 快捷键冲突（⌃⌥Space）

macOS 默认把 ⌃⌥Space 给了「选择输入法菜单中的下一个输入法」。WeekPage 启动时会读系统快捷键表，冲突时在首启提示条和设置面板里提示怎么处理。两种处理：

1. 系统设置 → 键盘 → 键盘快捷键 → 输入法，关掉「选择输入法菜单中的下一个输入法」；
2. 或者在 WeekPage 设置（⌘,）里录一个别的快捷键。

### Windows 现状

Windows 版只经过 CI 验证：每次推送都会在 Windows 上编译并打出 NSIS 安装包，真机上还没跑过。真机验收的清单见 [`docs/roadmap.md`](docs/roadmap.md)；在 macOS 上可以用 `bash scripts/check.sh win` 做交叉编译检查。

## 目录

```
frontend/   React 界面（lib/ 纯函数、hooks/ 状态、components/ 界面、design/ 令牌）
backend/    Tauri / Rust（commands、db 写路径、shell 窗口与系统集成、platform 平台差异）
docs/       架构、界面规格、没做完的切片、长期记忆
scripts/    质量门与生成脚本
```

设计文档：[`docs/architecture.md`](docs/architecture.md) · [`docs/ui-spec.md`](docs/ui-spec.md) · [`docs/roadmap.md`](docs/roadmap.md)。用 AI 编程助手改代码时，它会读 [`.agents/AGENTS.md`](.agents/AGENTS.md)（`.claude/CLAUDE.md` 是它的软链接）。

## 参与

- **Bug**：欢迎提 issue 或 PR。PR 提交前跑一遍 `bash scripts/check.sh`，全绿再提。
- **新功能**：本仓不收，请别花时间写。

## 许可证

代码按 [MIT](LICENSE) 授权。**WeekPage 这个名字和 `backend/icons/` 里的图标不在授权范围内**，见 [TRADEMARKS.md](TRADEMARKS.md)。

---

## English

**WeekPage Classic** is a floating window you summon with a global shortcut. It puts a calendar, todos, an inbox and a task board in one place. Your data stays on your computer (SQLite). There is no account and no cloud sync. It runs on macOS and Windows and is built with Tauri 2 (Rust) and React.

> **Maintenance mode.** This is WeekPage 1.0, frozen on 2026-10-11 and open-sourced under MIT on 2026-10-22. It gets bug fixes only. For multi-device sync, see the new version at [weekpage.app](https://weekpage.app). It shares no code or data format with this one.

- The UI is in Simplified Chinese and English. The calendar shows mainland China's public holidays and solar terms.
- **Privacy**: the only network request is a weekly download of holiday data from jsDelivr. If it fails, the app uses the copy bundled with it.
- **Download**: macOS 13+ (Apple silicon and Intel) — get `WeekPage_<version>_universal.dmg` from [Releases](https://github.com/heyleeon/weekpage-classic/releases/latest). It is signed and notarized by Apple. There is no Windows installer yet.
- **Build from source**: install Node 24, pnpm 10 and rustup, then run `pnpm -C frontend install` and `pnpm -C frontend tauri:dev`. The steps above in Chinese list all commands.
- **Forks**: change `identifier` in `backend/tauri.conf.json` and `backend/tauri.release.conf.json`, and use your own name and icon. If you keep the same identifier, your build and the official app share one data folder.
- **Contributing**: bug reports and bug-fix PRs are welcome. Run `bash scripts/check.sh` before you open a PR. New features are not accepted.
- **License**: the code is [MIT](LICENSE). The name "WeekPage" and the icons in `backend/icons/` are not covered. See [TRADEMARKS.md](TRADEMARKS.md).
