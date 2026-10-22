# WeekPage Classic · 技术方案

给要动代码的 agent 读。本文只写代码、配置、脚本里读不出来的东西：分层怎么切、写数据的规则、窗口行为的取舍、几处要跨文件一起改的约定。别的去这些地方找：

- **具体的值和结构，看代码**：表结构 `backend/migrations/0001-init/up.sql`；命令 `backend/src/commands.rs`；类型、设置字段、事件名 `backend/src/model.rs`（前端用的是生成物 `frontend/src/types/bindings.ts`）；窗口、CSP、权限 `backend/tauri.conf.json` 和 `backend/capabilities/default.json`；依赖版本 `backend/Cargo.toml` 和 `frontend/package.json`；质量门和 CI `scripts/check.sh`、`.github/workflows/check.yml`；目录和命令速查 `.agents/AGENTS.md`。
- **界面怎么做**：`docs/ui-spec.md`。
- **为什么这样选、改过什么**：`docs/memory/decisions.md`。**踩过的坑**：`docs/memory/lessons.md`。**没开工的事**：`docs/roadmap.md`。
- **需求、视觉规范、设计图**没随本仓公开，见 AGENTS.md 的「权威文档」。

章号沿用旧版，因为代码里有 `architecture §N` 的指针。缺的号是已经删掉的章。

---

## 3. 分层：Rust 管「写和系统」，TS 管「读和解析」

整个 App 是一个常驻的单实例进程，里面两半：Rust（`backend/`，一个 crate）和 WebView（`frontend/`，React）。两半之间只有两条路：前端经 `lib/api.ts` 调命令；Rust 往前端发事件。

| Rust 管 | TS 管 |
|---|---|
| 迁移、事务、写时校验、软删、撤销日志、任务历史、排序键、提醒调度与发送、窗口 / 快捷键 / 托盘 / 自启 / 单实例 / 毛玻璃、路径 / 日志 / 备份 | 时间识别、关键点判型，以及一切「拿一份快照算出来给人看」的东西：显示状态、时间条、日历条目、速览、待办标签、归档统计、节假日标签 |

规则（`scripts/check-boundaries.sh` 守其中几条）：

- 写只有 Rust 一条路。读的推导只在 `frontend/src/lib/` 的纯函数里，组件不写规则。
- Rust 里只有两类跟时钟有关的计算：今天是哪天、现在几点；以及提醒的触发时刻。提醒触发时刻（待办的提醒日加时间，任务截止前一天 09:00）和界面上「今天 18:00」这种标签不是一回事：一个决定何时发通知，一个决定怎么写字。所以不算两份规则。
- 平台差异只在 `backend/src/platform/`。`shell/` 调那里的函数，自己不写 `cfg`。

读写协议：

- **读**：`load_snapshot` 一次返回所有未删除的行（含已归档的任务、已完成的待办）。每个页面都用这一份快照加「今天」推导，所以结果一致。
- **写**：一个业务动作一条命令、一个事务，返回 `{ opId, id }`。前端写完 `refresh()` 重拉快照。拖动类操作先 `patchLocal()` 乐观改本地，再发命令、再重拉。
- **撤销**：每次写之前，先把整行旧值记进 `undo_journal`。Toast 的「撤销」把 opId 交给 `undo`，一次可以交好几个。

**浏览器预览**：没有 Tauri 时，`lib/api.ts` 自动换成内存里的 `lib/mockBackend.ts`（读 demo 快照）。它只管「能点能看」，规则对不对以 Rust 测试和真 App 为准。浏览器会吃掉 ⌘N / ⌘F / ⌘W / ⌘2 这类组合键，预览里验快捷键只能用点击或 `dispatchEvent`。

---

## 4. 窗口与系统集成

窗口对用户的行为（呼出、收起、位置、失焦、托盘菜单）见 ui-spec §1.1；窗口参数在 `tauri.conf.json`；各平台差异的函数都在 `backend/src/platform/mod.rs`。下面只写读代码看不出来的取舍。

