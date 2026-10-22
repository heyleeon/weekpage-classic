# 技术决策记录

本文件追加记录本项目的重大技术决策。新决策追加到文件末尾；历史条目不修改；如某决策被推翻，新建条目并引用被推翻的条目（例如 "Supersedes 2026-01-15 06:30:45 +00:00 的条目"）。所有条目标题必须带 24 小时制时分秒与时区（UTC），详见「时间戳规范」章节。

---

## 2026-10-01 06:03:53 +00:00: 技术栈与仓库形状（M0 落地 architecture §0 / ADR-01…13）

**背景**：任务台要常驻、悬浮、全局快捷键、到点提醒、两端（Mac + Windows），界面是日历格 / 拖动 / 浮层，以后要能多端同步。
**选项**：Electron 44；Wails v3；Flutter / Avalonia；原生两套 UI；Tauri 2。
**选择**：Tauri 2.12（`~2.12`）。Rust = 唯一写路径 + 平台能力（rusqlite 0.40 bundled + rusqlite_migration 2.6，单连接 `Mutex<Connection>`，撤销日志、任务历史、分数索引排序键、提醒调度）；TS = 读侧派生 + 输入解析 + 界面（React 19.3 + Vite 8.3 + TypeScript 7.0.2 + CSS Modules + 三层 token + zustand 5 + dnd-kit + phosphor + chinese-days；Biome 2.5 + vitest 5）。类型由 tauri-specta `=2.0.0-rc.25` 从 Rust 生成 `frontend/src/types/bindings.ts`。仓库根 `frontend/` + `backend/`（= Tauri 的 src-tauri，单 crate `task-desk`）+ `docs/` + `scripts/`。
**代价**：WKWebView / WebView2 两套引擎都要测；Windows 那一半没有实战（R11）；tauri-specta 仍是 RC，用 `=` 锁死。

---

## 2026-10-01 06:03:53 +00:00: debug / release 数据目录与开发 / 正式身份

**背景**：开发版和每天在用的正式版若共用数据、identifier，会弄坏真实数据、抢单实例与全局快捷键、撞自启 LaunchAgent。
**选项**：给每条开发命令加 `--config dev`；或反过来让默认配置就是开发身份。
**选择**：`backend/tauri.conf.json` 本身是**开发身份**（`app.taskdesk.dev` / 任务台 Dev）；只有 `pnpm -C frontend tauri:release` 叠加 `tauri.release.conf.json`（`app.taskdesk` / 任务台）。运行时 `is_dev = identifier.ends_with(".dev")` 决定默认快捷键（⌥⇧Space / Ctrl+Alt+Shift+Space）与自启（永不开）。debug 构建数据落仓库根 `data/`、日志 `logs/`（`TASK_DESK_DATA_DIR` / `TASK_DESK_LOG_DIR` 可覆盖，仅 debug）；release 落 `app_data_dir()` / `app_log_dir()`。唯一计算点 `backend/src/paths.rs`。
**代价**：发布必须记得用 `tauri:release`；正式身份只在 M3 安装版上验证。

---

## 2026-10-01 06:03:53 +00:00: 并行开发用 git worktree + 固定合并顺序

**背景**：M0 之后 6 个 unit 要并行开发，同目录开发会互相拖累 check.sh、没有合并顺序。
**选择**：M0 提交并打 tag `m0`；每个 unit 一个 worktree（`code/worktrees/uN`）+ 分支 `unit/UN`，各自 `pnpm install --frozen-lockfile`、各自 `backend/target/`、各自跑 check.sh、各自提交，只改自己名下路径（所有权表见 AGENTS.md / plan §3.5）；第二波从 `m0` 开分支并先合入 `unit/U2`、`unit/U3`；集成按 U2→U3→U1→U4→U5→U6 合并到 main，每合一个跑一次 check.sh。共享契约（命令签名、lib 函数签名、视图类型、store、挂载点、令牌）在 M0 定死，unit 发现不够用写进报告由集成处理。
**代价**：契约一旦定错，修正要等集成；每个 worktree 都要完整编译一次 Rust。

---

## 2026-10-01 06:03:53 +00:00: 基线偏离（architecture §20，待回流 project-template）

**背景**：基线 project-template @ b9cd035 面向 Web + HTTP 后端；本项目是本地桌面工具。
**选择**（11 条有理由的偏离）：
1. 主键 UUIDv7 文本，不用自增 id + 业务键（多端同步外键不用翻译，ADR-04）。
2. React 19（基线 18）。
3. 不引 Tailwind，用 CSS Modules + 三层 token（视觉规范即 CSS 变量；并行开发类名隔离）。
4. 不用路由库（build-react §5 逃生口）。
5. 日志按「启动日期命名 + 5 MB 大小轮转保留 7 个」，不是严格按天（tauri-plugin-log 只支持大小轮转）。
6. `vite.config.ts`：`strictPort: true`、删 `/api` 代理、端口读 `backend/tauri.conf.json` 的 `devUrl`。
7. `data/` `logs/` 只在 debug 落仓库根，release 落系统目录。
8. 不变量 ③ `/api/health`、④ `/api/v1` 不适用（没有 HTTP 服务，走 IPC）。
9. 检查入口是 `scripts/check.sh` 不是 `make check`（两套工具链，Windows 上不一定有 make）。
10. 仓库角色词 `desktop` 不在 spine §1.2 词表（mynah 已在用，需先加进词表）。
11. 记忆维护协议注入 `.agents/AGENTS.md`，不建根 `CLAUDE.md`、不归档外部 PRD（需求文档在仓库外且只读）。
**代价**：回流前，基线与本仓不一致处要靠这条记录解释。

---

## 2026-10-01 06:03:53 +00:00: 待拍板 D1–D9 先按默认值实现

**背景**：plan §8 列了 9 个需要用户拍板的问题，流程不能等。
**选择**（默认值）：D1 带日期的「等别人」关键点上日历；D2 失焦自动隐藏（可关 = 钉住）；D3 macOS 不要 Dock 图标（LSUIElement + Accessory），Windows 不进任务栏；D4 macOS 保留 ⌥Space（首启提示试按）、Windows Ctrl+Alt+Space；D5 日历条目 v1 只能当天内排序；D6 UUIDv7 文本主键；D7 v1 不做日程详情（结束时间存库、地点写标题）；D8 M3 建私有 GitHub 仓跑 Windows CI；D9 M3 把正式版装进 /Applications。
**代价**：用户改主意时按 plan §8「改了会动哪里」调整。

---

## 2026-10-01 06:03:53 +00:00: M0 落地时与脚手架任务书不同的几处

**背景**：M0 按任务书搭骨架，实测中有几处必须调整。
**选择**：
1. `backend/Cargo.toml` 的 `rust-version` 写 1.95 而不是 1.90：`rusqlite_migration 2.6.0` 要求 Rust 1.95；写 1.90 时 Cargo 的 MSRV 感知解析会把其余依赖锁到「兼容 1.90」的旧版本（toml 0.8.2 等），manifest 也在说谎。工具链仍固定 1.97.1。
2. `SettingsPatch` 带 `skip_serializing_if` 时，tauri-specta rc.25 必须用 serde 分相导出：`bindings.ts` 里会出现 `SettingsPatch_Serialize` / `SettingsPatch_Deserialize`（字段完全相同）和联合类型 `SettingsPatch`；`disable_serde_phases()` 会直接报错，不可用。前端一律用 `SettingsPatch`。
3. tauri-specta 用 `ErrorHandlingMode::Throw`（命令失败直接 reject，`lib/api.ts` 归一成 `ApiError`），并 `dangerously_cast_bigints_to_number()`（i64 毫秒时间戳在 2^53 内）。
4. 日志插件在 `setup` 里用 `app.handle().plugin(...)` 注册（路径要等 `paths::resolve(app)` 算出来），不在 Builder 上注册。
5. `platform::vibrancy_available()` 的 M0 桩返回 false（`apply_window_effects` 还是空操作，真 App 先用实色外圈）；U1 实现材质后改回 macOS / Win11 true。浏览器预览的 mock 返回 true（模拟壁纸透过透明外圈）。
6. 边界检查比任务书略严：`@tauri-apps/*` 任何包都只许在 `lib/api.ts`（任务书只点名 `@tauri-apps/api/core`）；`target_os` 任意写法（`cfg(`、`cfg!(`）都只许在 `platform/`。注释行不计。
7. `tauri-plugin-autostart` 的 `macos_launcher()` 只在 macOS 存在，调用它会让 Windows 编不过（`check.sh win` 抓到的）；改用默认值（就是 LaunchAgent）。
8. `.claude/launch.json` 不入库（浏览器预览工具要求它在会话 cwd，且各 worktree 端口不同）。
**代价**：第 2 条让 TS 侧多两个同构类型名；第 6 条以后若有前端插件确实要直接调用，需先改边界规则。

---

## 2026-10-01 06:32:26 +00:00: 用户拍板 D2 / D4 / D8 / D9

**背景**：plan §8 的待拍板项，用户在 M0 完成后答复了其中四项；其余（D1、D3、D5、D6、D7）沿用默认值。
**选择**：
- D2：失焦自动隐藏，设置里可关（= 钉住）——与默认一致。
- D4：默认快捷键两端统一为 `Control+Alt+Space`（macOS ⌃⌥Space / Windows Ctrl+Alt+Space）；开发身份 `Control+Alt+Shift+Space`。改了 `db::settings::defaults`、`Settings::fixture` 与 demo fixture。
- D8：同意建 GitHub 仓并在 windows-latest 上跑 CI。
- D9：同意把正式版（ad-hoc 签名）装进 /Applications 当日用版，并在安装版上验 Spotlight / 单实例 / 自启 / 通知 / 快捷键。
**代价**：macOS 上 ⌃⌥Space 是系统「选择输入法菜单中的下一个输入法」（`com.apple.symbolichotkeys` 第 61 项），用户本机该项**已启用**。Carbon 注册不会报错，但按键可能被系统先吃掉。U1 需读取 symbolichotkeys 检测冲突并在首启提示 / 设置面板里说明怎么关（系统设置 → 键盘 → 键盘快捷键 → 输入法）。

---

## 2026-10-01 08:30:01 +00:00: M3 集成时做的决定（与 brief 不同之处、退路）

**背景**：六个 unit 按 U2→U3→U1→U4→U5→U6 `--no-ff` 合入 main，每合一个跑 check.sh；之后处理各 unit 报告的「需要集成处理」，再做一轮视觉 / 交互修复（`94c7fc1`）。
**选择**：
1. `update_settings` 在设置生效**之后重新读库**再返回：快捷键注册失败回滚时，前端拿到的是回滚后的值，而不是请求里的新值。
2. 不加单独的「设置已变化」事件：**窗口每次呼出时在后台刷新一次快照**（`useShellEvents`），托盘切开机自启这类隐藏期间的变化靠它同步。architecture §8.2 / §8.4 已同步。
3. ⌘N 浮层与鼠标点「+ 新任务」用**同一个锚点**（按钮上的 `data-new-task-button`）；任务卡「归档」复用 `taskActions.requestArchive`，只留一份实现。
4. `TaskGrid` 除了 ResizeObserver，**每次快照变化后在 layout effect 里同步量一次列高**：只靠 ResizeObserver 时连续两次「变任务」会落进同一列。
5. 浮层测量阶段用 `opacity: 0` 而不是 `visibility: hidden`（后者让标题框拿不到焦点）；所有锚定弹层设最大高度、内容变大时重新定位、按纸的范围夹位置。
6. 动画结束一律用**定时器**而不是 `animationend`：窗口隐藏时动画不会跑完。
7. 主窗口 `maximizable: false`（工具栏双击不再最大化）。
8. **真 App 自测的退路**：「任务台」是 LSUIElement 菜单栏应用，computer-use 拿不到它，§22 演示脚本改在浏览器预览（`window.__td`）里走，真后端写路径靠 `cargo test`；真 App 只验快捷键 / 失焦 / 渲染（日志 + `screencapture -l`）。想加的 debug-only「往目录放 js 就在 webview 里执行」开关被权限分类器以 RCE 面拒绝，**不做**；完整真 App 演示列入人工验证。
9. 两条 unit 建议**没做**：U3 把共享工具挪进 `db/repo.rs`、U2 的 `dayLabel` 跨天主动重渲染（记进 plan §1 的 M3 遗留）。
**代价**：真 App 上的详情页编辑类操作（改名、改日期、删关键点等）只有 Rust 测试覆盖，界面路径等用户人工走一遍。

---

## 2026-10-01 08:30:01 +00:00: Windows CI 与正式版安装（D8 / D9 落地）

**背景**：用户 2026-09-30 同意 D8（GitHub 仓 + Windows CI）与 D9（正式版装进 /Applications）。
**选择**：
- 远程 `origin`，只推 `main`（`unit/*` 已合并删除，不推）。
- `.github/workflows/check.yml`：push main / PR / 手动触发；`concurrency.group = check-${{ github.event_name }}-${{ github.ref }}`；macos-latest（45 min）跑 `scripts/check.sh`，windows-latest（60 min）跑 `scripts/check.sh be` + `pnpm -C frontend tauri build --debug --bundles nsis`。工具链用 `rustup toolchain install`（读 `rust-toolchain.toml`），pnpm 10.28.2、Node 24。不发布产物、不用任何 secret。
- Windows job 在 checkout **之前** `git config --global core.symlinks true`（`.claude/` → `.agents/` 软链接，check.sh 第 1 步要验）；设 `PYTHONUTF8=1`；`check.sh` 在 `python3` 不可用时退回 `python`。
- 首跑 windows job 在 `cargo test` 失败（测试进程 `STATUS_ENTRYPOINT_NOT_FOUND`）：`build.rs` 改为自己给所有产物嵌 Common Controls v6 清单（`backend/windows-app-manifest.xml`，仅 MSVC），`455dc7e`；之后两个 job 都绿（run 36837827857，Windows 产出 `任务台 Dev_0.1.0_x64-setup.exe`）。
- 正式版 `tauri:release`（ad-hoc 签名）用 `ditto` 装到 `/Applications/任务台.app`，不公证；验证结果写 `docs/spikes.md`「M3 安装版验证」。
- 安装版上的提醒测试**不往日用数据库写测试数据**：退出安装版，用临时 `HOME` 启动同一个二进制（数据、LaunchAgent 都落临时目录），测完删掉再正常启动。
**代价**：ad-hoc 签名的包 `spctl` 判 rejected，换机器要先去 quarantine；Windows 只有 CI 编译 + 打包门禁，真机行为仍待 M4。

---

## 2026-10-01 08:30:01 +00:00: D1–D9 当前实现位置

**背景**：plan §8 的待拍板项在 M3 结束时的状态，方便以后改主意时定位。
**选择**：
- D1（默认）带日期的「等别人」关键点上日历：`frontend/src/lib/calendar.ts`。
- D2（用户选定）失焦自动隐藏、设置里可钉住：`backend/src/db/settings.rs` 默认值 + `backend/src/shell/window.rs` 失焦处理 + 设置面板 `frontend/src/components/settings/`。
- D3（默认）macOS 无 Dock 图标：`backend/Info.plist` 的 `LSUIElement` + `ActivationPolicy::Accessory`（`platform/`）；Windows `skipTaskbar`（`tauri.conf.json`）。
- D4（用户选定）默认 `Control+Alt+Space`、开发身份 `Control+Alt+Shift+Space`：`db::settings::defaults`；冲突检测读 symbolichotkeys 61，在首启提示条与设置面板提示。安装版实测检测到 `input-source-next` 并显示提示。
- D5（默认）日历条目只能当天内排序：日历拖动（`components/calendar/`）只写 `calendar_day_orders`。
- D6（默认）UUIDv7 文本主键：`migrations/0001-init` + `db::new_id`。
- D7（默认）不做日程详情，地点写在标题里、结束时间存库：`model.rs` 的 `EventInput` 没有 `location`（`Event` 与 DDL 已留列）。
- D8（用户同意）：见上一条，CI 已建。
- D9（用户同意）：见上一条，已安装。
**代价**：无。

---

## 2026-10-01 11:04:52 +00:00: 日历条目可以拖到别的日子（用户推翻 D5）

Supersedes 2026-10-01 06:03:53 +00:00「待拍板 D1–D9 先按默认值实现」里的 D5（日历条目 v1 只能当天内排序），以及 ui-spec §23.1 #9 的旧裁决。

**背景**：用户反馈日历条目「无法拖动调整位置」——300ms 长按不容易发现，而且只能在同一格里排序。
**选项**：保持 D5 只改触发方式；或支持跨天，每种条目改对应的日期字段。
**选择**：
- 去掉长按，`PointerSensor` `{ distance: 4 }`；整张网格一个 `DndContext`，落点由 `useCalDrag` 在裁剪后的可视区里做 DOM 命中测试（行在滑动、翻周时也对），不用 droppable。
- 跨天写哪条命令由纯函数 `lib/calendar.ts` `planCalMove` 决定：日程 `update_event`、提醒 `update_todo`、关键点 `update_key_point`、开始 / 截止 `set_task_dates`；开始不能晚于截止、截止不能早于开始（相等可以），已归档任务的标记不可拖。被拒的落点不显示占位块，松手回原位并弹提示型 Toast（新增 `ToastSpec.tone = "notice"`）。
- 一个 `mutate` 里依次发「移动」和目标日的 `set_day_order`，Toast 带两个 opId，一次撤销倒序退回（Rust `journal::undo` 本来就按倒序回放多个 op）。先 `patchLocal` 乐观更新，写失败 `refresh()`。
- 拖着条目停在网格上下边缘 24px 内 400ms 翻一周、之后每 600ms 一周；格子能滚时先滚格子。
- 拖关键点时，文字里指向原日期的日期片段一起改（`retargetDateText`，「等审批 · 10/1 查」→「10/5 查」），否则卡片和日历对不上。**这一条是实现时加的，未经用户确认**；不要就删 `planCalMove` 里那一行。
- 浏览器预览的 mock 加 `setTaskDates`、`updateKeyPoint`（共 21 个写操作）。
**代价**：没有新命令，复用已有写命令；真鼠标 / 触控板手感只在合成事件和 Chromium 里验过，WKWebView 真机待人工验证。

---

## 2026-10-01 11:04:52 +00:00: 工具栏翻周改成网格上下滑动，周数 / 第一行进设置