- **窗口只建一次。** App 启动就建好并隐藏，之后只 show / hide，不重复创建。原因：Windows 的透明窗口第一次显示会闪白（tauri#14515）。手动启动要等前端首帧渲染完、调 `window_ready` 才显示；开机自启（带 `--autostart`）一直隐藏。
- **macOS** 把窗口换成非激活的 NSPanel（`platform/macos_panel.rs`），所以能盖在全屏应用上，呼出时也不会把别的应用切走。App 是 Accessory 加 `LSUIElement`，不占 Dock（`Info.plist` 里每个键为什么要有，旁边的注释写了）。换类的坑见 lessons.md。
- **macOS 保留 Tauri 默认的应用菜单和 Edit 菜单**：⌘C / ⌘V / ⌘Z / ⌘A 靠它分发，删了就没了。面板形态下主菜单收不到 ⌘Q，所以前端 `useHotkeys` 在 macOS 上自己注册 `mod+Q`（见 lessons.md）。
- **Windows 的焦点事件不可靠**（tauri#10767、#11806、#8869、#13633），所以失焦隐藏要去抖：失焦后等 150 ms 再查一次；显示后 300 ms 内不隐藏；前端声明了 blur guard（拖动中、原生对话框、录制快捷键）时也不隐藏。常量在 `shell/window.rs`。
- **单实例**：`tauri-plugin-single-instance` 必须第一个注册。第二次启动在回调里 `show_main(reason = second-instance)`。macOS 上 Spotlight 再打开已在运行的 App，走的是 `RunEvent::Reopen`。
- **主题**：设置里的 `theme` 变了，Rust 同时对窗口调 `set_theme`，原生毛玻璃才跟着换。令牌旁边声明了 `color-scheme`，也不影响透明（2026-10-01 实测：WKWebView 里 `drawsBackground = false` 时，`color-scheme: dark` 窗口仍然全透明）。前端怎么切见 ui-spec §0.3。

---

## 6. 数据模型

表结构读 `backend/migrations/0001-init/up.sql`，DDL 里带注释。这里只写 DDL 看不出的意思和统一规则。

### 6.1 概念

- **待办** `todos`：一个列表，`sort_key` 的先后就是重要程度。**收件箱** `inbox_items`：随手记；「整理」= 建待办或任务，同时软删自己，在同一个事务里。
- **任务** `tasks`：存的状态只有 `active` / `waiting` / `done`。「未开始」「逾期」是推出来的（ui-spec §0.5）。
- **关键点和记一笔**共用 `key_points` 一张表，`kind ∈ do / wait / check / note`。`note` 就是记一笔：和关键点排在同一条时间线里，但不算关键点（不计数、不能勾、不上日历）。
- **归档**没有单独的表：任务是 `archived_at` 非空；待办是 `done_date < 今天`，推导出来的，不落库。
- `task_events` 是任务历史，只追加。`calendar_day_orders` 一天一行，存那天手动排过的条目键，没排过的天没有行。`settings` 和 `undo_journal` 只在本机，将来同步也不带它们。
- **留在库里、已经不用的东西**：`key_points.is_current` 和 `current_since`，以及历史类型 `kp_current`。「当前」关键点已经去掉（decisions 2026-10-02 14:45:35 +00:00），`current_since` 只在旧数据里当「等别人」天数的起点（ui-spec §13.3）。

### 6.2 写规则

Rust 仓储层统一做，每个 `db/*.rs` 的文件头也写了这份契约。

- 一条写命令 = `Db::with_op` 里的一个事务、一个 `op_id`。仓储函数的形状是 `fn(tx, op, clock, …) -> Result<Option<String>, AppError>`，返回创建或改动的那一行的 id。
- 改一行之前调 `op.capture(tx, table, id)`，新建之后调 `op.created(tx, table, id)`。撤销（`db/journal.rs` 的 `undo`）按 opId 倒序回放：有旧值就整行写回；新建的行没有旧值，就打上 `deleted_at` 墓碑。回放时 `updated_at` 一律写成现在，不写回旧值：以后按 `updated_at` 做行级 LWW 同步，写回旧值会让撤销看起来比远端还旧，被丢掉。`undo_journal` 只留 24 小时。
- INSERT 显式写 `created_at = updated_at = now_ms`（Rust 时钟，不靠 DDL 默认值，seed 才能写固定时刻）。UPDATE 写 `updated_at`。删除一律软删，写 `deleted_at`。删任务时连同它的关键点一起软删。
- 排序用 `sort_key::between(prev, next)`，追加到末尾是 `between(last, None)`，放最前是 `between(None, first)`。
- 任务和它的关键点的每次写，都要调 `history::record`。它给新建的历史行也调 `op.created`，所以撤销「归档」时，「已归档」那条历史一起被打上墓碑，「查看历史」里不会残留。
- 改提醒日或时间、改截止、开关「截止前一天提醒」的写，都要把 `remind_notified_at` 清空，这条提醒才会重新排。

### 6.3 设置

`settings` 表里 `app` 这一行存一份 JSON。字段和默认值看 `backend/src/model.rs` 的 `Settings` 和 `db/settings.rs` 的 `defaults`。写只走补丁（`SettingsPatch`，字段全是可选的）；读按字段兜底：旧版本存的 JSON 缺字段、或有不认识的值，只重置那一个字段（见 `db/settings.rs` 文件头）。哪些字段变了才做副作用，见 `shell/settings_apply.rs` 文件头。

新加一个设置字段，要一起改：`Settings`、`SettingsPatch`、`Settings::apply`、`defaults`、`Settings::fixture`；有副作用的，再加进 `settings_apply` 的 `Changes`。然后跑 `bash scripts/gen-contracts.sh`。