**背景**：用户要求去掉工具栏的「‹ 今天 ›」「2周｜3周｜4周」两个胶囊，放回设置界面，并且可以设置默认第一行显示哪周；喜欢上下滚动的翻周手感。V3 §2 / ui-spec §23.2 C1 原来采用的是 V3 的工具栏。
**选择**：
- 翻周 = 日历网格本身上下滑动：滚轮一格一周；触控板跟手、停 120ms 吸附整周；按住空白处拖动（4px 起）松手吸附、快甩多一周；↑ ← / ↓ → 一周、T 回家；任何换周都 200ms ease-out 滑过去（减少动态时直接跳）。实现：`components/calendar/useWeekScroll.ts` + 纯函数 `weekScroll.ts`，网格多渲染上下各一周缓冲行，位移直接写 transform（每帧不走 React），换周只改 store 的 `calendarAnchor`，所以连按会累加。
- 「家」= `lib/dates.ts` `homeAnchor(today, calendarFirstRow)`：新设置 `calendarFirstRow: "thisWeek" | "lastWeek"`（默认 thisWeek，只落库）。呼出窗口、T、改设置时回家；跨天时只有原本在家的视图跟着走。
- 工具栏：日历页只在离开家时显示「回到今天」（箭头指向今天：↑ 今天在更早的周，↓ 在更晚的周），加常驻齿轮按钮打开设置；显示几周、第一行进设置面板「日历」一节。`CalendarToolbarExtras` 删除。
- 设置字段在 Rust（`model.rs`）是唯一真相源；`db::settings::get` 改成按字段兜底：旧 JSON 缺字段用默认值，不认识的值只重置那一个字段。
**代价**：滚轮 / 触控板的区分靠启发式（像素 ≥ 50 或行模式算一格；≤ 3 个事件的小手势也翻一周，照顾 WebKit 把慢速滚轮一格报成约 4px），WKWebView 真机鼠标与触控板待人工验证；列表能滚时手势先给列表。

---

## 2026-10-01 11:04:52 +00:00: 界面国际化用 i18next + react-i18next（基线偏离，回流候选）

**背景**：用户要求中英双语，设置里可选语言。基线 project-template `frontend/README.md` §5：「需要多语言时用 context-based 字符串表，UI 文案不硬编码」。
**选项**：自写 context 字符串表；i18next + react-i18next；Lingui / FormatJS（要编译步骤或 ICU 消息语法）。
**选择**：i18next 26.4.2 + react-i18next 17.0.15（精确版本），资源内联、同步初始化，一个 namespace，按界面分区拆文件（`frontend/src/i18n/locales/{zh-CN,en}/<分区>.ts`）。zh-CN 是源语言，en 分区用 `Messages<typeof zh>` 定型，`CustomTypeOptions` 让 `t()` 的键名过 tsc；`i18n.test.ts` 守键集合一致、复数成对、无空串。设置 `language: "system" | "zh-CN" | "en"`（默认 system）；跟随系统 = 首选语言列表里第一个 zh* / en*，都没有 → en，空 → zh-CN，前端 `resolveLang` 与 Rust `i18n::resolve` 同一规则。切换时 `<Paper key={lang}>` 整棵重挂载。Rust 自己显示的托盘菜单、提醒通知、快捷键被占用通知走新模块 `backend/src/i18n.rs`（`sys-locale` 0.3 读系统语言），`Info.plist` 加 `CFBundleLocalizations` [zh-Hans, en]。
**为什么偏离基线**：大量 `lib/` 纯函数（时间条、Toast、归档统计、节假日标签）要出文字，context 拿不到，只能层层传参；还需要复数、带组件的富文本（`<Trans>`）和编译期键检查——自写就是重造 i18next。
**回流候选**：建议 build-react §5 改成「需要多语言时用 i18next + react-i18next：源语言一份对象、其他语言 `Messages<typeof 源>` 定型、`CustomTypeOptions` 检查键；非 React 代码 `import { t }`」。
**代价**：多两个运行时依赖；`<html lang>`、`document.title` 跟着切换，但 Tauri 原生窗口标题仍是 tauri.conf.json 里的中文（窗口无边框，只在 Windows 任务切换等处可见）；关键点自动判型（ui-spec §19）只认中文关键词。

---

## 2026-10-01 12:07:13 +00:00: 关键点手势：滑动完成 / 删除，没日期的拖动排序，带日期的按日期排

**背景**：用户要求关键点（step）能「向左拖出红色删除键、向右拖标记完成、点小圆圈完成」，没有日期的关键点能手动拖动排上下顺序；同时反馈任务卡关键点列表两指横扫时底部出现灰色横框、从卡片点关键点进详情时蓝色高亮画坏了。
**选项**：所有关键点都能自由拖（日期列可能乱序）；或带日期的按日期自动排、只有没日期的能拖。滑动只做鼠标拖；或鼠标 + 触控板两指。
**选择**：
- 共用组件 `components/ui/SwipeRow`：鼠标横拖或触控板两指横扫（横向 wheel，停 120ms 算松手），6px 定方向；右滑过阈值勾上 / 取消勾，左滑停出红色「删除」按钮（点才删，Toast 可撤销）。详情时间线和任务卡关键点行都用；卡片行加 `data-no-drag`，不再能从关键点行拖起整张卡。
- 排序只在详情：没日期、没完成的关键点可拖（`StepSensor`：竖向 > 6px 起拖，横向先过 6px 就放弃，让给滑动）；带日期的关键点和记一笔不能拖，已完成的也不能拖。
- 带日期的关键点保持日期顺序：Rust `key_points::date_slot` 在新增和改日期时把放错位置的行挪到「第一个更晚的带日期关键点」前（没有就放「最后一个带日期的」后）；位置合适不动、清日期不动；`move_key_point` 拒绝带日期的行（`invalid`）。浏览器预览 mock 同步实现 `moveKeyPoint` / `deleteKeyPoint` / 日期插入。
- 卡片横框：`ScrollFade` 的滚动区只纵向（`overflow-x: hidden`），关键点行的 -4px 外边距收在滚动区内。详情聚焦高亮改成行内 `--ev-soft` 淡出 + 滚到中间。
**代价**：带日期的关键点不能再手动拖到日期顺序之外；已有数据里乱序的带日期关键点只有改日期时才会被挪正。触控板手势的方向、停顿判定与真机 WKWebView 手感只在 Chromium 合成事件里验过，待人工验证。「设为当前」按钮保留未动（用户问了用途，待用户决定去留）。

---

## 2026-10-01 12:15:43 +00:00: 语言标签改用 zh-Hans、地区与语言分开、系统层文字本地化（基线回流）

**背景**：用户同意把多语言 / 主题做成跨项目标准并回流进 project-template（`modules/i18n.md`、`modules/theming.md`，本项目是来源）。讨论中定下：语言和地区是两回事；中文标签按文字分；App 名、安装器这些系统层文字也要翻译。
**选择**：
- 语言 id `zh-CN` → `zh-Hans`（前端 `Lang`、资源目录、设置值、`<html lang>`，Rust `Lang::ZhHans` / `Language::ZhHans`）。v0.1 存的 `"zh-CN"` 由 `db::settings::get` 读时升级（`upgrade_stored`），下次写入存新值；不用 serde `alias`——它会让 tauri-specta 把含 `Language` 的类型全拆成 `_Serialize` / `_Deserialize` 两份。
- 「跟随系统」按文字判中文：简体（zh / zh-CN / zh-SG / zh-Hans-*）→ zh-Hans；繁体（zh-TW / zh-HK / zh-MO / zh-Hant-*）没有文案，跳过，和 macOS 匹配 bundle 本地化时的结果一致（Supersedes 2026-10-01 11:04:52 +00:00 条目里「zh* 不分简繁」的规则）。
- 地区固定中国大陆：节假日与调休、周一起始、24 小时制不随界面语言变。真有海外用户时再加「地区」设置，不从语言推。
- 系统层文字：原生窗口标题跟语言（`settings_apply::apply_window_title`）；App 名用 `LSHasLocalizedDisplayName` + `macos/<lang>.lproj/InfoPlist.strings`，只由 release 配置打进包；Windows NSIS `languages` [English, SimpChinese]，自动选、不弹框。`productName` 保持「任务台」：改成 ASCII 会让已装的 `/Applications/任务台.app` 和登录项指向旧路径。
- 外观：`color-scheme` 跟令牌写在一起（`semantic.css` 白天 `light`，`dark.css` 两段黑夜 `dark`），原生控件随皮肤走。M0 删掉模板里写死的 `color-scheme: light` 是对的，缺的是按主题声明。
- 工程守卫：`scripts/check-ui-copy.py`（源语言是中文 → 代码里的中文就是漏抽的文案）挂进 `check.sh` 第 2 步；开发期伪本地化 `?pseudo` / `VITE_PSEUDO_LOCALE=1`（`i18n/pseudo.ts`）。
**代价**：繁体中文系统的用户现在看到英文界面（之前是简体）；要支持就加 zh-Hant 文案，不是改规则。Windows 开始菜单名不随语言变。

---

## 2026-10-01 13:25:45 +00:00: 当前关键点全自动，去掉「设为当前」；手势代替按钮和说明文字

Supersedes 2026-10-01 12:07:13 +00:00「关键点手势」条目里的「『设为当前』按钮保留未动（待用户决定去留）」，以及 ui-spec §9.3 的旧规则（`is_current` 存值、可以多个、手动设为 / 取消当前）。
**背景**：用户看到「设为当前」问用途后要求去掉；并要求「有了左右滑的机制」就把详情行的悬停按钮也去掉，能用动效、手势的地方不用图标和文字。
**选项**：当前继续存 `is_current`、只藏起按钮；或当前完全由顺序推导。手势说明写成常驻文字；或用一次性动画演示。
**选择**：
- 当前 = 已开始、未完成的任务里第一个未完成的非 note 关键点，最多一个（`lib/keyPoint.ts` `effectiveCurrentIds`）；不再读 `is_current`，前端不再调 `set_key_point_current`（Rust 命令和列暂留）。`current_since` 只在旧数据里当「等别人」天数起点；新数据从前一个关键点的完成日起算，任务直接标完成时原来的当前（第一个未完成的）照样算（`lib/taskMath.ts` `waitingDays`）。
- 详情行没有悬停按钮：日期列就是改日期的控件，删除 = 左滑或 Delete / ⌫；去掉 ⠿ 把手（抓手指针代替）、「随时可以加」「滚动查看更多」「· 可上下滚动」和底部手势说明；前两次打开详情时第一个未完成的关键点「探头」一次（每个详情只播一次，减少动态效果时不播）。
- 待办行、收件箱行也用 SwipeRow：待办去掉 Handle 和「按住 300ms 起拖」（停一下再横拖会被当成拖动）；收件箱「今天」= 右滑、「删掉」= 左滑，按钮只剩「定日期」「变任务」。
- 读屏：行内控件带 `aria-keyshortcuts`（Delete / ⌫；收件箱行另有 ↑↓ T D R）；打开浮层 / 弹层会合上开着的行（`closeOpenSwipeRow`），免得行的 Esc 层压过浮层。
**代价**：手势没有常驻提示，第三次以后打开详情只能靠记忆或抓手指针发现；旧数据里手动设的多个当前不再显示；`is_current` / `current_since` 成了只留不用的列，以后清理要写迁移。

---

## 2026-10-01 13:34:43 +00:00: 删除写命令 `set_key_point_current`（写命令 28 → 27）

**背景**：「当前」改成全自动（上一条），界面不再调用设为当前；用户确认删掉后端命令。
**选择**：删 `commands::set_key_point_current`、`db::key_points::set_current` 及其测试，重新生成 `bindings.ts`，去掉 `api.setKeyPointCurrent` 和 mock 的占位。**保留** DB 列 `is_current` / `current_since`（不做迁移，旧数据照读；`set_key_point_done` / `update_key_point` 仍会把 `is_current` 清成 0）和历史类型 `kp_current`（旧的历史记录照常显示）。
**代价**：列和历史类型成了只读的遗留字段；以后做同步时可以一起清理。

---

## 2026-10-01 15:44:43 +00:00: 产品改名 WeekPage（任务台 / task-desk → WeekPage），identifier 换成 `app.weekpage`

Supersedes 2026-10-01 12:15:43 +00:00 条目里「`productName` 保持『任务台』」那一句；2026-10-01 06:03:53 +00:00「debug / release 数据目录与开发 / 正式身份」条目里的 identifier、名字和 `TASK_DESK_*` 开关名（规则不变，只换名字）。
**背景**：用户决定整个项目改名 WeekPage，所有语言都叫 WeekPage（暂时没有中文名）。以后要上 App Store，bundle id 应该带真名；现在只有作者一台机器装着，换 identifier 的代价只是一次本地数据拷贝。
**选项**：只改显示名、保留 `app.taskdesk`；或连 identifier 一起换。内部名全改；或只改不会把已有数据晾在一边的。
**选择**：
- 名字：`productName` 正式 `WeekPage`、开发 `WeekPage Dev`；`mainBinaryName` `weekpage`；identifier 正式 `app.weekpage`、开发 `app.weekpage.dev`（对齐 `app.mynah`）；Cargo 包 / lib / bin 都叫 `weekpage`，前端包 `weekpage-frontend`。版本仍 0.2.0，没有功能改动。界面、托盘、通知、窗口标题、两份 `InfoPlist.strings` 都是 WeekPage（中文写「显示 WeekPage」「退出 WeekPage」，中英之间留空格）；本地化机制（`LSHasLocalizedDisplayName` + `macos/<lang>.lproj`）留着，以后有中文名只改文字。
- 内部名一起改：`TASK_DESK_*` → `WEEKPAGE_*`（`DATA_DIR` / `LOG_DIR` / `FAKE_NOW` / `SEED` / `DEBUG_SMOKE` / `OSASCRIPT_NOTIFY` / `NO_PANEL`，都只在 debug 生效）；日志文件 `weekpage-YYYYMMDD.log`；ObjC 类 `WeekPagePanel` / `WeekPageNotificationDelegate`；预览调试把手 `window.__wp`；NSIS 安装包名随 productName。托盘 / 菜单 id 和事件名本来就不带产品名；前端不用 localStorage，CI 不上传产物，这几类没有要改的。
- **故意不改**：数据库文件 `task-desk.db` 与每日备份 `backups/task-desk-YYYYMMDD.db`（`paths::DB_FILE`）。改了的话，把旧数据目录原样拷进 `app.weekpage/` 后 WeekPage 会新建空库、旧库被晾在旁边；备份前缀跟着库名，拷过来的旧备份才继续受「保留 7 份」管理。不写迁移代码。
- 历史记录（本文件旧条目、spikes 里的实测记录、旧 CI run 链接与产物名）保留当时的名字；spikes / plan / lessons 里会误导的地方加了改名注。
**代价 / 留给用户手动做的事**：已装的 `/Applications/任务台.app`（`app.taskdesk`）还没换，系统把 WeekPage 当成另一个 App。① 在旧版设置里关掉开机自启（删掉 `~/Library/LaunchAgents/任务台.plist`）并退出；② 在 WeekPage 第一次启动之前，把 `~/Library/Application Support/app.taskdesk/` 整个拷成 `~/Library/Application Support/app.weekpage/`（`task-desk.db` 及其 `-wal` / `-shm`、`backups/`；设置在库里的 `settings` 表）。`~/Library/WebKit/app.taskdesk/` 不用拷：前端不用 localStorage / IndexedDB，那里只有 WebKit 自己的数据；旧日志 `~/Library/Logs/app.taskdesk/` 可留可删。③ 删旧 App，装 `WeekPage.app`。④ 通知授权按 bundle id 记，第一次提醒时要重新允许；开机自启会以 `~/Library/LaunchAgents/WeekPage.plist` 重新注册。

---

## 2026-10-02 13:29:14 +00:00: 开始日可以选过去；左栏「今天」改「待办」，去掉提示行和「昨天顺延」标签

Supersedes ui-spec §23 #36（「今天」页签按图不改名）与 #39（变任务 / 新建时开始日不能选过去），以及需求说明 §2「显示『昨天顺延』标签」那一句。
**背景**：用户日用 0.2.0 时提出：① 新建任务的小日历点不了今天以前的日子，但「过了两三天才想起来前两天有个人忘了见」，开始日应该能往前选；灰色表示过去挺好，今天要用设计系统里别的颜色区分出来（默认开始 = 今天时，今天被绿底盖住看不出来）。② 左栏页签叫「今天」不对，它装的是所有没完成的待办；昨天建的待办今天都挂着「昨天顺延」，用户想自己手动管，不要这个标签；页签下的「上下拖动排序 · 越靠上越重要」也不要，整体要极简。
**选项**：过去的日子一律可点（截止也能落在过去，新建出来就逾期）；或只让开始落在过去。今天的标记：选中时换成 `--today` 实心；或保留描边叠在选中色外面。顺延：去掉标签；或连「没做完留到第二天」一起去掉。
**选择**：
- 开始可以过去、截止不能（与详情 §10.5 一致）：`rangePick.ts` `pastPickable` —— 只有「正在选截止、开始已在过去」这一种状态会让过去的一天变成截止，那时过去的日子变灰；其余状态点过去的一天都落在开始上。`MiniCalendar` 可点的过去日子用 `--text-muted`（不能点的仍是 `--text-disabled`）。
- 今天 = `--today` 描边，任何时候都在：被选中时描边留着，中间隔 1.5px 面板底色（`--elevated`）再填选中色。所有小日历（新建 / 详情 / 设提醒）同一条规则。
- 页签：zh「待办」/ en "To Do"（用户原话）；`leftTab` 内部 id 还是 `today`，没改存储。去掉 `tasks.panel.hint`，列表离页签 10（同收件箱输入框）。
- 去掉「昨天顺延 / 顺延 N 天」：`todoTag` 只出提醒标签，`TodoTag.kind` 与 `tasks.tag.carried*` 删除。没做完的待办照旧留在列表里，排序不变。
**代价**：一眼看不出哪条拖了好几天（`created_date` 还在库里，以后要「放太久提醒」可以再加）；没有提示文字后，拖动排序只能靠试或读屏说明发现。

---

## 2026-10-02 13:44:00 +00:00: 日历双击输入框的预览行只在会改动文字时显示

Supersedes ui-spec §2.6「预览行怎么显示」表格的旧规则（任何输入都显示一行预览）。
**背景**：用户双击已有日程「09:30 展会 · 国家会展中心 2 号馆」，框下面又出一行一模一样的「↳ 09:30 展会 · 国家会展中心 2 号馆」，是重复信息。用户给的规则：第一次输入「今天下午 3 点」这种不规范写法时提示会转成什么；内容本来就规范、双击打开时不提示；除非把原来的时间删了，再提示之后会怎么改。
**选择**：`inputPreview(raw, initial)` 返回 null 就不渲染预览行。显示的情况：保存会改写文字（打的字 ≠ `editText` 同款写法「HH:MM[-HH:MM] 标题」，未带时间时 ≠ 压缩空格后的标题）；只有时间没有标题（回车不保存，必须说）；编辑一条原来带时间的条目而现在识别不到时间（「不带时间 · 标题」）；新建时的空输入（「打字，时间会自动识别」，唯一说明时间能自动识别的地方）。编辑没改动、编辑中清空、新建时打规范写法都不显示。
**代价**：预览行出现 / 消失时框高变化 ≈17px，同一格里下面的条目跟着挪；改时间（10:00 → 11:00）这种规范写法不再有确认行，靠框里的字本身。

---

## 2026-10-02 14:07:22 +00:00: 详情关键点一行显示、行尾类型标签可改、日期列只放自己的日期、拖动手感同日历