---

## 8. IPC：命令与事件

命令清单就是 `backend/src/commands.rs`，签名是前后端之间的契约，前端一律经 `frontend/src/lib/api.ts` 调用。事件名定义在 `backend/src/model.rs`（`event_name = "shell://…"`、`"clock://…"` 或 `"input://…"`），前端只由 `hooks/useShellEvents.ts` 订阅，页面组件不订阅。

- 改了命令签名、事件，或 `model.rs` 里的类型：先跑 `bash scripts/gen-contracts.sh`（重新生成 `bindings.ts` 和 demo 快照）；`lib/mockBackend.ts` 里有同名写操作的，一起改；ui-spec 里提到的名字跟着改。
- 窗口收起（任何一条路：失焦、快捷键 / 托盘开关、Esc、Cmd+W，都走 `shell::window::hide`）后发 `shell://hidden`，前端趁窗口不可见把视图收回到干净的日历 / 任务页（ui-spec §1.1）。不能只靠 `shell://shown`：它到达时窗口已经显示，WebKit 先把隐藏前最后一帧画出来，再换成新页面，就是「闪一下」。
- 没有单独的「设置已变化」事件。托盘切开机自启这类发生在窗口隐藏期间的变化，靠 `shell://shown` 处理里那次后台 `refresh()` 同步。
- `update_settings` 返回的 `settings` 是副作用生效之后重新读库的值，不是请求里的补丁：快捷键注册失败、回滚之后，前端拿到的是回滚后的值。

---

## 9. 国际化

规则（zh-Hans 是源语言、en 必须同步、「跟随系统」怎么判、日期写法）在 ui-spec §0.8。实现入口：前端 `frontend/src/i18n/index.ts` 和 `types.ts` 的文件头；Rust 自己显示的文字（托盘菜单、提醒通知）在 `backend/src/i18n.rs`；「代码里不许出现内联中文」由 `scripts/check-ui-copy.py` 守，识别规则那几个文件的豁免理由写在脚本里。读代码看不出来的几条：

- 语言解析有三处，各读各的列表：前端 `resolveLang`、Rust `i18n::resolve`、macOS 按 bundle 里的 `.lproj` 匹配。改其中一处的规则，要三处一起核对，并用平台 API 实测，别只比对两份代码（lessons.md 2026-10-01 12:15:43 +00:00）。
- 用户写的文字（标题、关键点）永远作为 React 文本节点传进去，不进 `t()` 的插值，也不进 `<Trans>`，所以不会被当成标记解析。
- 加第三种语言之前，要把 `lib/dates.ts` 里的日期词改成 `Intl.DateTimeFormat`；现在的写法只够中英两种。

---

## 11. 提醒与通知

提醒调度放在 Rust，因为窗口平时是隐藏的，WebView 里的 JS 会被挂起。规则（哪三类、几点发、错过的怎么合并、每天 09:00 的逾期汇总）写在 `backend/src/reminders.rs` 的文件头；通知长什么样见 ui-spec §9.3。

发送走 `platform::notify`。macOS 调 `UNUserNotificationCenter`：没有 `.app` 包的进程（`tauri dev`、直接跑 `target/debug/weekpage`）碰它会直接崩，所以那时只打一行 warn，做法见 `platform/macos_notify.rs` 文件头。Windows 用 `tauri-plugin-notification`：只有装好的 App 才显示自己的名字和图标，开发模式下通知会显示成 PowerShell。

---

## 12. 跨天与时钟

「新的一天」带来的变化，比如待办次日自动归档、任务逾期 / 未开始、时间条前进、日历「今天」高亮，**全部在查询时由「今天」推导，不落库，也没有任何后台任务去改数据**。所以跨天、休眠、App 被杀，都不会出现「该改没改」的状态。具体规则见 ui-spec §0.1、§5、§14，推导代码在 `frontend/src/lib/`。

`today` 怎么变：

1. Rust 心跳每 30 秒比一次本地日期，变了就发 `clock://day-changed`。App 常驻跨过 00:00、休眠跨天后醒来，都靠它。
2. 窗口每次呼出（`shell://shown`），前端再重算一次 `today`，兜底 WebView 被挂起、错过事件的情况。
3. 前端**不用** JS 定时器判断跨天：窗口隐藏时 WebView 的定时器会被节流甚至挂起（lessons.md 里有同类的坑）。

**时钟注入**：`WEEKPAGE_FAKE_NOW=2026-09-30T10:00`，只在 debug 构建生效。Rust 算出偏移 = 假时刻 − 启动时的真时刻，之后 `now = 真时刻 + 偏移`，所以时间照常往前走，提醒照样触发。`app_info().clockOffsetMs` 把偏移交给前端，`lib/clock.ts` 用同一个偏移。浏览器预览用 URL 参数 `?now=`。