Supersedes 2026-10-01 12:07:13 +00:00「关键点手势」条目里「已完成的也不能拖」「竖向 > 6px 起拖」，ui-spec §10.2 的行距 56 / 标签在上 / 已完成行显示完成日 / 实心「当前」标签。
**背景**：用户改中间某个 step 时卡住：已完成的行日期列显示的是完成日（9/22），点开小日历没有「清掉日期」，以为日期清不掉；没日期的行不知道怎么加日期；带日期的强制按日期排、没日期的才能拖，而「清不掉」的日期让行也拖不了；建好的 step 不能改类型（我来做 / 等别人 / 检查点）；类型标签单独占一行太占地方，希望放到同一行最后，并授权按审美和信息层级自己判断。
**选项**：日期列继续混放完成日（加样式区分）或只放自己的日期；类型标签全部显示或只标非默认；改类型用点一下轮换（卡片的做法）或下拉菜单（同面板 AddBar 的做法）；拖动保留 dnd-kit sortable 让位动画或改成日历那套（副本 + 幽灵 + 「放到这里」）。
**选择**：
- 日期列只放自己的 `date`：「日期列空着 = 能拖、能设日期」一条规则就说清楚；完成日只在历史里。`canReorder` = 不是记一笔且没有日期（已完成的也能拖，后端 `move_key_point` 本来就只拒绝带日期的行）。记一笔不再显示「清掉日期」（清了也会被补成今天）。
- 一行布局：行高 56 → 40，文字占满，类型标签在行尾；去掉实心「当前」标签（底色 + 实心标记 + 粗体已经够）。类型标签只标例外：没完成的等别人 / 检查点、记一笔的对方 / 我常显；我来做和已完成行的标签留位置、悬停 / 聚焦才出现。已完成的标签改灰。
- 改类型：行尾标签是按钮，弹菜单（`KIND_ICON` 从 AddBar 导出共用），走 `update_key_point`（只在三种关键点之间换）。
- 拖动：`useDraggable` + `DragOverlay`（portal 到 body，z 200）+ 自己按中线算落点（`calendar/dayOrder.insertIndexAt`），4px 起拖（`STEP_DRAG_DISTANCE`），幽灵 0.35、副本 −1°、「放到这里」同日历样式；落点按不含占位块的位置算，越过邻居中线就换（日历那种算法在宽行上要拖 2½ 行才换位）。`html[data-step-cursor]` 管拖动中的指针。
**代价**：已完成的步骤在时间线上看不到哪天完成；我来做的类型要悬停才看得到能改；日历的落点算法没跟着改（短条目上不明显），两边细节还差这一点；拖动手感只在 Chromium 合成事件和真指针拖拽各验过一次，WKWebView 真机待人工验证。


---

## 2026-10-02 14:45:35 +00:00: 去掉「当前」关键点；逾期的关键点到处标红（菜单栏红点 + 9:00 汇总通知）；拖动时列表不变高

Supersedes 2026-10-01 的「当前全自动」规则（ui-spec §9.3 旧版、architecture §6.1「有效当前」）与 2026-10-02 14:07:22 +00:00 条目里「拖动：幽灵 0.35 + 『放到这里』」那一句；`--rm-current` 令牌删除。
**背景**：用户日用时提了四点：① 详情里拖一行，拿起时列表「会长一点，接着就会弹一下」；② 详情里已做和没做的字一个颜色；③「时间的完成度看上面那个小圆条就知道，事情的完成度看 checkpoint 的点也很明显」，不需要「当前」；④ 设了日期的 checkpoint 过了时间还没完成，要在窗口收起时、呼出时、打开详情时都看得出来，并问「红色代表全部做完（截止）的情况下，超时用什么颜色」。
**选项**：拖动——整体预留一行高度 / 提前空位，或让列表总高恒定；逾期颜色——红色、橙色加重、新加一种颜色；收起时——菜单栏图标红点、图标旁边写数字（`set_title`，不能上色）、只靠通知。
**选择**：
- 拖动：根因不是阴影（副本在 portal 里不占位），是原位幽灵下面再插一个占位块，列表多一行，居中的详情框上下各长半行。改成任何时候只有一个行高的空位：拿起时那一行自己变成「放到这里」，拖到别处时原位 `display: none`、占位块出现在落点。落点算法原来就假设「只有一个空位在 index」，现在是精确的。DragOverlay 的位置取拿起那一刻的 rect，原节点收起不影响它。
- 文字：没完成 `--text`，已完成 `--text-muted`（卡片原来 `--text-3`，一并改）。
- 去掉「当前」：`effectiveCurrentIds`、行底色 / 粗体 / 实心标记、卡片「当前」字样全删；等别人一直画沙漏。「等别人 N 天」仍要知道正在等哪一个，按「开始后第一个没完成的」算，只留在 `waitingDays` 里。后端早就不读 `is_current`，没动表和命令。
- 逾期：三种关键点都算，日期 < 今天、没勾、任务没完成没归档（当天不算）。用 `--du` 红：这套界面里红色本来就是「截止 / 逾期」，关键点逾期是错过一个小截止日；和截止的区别靠形状（红旗 vs 红圈「!」/ `warning-circle`）。橙色是等别人 / 检查点的常态色，加重也会被淹没；新颜色要多解释一次。显示：卡片标题行「N 步逾期」+ 行尾「逾期 N 天」（卡片只露 5 行，所以标题行也要说）；详情红日期、红标记、行尾标签、时间条红点；日历逾期检查点不变淡改红；今日速览加最前一段。
- 收起时：菜单栏图标红点（macOS 模板图不能带色，所以是状态栏按钮上的一个 `NSBox` 子视图，插在 tray-icon 点击层下面；Windows 合成到彩色图标上），心跳 30 秒和每次隐藏窗口时重查；外加每天 09:00 一条汇总通知（逾期 + 今天到期，一天一次，`cache:reminders-step-digest-day`）。原来检查点到点完全不发通知，这次一并补上。
**代价**：拖起时原位不再有半透明影子提示「从哪来」（原位就是占位块）；日历条目的拖动仍是幽灵 + 占位（格子本来就随内容变高，没改）。红色现在同时表示截止和逾期的关键点，只靠形状区分。菜单栏红点靠给 `NSStatusBarButton` 加子视图，依赖 tray-icon 0.25 暴露 `ns_status_item()`（Tauri 小版本升级可能变），且只在离屏渲染里验过，真菜单栏和 Windows 真托盘待人工验证。汇总通知时间固定 09:00，不可设置。

---

## 2026-10-02 14:58:08 +00:00: 详情时间线的行不再整行滑动，「完成 / 删除」从两端盖进来

Supersedes ui-spec §10.14「滑动」在详情时间线里的做法（整行滑动），卡片 / 待办 / 收件箱不变。
**背景**：用户截图两处：左滑打开「删除」后，那一行的圆圈滑出去不见了，文字被推进日期列、被行左边界切掉半个字，竖线在这一行断开，左侧还有两道粉色细弧；右滑时圆圈和竖线被整个推到右边，行尾多一道圆角弧边。
**原因**：整行（日期列 52 + 圆圈列 24 + 文字）跟着手指移动，删除按钮 88px 比左边两列 76px 还宽；行在详情内容区里裁切，不在面板边上，所以裁出来的是半个字和断掉的竖线。粉弧是铺满整行的红色删除层压在白色行面下，行的圆角裁切在抗锯齿像素上把红色透了出来。
**选择**：`SwipeRow` 加 `overlay`：行面不动，动作层画在行面上面、用 clip-path 只露出手指拉开的那一截（四角圆角，像按钮一样从行端长出来）；详情时间线用它。其余行照旧滑动，但所有动作层都改成只铺露出的那一截 + 行面底下 12px 余量，粉边在所有滑动行上一起消失。手势、阈值、键盘 Delete、探头动画都不变。
**代价**：详情里右滑时「完成」色块会盖住日期和圆圈（拉开时），左滑打开时「删除」会盖住行尾的类型标签和长文字的末尾；和卡片里整行滑动的手感不完全一致。真机触控板手感待人工验证。

---

## 2026-10-02 15:12:15 +00:00: 任务卡里也显示记一笔

Supersedes ui-spec §8.6「卡片只列关键点」（`TaskCard` 原来 `filter(kind !== "note")`）。
**背景**：用户在详情里看得到「邮件：申请已收到…」这条记一笔，任务卡上看不到，要求「记一笔也得在预览界面看到」。
**选择**：卡片按时间线顺序列出关键点和记一笔（同详情的 `sortKey`）。记一笔用自己的静态标记（对方信封 / 我铅笔），不能勾、没有右滑，左滑可删；行尾放它的日期，代替详情里的日期列。footer 进度、「N 步逾期」、自动判逾期都只看关键点；只有记一笔的任务也算高卡；`shortestColumn` 估列高时记一笔也算一行。
**代价**：有记一笔的卡片更容易超过 5 行、开始在卡片里滚动（注册美卡 6 行）；卡片窄时记一笔的长文字只剩前几个字。

---

## 2026-10-02 15:56:36 +00:00: 视觉规范与设计稿归位品牌仓 `weekpage-brand`，token 母版改由品牌仓拥有（本仓还没接线）

**背景**：同日照 `mynah-brand` 建了兄弟仓 `weekpage-brand`（品牌与设计系统母版）。色板、app icon、托盘图此前只在本仓，官网一开工就会出第二份拷贝；用户要求把能进品牌仓的东西归位。
**选择**：
- 品牌仓收下：三份 token（`tokens/primitive.css`、`tokens/semantic.css`、`themes/dark.css`，本仓 `c0dce18` 的逐字快照，只换了文件头注释）、`backend/icons/app-icon.svg`、`backend/icons/tray-template.png`；视觉规范 → `visual-spec.md`；`weekpage.pen` → `canvas/desktop.pen`；`design/exports/` → `canvas/exports/desktop/`；探索稿与风格探索 → `canvas/explore/`。需求说明、HANDOFF、`reference/`、`research/` 是产品层的，留在项目目录。
- 视觉规范 §3 不再抄值：搬之前逐个比过，48 个变量的白天 / 黑夜值与本仓 token 全部一致；规范里多出的 `--rm-current` 代码里本来就没有（「当前」关键点已按 2026-10-02 14:45:35 +00:00 那条去掉），随之作废。值只在 token 文件里。
- 本仓的 `components.css`（第 3 层）和图标集（`.icns` / `.ico` / 各尺寸 PNG）仍归本仓。
- 本仓 `.agents/AGENTS.md`、`docs/architecture.md`、`docs/ui-spec.md` 里视觉规范和设计图的路径改指品牌仓；按名字引用的「视觉规范 §N」章节号没变。
**代价 / 没做的**：本仓还没接线——token 仍是本仓自己的文件，没有 provenance 头，`check.sh` 里也没有 brand-check。接线前改 token 要先改品牌仓再拷过来（或改了本仓后回流），否则两份会漂。接线步骤在 `weekpage-brand/docs/consumers.md`；AGENTS「令牌只许加到 `frontend/src/design/tokens/` 与 `themes/`」那句等接线时一起改。

---

## 2026-10-02 16:30:19 +00:00: 接线品牌仓 `weekpage-brand`：token 与两个图形改成它的拷贝，`check.sh` 加第 4 步比对

**背景**：2026-10-02 15:56:36 +00:00 那条把 token 母版交给了品牌仓，但留了「本仓还没接线」。用户要求接上。
**选择**：照 `weekpage-brand/docs/consumers.md` 做：
- 品牌仓 `sync-to.sh weekpage-desktop` 写入三份 CSS（正文没变，换成「三行 provenance 头 + 品牌仓的文件头注释」）；`app-icon.svg`、`tray-template.png` 逐字节相同，没有改动。
- `check.sh` 新增第 4 步（共享检查，`fe` / `be` 都跑）：跑品牌仓的 `sync-to.sh --check weekpage-desktop --path="$PWD"`。原来的 4–9 顺延成 5–10。品牌仓**按 `git rev-parse --git-common-dir` 找主工作区，再看它旁边**，没有照 consumers.md 写的 `../weekpage-brand`：worktree（`code/worktrees/<名字>` 或 `.claude/worktrees/<名字>`）旁边没有品牌仓，用 `../` 的话 worktree 里永远 SKIP，等于没查。找不到（CI）打印 SKIP、退出 0。
- `biome.json` 按文件排除这三份 CSS，`components.css` 仍归 Biome 管。
- AGENTS、README、architecture §9.3 / §15.1、ui-spec §0.2 里「令牌在哪改」的句子改成「改品牌仓，再同步」。
**代价**：改一个颜色要动两个仓（品牌仓提交母版 + 本仓提交拷贝）。本仓 CI 不查漂移（没有兄弟仓），只靠本机提交前跑 `check.sh`。图标集（`.icns` / `.ico` / PNG）不在同步范围，品牌仓改了 `app-icon.svg` 要在本仓手动 `pnpm -C frontend tauri icon icons/app-icon.svg`。

---

## 2026-10-04 04:42:18 +00:00: 更正：补标旧条目里被后来条目推翻的几处

下面五处旧条目的内容后来被推翻了，当时没标 Supersedes。旧条目一字没改，这里补标。读旧条目时，以这里指到的新条目为准。

- Supersedes 2026-10-01 06:03:53 +00:00「debug / release 数据目录与开发 / 正式身份」里开发身份的默认快捷键 ⌥⇧Space，以及同一时刻「待拍板 D1–D9 先按默认值实现」里的 D4（macOS 保留 ⌥Space）。被 2026-10-01 06:32:26 +00:00「用户拍板 D2 / D4 / D8 / D9」推翻：两端默认都是 `Control+Alt+Space`，开发身份是 `Control+Alt+Shift+Space`（`backend/src/db/settings.rs` 的 `defaults`）。原因：Alt+Space 在 Windows 是系统窗口菜单，⌥Space 在本机被 ChatGPT 占用。
- Supersedes 2026-10-01 06:03:53 +00:00「并行开发用 git worktree + 固定合并顺序」里「所有权表见 AGENTS.md / plan §3.5」。M3 集成之后不再按 unit 划所有权，按目录模块自由修改（AGENTS.md「所有权与并行开发」）。再开并行 worktree 时的做法也在 AGENTS.md 同一节。
- Supersedes 2026-10-01 08:30:01 +00:00「D1–D9 当前实现位置」里的 D5（日历条目只能当天内排序、只写 `calendar_day_orders`）。被 2026-10-01 11:04:52 +00:00「日历条目可以拖到别的日子」推翻：现在能跨天改日期。
- Supersedes 2026-10-01 11:04:52 +00:00「界面国际化用 i18next」里的两处：语言 id `zh-CN`（资源目录 `locales/{zh-CN,en}`、设置值 `language: "system" | "zh-CN" | "en"`），以及「原生窗口标题仍是 tauri.conf.json 里的中文」。前者被 2026-10-01 12:15:43 +00:00 的 zh-Hans 条目推翻（现在是 `locales/{zh-Hans,en}`、`"zh-Hans"`），后者被同一条里的「原生窗口标题跟语言」推翻（`settings_apply::apply_window_title`）。
- Supersedes 2026-10-02 15:56:36 +00:00「视觉规范与设计稿归位品牌仓」里的「本仓还没接线」。被 2026-10-02 16:30:19 +00:00「接线品牌仓」推翻：token 与两个图形已是品牌仓的拷贝，`check.sh` 第 4 步比对。

---

## 2026-10-04 04:42:41 +00:00: 选型与命名的理由迁入（原 architecture 的 ADR 正文、需求说明 §9，这两处已删）

**背景**：做文档整理时，architecture.md 的 ADR 正文和需求说明 §9 要删。里面「为什么这样选、放弃了什么」代码里看不出来，搬到这里。上面条目里已经写过的（Tauri 选型的选项、基线偏离十一条、i18n、日历拖动、worktree 流程）不重复，只补缺的。这些理由是从旧文搬来的，没有逐条重新核对；和代码对不上时，以代码和更新的条目为准。
**壳**（补 2026-10-01 06:03:53 +00:00 的技术栈条目）：Electron 常驻一整份 Chromium + Node，常驻托盘的工具内存差一个数量级；mynah 已在 Tauri 2.11 上跑通 NSPanel 换类、快捷键注册失败提示、托盘、多屏定位和 ad-hoc 签名，代码可以直接搬；日历格、拖动、浮层、CSS 变量主题本来就是 Web 的强项。退路：只有 NSPanel 或 Windows 透明窗口在 Tauri 上彻底做不通，才回头考虑 Electron。其余放弃的：Wails v3（还是 beta）、Flutter / Avalonia（要重造 UI 生态）、SwiftUI + WinUI（两套 UI）、Tauri 3.0（alpha，等 RC）。
**分工：Rust 管写和系统，TS 管读和解析**（本项目最重要的一条）：
- 放弃「厚 Rust」（时间识别、日历派生都放 Rust，TS 只渲染）：双击输入的实时预览每个按键都要跨 IPC，还得在 TS 再写一份才能一帧内出结果；65 + 32 条表驱动用例在 Rust 里写比 vitest 慢；改一个文案规则要动两种语言。
- 放弃「厚 TS」（前端直连 SQL，`tauri-plugin-sql`）：插件事务不可靠（plugins-workspace#886，JS 分几次发的 `BEGIN…COMMIT` 可能落到不同连接）；提醒调度在 Rust，会多出第二条数据库访问路径；前端能跑任意 SQL；以后同步没有单一写入口。
- 采用的好处：打字即算、零延迟；规则测试毫秒级；同步的单位是行，派生规则不用上服务端，以后手机端录入也能直接复用 `lib/`；一个事实只有一处实现（写规则只在 Rust，看的规则只在 TS）。
- 不拆成 mynah 那样的 5 个 crate：用户讨厌拆碎，平台代码也只有窗口、毛玻璃、快捷键、通知一小块，用 `backend/src/platform/` 目录隔开就够。
- 提醒调度必须在 Rust：窗口平时是隐藏的，WebView 里的 JS 会被挂起或节流。
**存储**：rusqlite（bundled）单连接。提醒调度和命令共用一个连接，同步 API 写事务简单；bundled 让两端的 SQLite 版本一致（用到 `unixepoch('subsec')`、`json_valid`）。放弃 sqlx（编译期检查要 `DATABASE_URL` 或离线元数据，繁琐）和 ORM（表少，直接写 SQL 更清楚）。
**主键与日期**：基线 spine §1.3 要「自增 id + 业务键 UNIQUE」，这里放弃它。以后多端同步时，外键若指向本机自增 id，同步到另一台设备 id 就变了，每条外键都要翻译；外键指向 UUID 的话，自增 id 就没用了。UUIDv7 按时间有序，B-tree 插入友好；用 TEXT 不用 BLOB，数据库工具、JSON、TS 里都能直接读。用户若坚持基线，退一步是 `id INTEGER PRIMARY KEY` + `uid TEXT UNIQUE`，所有外键和对外引用都用 uid，改动集中在 DDL 与仓储层。日期一律存「浮动本地日期」`YYYY-MM-DD` + `HH:MM`，不换算 UTC：「10/2 收拾行李」出差换了时区也还是 10/2。
**读写与撤销**：
- 读全量快照、写后重拉：个人数据几年也就几千行，毫秒级；不写增量补丁合并（易错）；所有派生函数吃同一份快照，结果一致。归档超过一万行再加分页读取（另加 `list_archive(page)`，不改 `load_snapshot`）。
- 撤销用「写前镜像日志」：一个机制覆盖所有 Toast 撤销，不用每个动作手写反操作；以后做同步，它就是现成的变更来源。回放时 `updated_at` 一律写成 now、不写回旧值，否则以后按 `updated_at` 做 LWW 同步，撤销会显得比远端旧而丢失。日志只留 24 小时，只在本机，不同步。
- 跨天的事（次日自动归档、逾期、未开始）一律查询时推导，不落库、不跑后台改数据：跨天、休眠、App 被杀都不会出现「该改没改」。
**前端**：
- 拖动用 dnd-kit：指针事件，浮起、占位、跨容器（三列互拖）都现成；不用 HTML5 拖放（Tauri 在 Windows 会截走它，所以也设了 `dragDropEnabled: false`）。退路：pragmatic-drag-and-drop。
- 不引 Tailwind：视觉规范本身就是 CSS 变量加精确 px，Tailwind 只会多出第二套词汇。不用 TanStack Query：数据来自本地快照，少一层。不引日期库：浮动日期和中英两种写法都是自定义的，date-fns 帮不上多少，Temporal 在 WKWebView 还没正式上线。
- TypeScript 7.0：不依赖 TS 编程 API（用 Biome + Vite）；任何工具不兼容就退 6.0.3。类型生成的退路：tauri-specta rc 若与 Tauri 编不过，改用 ts-rs 12 只生成类型，`lib/api.ts` 手写 `invoke` 包装。
- 浏览器预览的 mock 不是第二份业务实现，只保证能点能看，规则对不对以 Rust 测试和真 App 为准；撤销用「每个 opId 存一份操作前的整份快照」的笨办法，不模拟日志。
- 节假日：节气用 chinese-days 离线算；法定假日 / 调休读自己的 JSON（打包一份，联网后台更新），因为库自带的数据只到 2026-10-07。
**窗口与通知**：
- macOS 用非激活 NSPanel：普通窗口盖不住全屏应用。Windows 用 alwaysOnTop。
- `tauri-plugin-notification` 只在 Windows 用：它桌面端的 `show()` 不看 schedule，macOS 上走已废弃的 `NSUserNotificationCenter`，可能不报错也不显示。macOS 自己用 `objc2-user-notifications` 调 UNUserNotificationCenter。不交给系统预约（UNCalendarNotificationTrigger / ScheduledToastNotification）：每次改动都要同步系统里待发的通知，等 v1 真不够用再做。
- Windows 不加 Ctrl+Q：Windows 上它不是通行的退出键，托盘和设置面板已有退出。macOS 的 ⌘Q 靠前端兜底，见 lessons.md。
**仓库形状**：顶层 `frontend/` + `backend/` 是项目模板 spine §1.2 定的角色名；`src-tauri` 是实现名，换壳就错了。放弃 Tauri 默认的 `src/` + `src-tauri/`（等于在 spine 里开第一个别名）和 mynah 的 `crates/` + `ui/`（`ui/` 是 spine 点名禁止的别名）。Tauri CLI 必须在 `backend/` 下跑，所以 `frontend/package.json` 的 `tauri` 脚本是 `cd ../backend && tauri`。开发身份写在默认的 `tauri.conf.json` 里，是因为 `cargo build`、`cargo test`、`tauri build --debug` 和冒烟二进制都直接读它。
**并行开发**：不设共享的 `CARGO_TARGET_DIR`。每个 worktree 自带 `backend/target/`，本来就互相独立，共用一个反而抢锁。
**产品名**（原需求说明 §9）：WeekPage，各种语言都叫这个，中文界面也一样，暂不起中文名。理由：两个英文词，国内外用户一眼就认得；和默认 3 周的日历对得上；「给你的几周一页纸」，贴合「纸 + 玻璃」的视觉原则。2026-10-01 查重：App Store 美区、国区（iPhone 和 Mac）都没有同名 App；`weekpage.app`、`getweekpage.com` 没人注册；`weekpage.com` 已被别人注册（2025-10，空白页）。放弃过 DayPad：iOS 已有同名的每周待办 App，`daypad.app` 也挂着「即将上线」。
**需求说明 §9 里本文件原先没有的三条默认决定**：
- 「未开始」不能手选，按开始日自动显示；状态菜单里只有推进中 / 等待中 / 已完成。想马上开始就把开始日改成今天。
- 需求里任务只能从收件箱「变任务」来；补了任务区的「+ 新任务」（⌘N）。详情的 `⋯` 菜单里能删任务，确认一次，关键点和记录一起删、不能恢复。
- 截止前一天 09:00 发一次提醒通知。

---

## 2026-10-04 04:42:54 +00:00: 文档整理：删掉 plan / spikes 和几份规格里的大块内容，旧文用 git show 看

**背景**：2026-10-03（本机日期；条目标题是 UTC）做了一次文档整理，目标是精简、集中、大白话。下面这些已从工作区删除。要看旧文，用 `git show 1bfea22:<路径>`（1bfea22 是整理前的最后一个提交）。
**已删除**：
- `docs/plan.md`：里程碑、unit 拆分、共享契约（§3）、所有权表、worktree 流程、待拍板 D1–D9 的原表（§8）。本文件旧条目里的「plan §N」指的就是它。现行内容：worktree 流程在 AGENTS.md「所有权与并行开发」；未开工的事在 `docs/roadmap.md`；D1–D9 的结论本文件里已有。
- `docs/spikes.md`：S1–S5 的 spike 结论、M3 安装版验证记录、最终独立验收、人工验证清单。清单已搬进 `docs/roadmap.md`；几条值得长期留着的坑写进了 lessons.md。本文件旧条目里「写进 spikes.md」指的就是它。
- `docs/ui-spec.md` 的 §21–§24：seed 数据（现在以 `backend/src/seed.rs` 为准）、演示脚本、验收标准、§23.1 的「裁决总表」等。本文件有些条目按「§23.1 #N」编号引用，请到旧版里查。
- `docs/architecture.md` 里已删的章节：ADR 正文（§2）、里程碑（§18）、基线偏离清单（§20）、审查记录（§21）和一部分能从代码推出来的章节。选型理由已迁进本文件上一条。
- 外层 `docs/需求说明.md` 的 §9「实现期补充决定」整节：外层不是 git 仓，旧文无处可查，内容已在本文件各条里（命名与查重、三条补充的默认决定见上一条；其余各行早有对应条目）。
**代价**：本文件旧条目里指向上面这些位置的引用，现在要靠这条说明去旧版里找。

---

## 2026-10-04 05:06:12 +00:00: architecture.md 瘦身：删掉能从代码读出来的章节，补录几条退路

Supersedes 2026-10-04 04:42:54 +00:00「文档整理」里关于 architecture.md 只写了「已删的章节：…和一部分能从代码推出来的章节」的笼统说法，这里写清楚。
**背景**：architecture.md 从 973 行瘦到约 120 行，只留代码、配置、脚本里读不出来的东西。旧文用 `git show 1bfea22:docs/architecture.md` 看。
**现在剩的章**：§3 分层与读写协议、§4 窗口与系统集成、§6 数据模型（§6.1 概念、§6.2 写规则、§6.3 设置）、§8 IPC、§9 国际化、§11 提醒与通知、§12 跨天与时钟。
**已删的章，以及内容去了哪**：
- §0 一页结论、§1 需求到技术约束、§2 ADR-01…13、§20 基线偏离、§21 审查记录：选型理由和放弃项早已在本文件（「选型与命名的理由迁入」「基线偏离」等条）；§21 里只有历史处理记录，没有独有内容。ADR-05 的依赖版本表是 `Cargo.toml` / `package.json` 的副本，直接删。
- §5 目录结构：可以 `ls`，且早已漂移；目录速览在 AGENTS.md。
- §6.2 的 DDL 与 `backend/migrations/0001-init/up.sql` 一致，删；§6.3 的 Settings 类型是 `backend/src/model.rs` 的副本，删；§8 的命令表和事件表是 `commands.rs` 与 `model.rs` 的副本，删；§9.1–§9.3（组件树、store、令牌）是前端目录、`useUiStore.ts` 和令牌 css 的副本，删。
- §7 日历条目派生：ui-spec §2.5、§2.7 逐条都有，`lib/calendar.ts` 与 `calendarActions.ts` 的文件头也写了，删。§10 时间识别：ui-spec §18、§19 有规则，删。§13 设置：ui-spec §16 有，删。
- §14 日志 / 路径 / 开发身份：`paths.rs`、`logging.rs` 文件头、`tauri.conf.json`、README 都有，删。§15 质量门与测试：`scripts/check.sh`、`.github/workflows/check.yml` 是原件；§15.1 的 demo fixture 六条规则在 `seed.rs` 文件头、`contracts.rs`、`snapshot.rs`、`.gitattributes` 里各有一份，删。§16 安全：`tauri.conf.json` 与 `capabilities/default.json` 是原件，删。
- §17 云同步路径、§18 里程碑、§19 风险与 spike：云同步在 `docs/roadmap.md` 切片 6；里程碑是历史；S1–S5 值得留的结论在 lessons.md，R9（节假日数据）在 roadmap 切片 1，R6 / R10 见下面的补录，R12（未打包进程调通知会崩）在 architecture §11。
- 另外 §6.1 里两段「逾期的关键点」「等别人天数」的规则，ui-spec §9.3、§13.3 已有，删。
**补录**（旧文里的，没有别处写过）：
- 退路，现在的做法在真机上不灵时再换：Windows 透明窗口首次显示闪白，现在是启动即建窗、`window_ready` 之后才 show；还闪，就在首次显示前先 `set_effects`、再延迟一帧。Windows 的焦点事件不稳，现在是去抖 150 ms + blur guard + 显示后 300 ms 保护；还不稳，就把「失焦时自动隐藏」默认关掉。
- 工具：Biome 用 `preset: "recommended"`；升级 Biome 后别信 `biome migrate` 生成的配置，手动对。
- 没做的可选项：发布版加 `tauri-plugin-prevent-default`，禁掉刷新、打印和浏览器右键菜单。
**代价**：本文件旧条目里的「architecture §N」「ADR-0N」指的是旧版，已删的章节请到 `1bfea22` 里查；现行 architecture.md 的章号没变（只是少了几章）。

---

## 2026-10-04 10:06:02 +00:00: 日历 ↔ 任务换页：两页常驻、横滑跟手、手指抬起才决定

**做了什么**（规格在 ui-spec §1.3「左右滑动换页」，代码在 `frontend/src/components/shell/{PageStage.tsx,usePageSwipe.ts,pageSwipe.ts}`）：
- 触控板两指横扫换页，手感照 macOS 三指切换桌面。往左往右都换到另一页（只有两页，不分方向）。点胶囊、⌘1 / ⌘2 用同一个弹簧，任务从右边进来。归档页不滑，只在显示时挂上。
- 两页并排常驻：没显示的那页停在右边屏幕外（inert，不可点）。只平移，手指滚动量 ×1.6。拖过 25% 或甩一下（≥ 0.3px/ms）就过去，弹簧接着松手速度走（不过冲，约 0.38 秒停稳）。拖过整页最多再多走 56px，松手弹回。
- 手指还在触控板上时不决定任何事，抬起那一刻才决定。macOS 上手指抬起由 Rust 报告（`platform/macos_trackpad.rs`，事件 `input://trackpad`）。
- 横滑完成 / 删除的行（SwipeRow）同样在手指抬起时结算；过了阈值改成「越拉越沉」，最多再多走 20px（卡片 14px，详情时间线 6px）。
- 记住的「上次页面」延后 0.7 秒写。

**为什么**：
- 常驻而不是滑动时才挂：挂一页要几十毫秒，刚起手就卡；滑完再卸载，又会有一帧两页叠在一起（闪）。
- 只平移，不缩放、不变淡：日历翻周和任务网格量高度用 `getBoundingClientRect`，缩放会把尺寸量歪，停下后也不会自己纠正；变淡会改变页面里毛玻璃的取样。
- 手指抬起要从原生层拿：网页只看得到滚轮事件，WebKit 把带滚动阶段的零增量事件拦在页面外（见 lessons），页面分不清「手指停着」和「手指抬起」。用户要求「不松手就永远不动」，猜（惯性开始、停顿 60ms）做不到这一点，只在拿不到信号的 Windows 和浏览器预览里保留。
- 上次页面延后写：写设置会换快照、重画两页，不能赶在滑动中间。

**代价**：
- 两页常驻，每次数据刷新两页都重画；页面切回来保持离开时的样子（滚动位置等），以前是重新挂载、回到顶部。
- 多了一个 Rust → 前端事件和一个 AppKit 本地事件监听（每次横扫只发几次）。Windows 精确触控板没有对应信号，仍是猜。

---

## 2026-10-04 10:18:42 +00:00: 换页改成固定左右：日历在左、任务在右，不循环

Supersedes 2026-10-04 10:06:02 +00:00「日历 ↔ 任务换页」里「往左往右都换到另一页（只有两页，不分方向）」这一句，其余不变。
**做了什么**：日历页手指往左滑，任务从右边进来；任务页手指往右滑，日历从左边进来。往没有页面的那边滑，只被拉动一点（最多 56px），松手弹回。没显示的那页停在自己那一侧的屏幕外。
**为什么**：用户要左右布局有明确的空间感，和工具栏胶囊「日历 | 任务」的顺序一致；两个方向都能换页（循环）会打乱这个感觉。
**代价**：往错的方向滑没有反应（只有橡皮筋）。

---

## 2026-10-06 11:15:33 +00:00: 关键点输入：日期从文字里删掉，和日程输入一致

Supersedes ui-spec §19.1 原来的「文字原样保留，不删日期」。
**背景**：用户要求加 step 时像日程那样自动认出日期并放到日期上，视觉和交互照搬日程双击输入。
**选择**：认出的日期从文字里删掉、存进 date，输入框里加预览行。新增相对日期（明天 / 周五 / 下周五…）、`12.2` 写法（只在打字时认）、英文日期词。卡片行尾补上日期（`cardRowDate`）。
**代价**：老数据文字里仍带日期，靠 `cardRowDate` 避免重复；`12.2` 写法有「Python 3.12」这类误判，靠预览行和 ✕ 兜底。

---

## 2026-10-06 14:51:32 +00:00: 卡片上的 step 只能在详情里改；暂停的功能用开关关掉，不删代码

用户要求卡片上不能滑动或点圆圈改 step，改动一律进详情。旧的就地操作留着代码和测试，用 `lib/features.ts` 的 `cardStepActions` 关掉，方便以后恢复。以后「先关掉、可能加回来」的功能都走这个文件。

---

## 2026-10-06 15:00:00 +00:00: 任务状态改用圆标、天数放大固定在左边，截止日期只在要紧时变红

**做了什么**：卡片和详情里的状态图标改成和步骤圆圈同一套的圆标（推进中是半个实心圆，不用 ▷；逾期是红色实心圆加「!」；已完成是绿色实心圆加 ✓）。天数放大，每张卡都放在左上同一个位置，另一句移到右边用小字。截止日期平时不染红，今天截止或已逾期才变红（`dueUrgent`）。逾期卡标题不变红。
**为什么**：用户觉得原来的状态「不好看」。▶ 像播放键，四个图标各用各的图形；逾期卡上有 6 处红色，反而看不出重点；关键数字一会儿在左、一会儿在右，扫一眼找不到。
**代价**：和 weekpage-brand 视觉规范 §组件表有两处不一样：推进中规范写的是 ▷；截止日期规范写的是 `--du-text` 70%。品牌仓的规范没有跟着改。

---

## 2026-10-06 15:20:00 +00:00: 更正：品牌仓视觉规范已跟上状态圆标改版

Supersedes 2026-10-06 15:00:00 +00:00 那条「代价」里的「品牌仓的规范没有跟着改」：weekpage-brand `b0eb5b3` 已把 visual-spec §4、§5 改成现行做法，两边不再不一致；只剩 Pencil 设计稿还是旧画法（brand.md §8 已注明）。

---

## 2026-10-07 07:30:12 +00:00: 浮起的按钮改成「液态玻璃」，内容从玻璃下面流过

**背景**：用户想要 macOS 26 / Natively 那种液态玻璃。原来的玻璃胶囊都放在白纸上，背后没东西，看不出是玻璃。
**选择**：
- 用 CSS 做，所有浮起的按钮共用一份玻璃材质（ui-spec §1.4）。
- 不做真折射：WKWebView 会接受 `backdrop-filter: url(#svg)` 但什么都不画（`CSS.supports` 也说支持），只有 Chromium（Natively 用的 Electron、Windows 的 WebView2）能做。
- 不用原生 `NSGlassEffectView`：它盖在 WKWebView 上能跟着滚动实时折射（2026-10-06 用 Swift 小样验证过），但每个胶囊要单独一个网页视图、前端要把位置报给 Rust，而且主网页里的菜单、Tip、拖动都会被它盖住。
- 让内容流到玻璃下面：任务页两栏的头部浮在列表上，日历底部露出下一周、速览胶囊浮在上面。Supersedes ui-spec §2.1 原来的「最后一行下面不画线，视觉上一直延伸到纸底」。
- 分段胶囊的底压暗一档：玻璃底变白以后，选中的白块和底分不清了。
**代价**：
- `--glass-*`、`--segment-*` 暂时在 `components.css` 里直接引用 primitive，没走品牌仓的语义层；weekpage-brand 的视觉规范还是旧的玻璃写法。收口要把这几个值搬进品牌仓再同步。
- 日历静止时多露出半截下一周，和设计稿 V3-A 不一样。

---


## 2026-10-22 12:35:02 +00:00: 以 MIT 开源，仓库叫 weekpage-classic

**背景**：1.0 已冻结，作者在另做一个多设备同步的新版，两边不共用代码。单机版开源出来，给想要纯本地工具的人用。
**选项**：许可证 MIT 或 GPL-3.0；把私有仓连完整历史改成公开，或新开公开仓只放一个初始提交。
**选择**：
- MIT。WeekPage 这个名字和 `backend/icons/` 里的图标不随代码授权，见 `TRADEMARKS.md`。
- 新开公开仓 `weekpage-classic`，从私有仓的最新代码导出，只有一个初始提交。私有仓的历史里有本机路径和私有仓名，改写历史比重开麻烦，也容易漏。
- 公开前改了这些（本文件「只增不改」的一次例外）：删掉两条只讲作者本机目录和后续产品计划的条目（2026-10-02 15:38:51、2026-10-11 18:59:07）；去掉旧条目里的本机路径和私有 GitHub 仓名；`docs/roadmap.md` 删掉切片 6–8（同步、更新服务、上架，都归新版）；演示数据里作者另一个项目的名字换成虚构的 `orbit`；token 文件头不再指向品牌仓，本仓就是来源；`check.sh` 删掉和品牌仓比对的那一步。
- 文中出现的提交号（如 `1bfea22`、`455dc7e`）指私有仓的历史，本仓查不到。
**代价**：品牌仓（没公开）和本仓的 token 从此各管各的，品牌色以后改了，本仓不会跟着变。
