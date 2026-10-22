# weekpage-classic · WeekPage 1.0（开源单机版）

WeekPage 是一个 local-first desktop tool（日历 + 待办 + 收件箱 + 任务看板），用全局快捷键呼出的悬浮窗口，Mac + Windows，Tauri 2（Rust backend + React frontend）。

**本仓处于维护模式**：1.0 于 2026-10-11 冻结，2026-10-22 以 MIT 开源。只修 bug，不加功能。

## 权威文档（没随本仓公开）

正文里提到的这几份没有公开，遇到时以本仓的代码、`docs/ui-spec.md` 和 `docs/architecture.md` 为准：

- 《需求说明》（1.0 定稿）
- 《视觉规范 V3》与设计图（ui-spec 里「v2 01-1」「V3-A」「V3-C」这类编号指设计图；A = 白天，C = 黑夜）

文档里还会出现几个外部名字：「基线 / spine / project-template」是作者的私有项目模板；「品牌仓 / weekpage-brand」是没公开的品牌与设计系统母版（本仓的 token 曾是它的拷贝，现在本仓就是来源）；「mynah」是作者的另一个 Tauri 应用。提交号（如 `1bfea22`）指私有仓的历史，本仓查不到。

## 仓内文档

- `docs/architecture.md` — 技术方案：分层与读写协议、写数据的规则、窗口与系统集成的取舍。只写代码里读不出来的；具体的值和结构（表、命令、类型、配置）直接看代码
- `docs/ui-spec.md` — 界面实现规格（开发以它为准）
- `docs/roadmap.md` — 1.0 冻结时没做完的切片，不再排期（含 Windows / macOS 人工验证清单）
- `docs/memory/` — 长期记忆（见文末协议）

`architecture` 和 `ui-spec` 是定稿规格：实现与它们不一致时，要么改代码，要么同一次提交里改文档并在 `docs/memory/decisions.md` 记原因。

## 目录速览

```
frontend/   React 19 + Vite 8 + TS 7（CSS Modules + 三层 token，zustand，无路由库）
  src/lib/api.ts          唯一 IPC 出口（无 Tauri 时自动切 mockBackend，浏览器预览用）
  src/types/bindings.ts   由 Rust 生成，禁止手改；视图类型在 types/domain.ts
  src/i18n/               i18next 初始化 + locales/{zh-Hans,en}/<分区>.ts（en 按 zh-Hans 的形状定型，规则见 ui-spec §0.8 和 architecture §9）
  src/design/tokens/      primitive（唯一能写颜色字面量）→ semantic → components；themes/dark.css
backend/    = Tauri 的 src-tauri/，单 crate weekpage（lib weekpage + bin weekpage）
  src/commands.rs         全部命令（签名是契约）
  src/db/                 唯一写路径：journal（撤销）、history、sort_key、snapshot、settings + 各仓储
  src/platform/           唯一允许 cfg(target_os) 的地方
  src/i18n.rs             托盘菜单 / 通知的中英文字（Lang、resolve、Text）
scripts/    check.sh · gen-contracts.sh · check-boundaries.sh · check-no-cjk.py · check-ui-copy.py · sync-agent-config.sh
```

## 改共享契约时

命令签名 / 事件 / `model.rs` 类型改了，先跑 `bash scripts/gen-contracts.sh`（`bindings.ts` 和 demo 快照由它生成），再把 `lib/mockBackend.ts` 里同名的写操作、ui-spec 里提到的名字跟着改。命令表、类型表不抄进文档，以 `commands.rs`、`model.rs` 为准。

## 命令速查

```bash
bash scripts/check.sh            # 全部质量门（提交前必跑）
bash scripts/check.sh fe         # 只跑前端那半
bash scripts/check.sh be         # 只跑 Rust 那半
bash scripts/check.sh win        # Windows 交叉检查（工具链没装就 SKIP）
bash scripts/gen-contracts.sh    # 改了 model.rs / commands.rs / seed.rs 后重新生成 bindings.ts 与 demo-snapshot.json
pnpm -C frontend dev             # 浏览器预览 http://localhost:1420/?now=2026-09-30T10:00（mock 后端，window.__wp 调试把手）
pnpm -C frontend tauri:dev       # 真 App（开发身份）；演示数据：WEEKPAGE_SEED=demo WEEKPAGE_FAKE_NOW=2026-09-30T10:00
pnpm -C frontend tauri:build:debug   # backend/target/debug/bundle/macos/WeekPage Dev.app
pnpm -C frontend tauri:release       # 正式身份（app.weekpage / WeekPage）→ backend/target/release/bundle/macos/WeekPage.app
```

debug 构建还有两个排查开关：`WEEKPAGE_NO_PANEL=1` 跳过 NSPanel 换类、退回普通置顶窗口，用来对照；`WEEKPAGE_OSASCRIPT_NOTIFY=1` 在没有 `.app` 包时用 `osascript` 弹通知。其余开关见 `.env.template`，安装与数据位置见 README。

## 约定与禁忌

- 写路径只有 Rust：前端只调 `lib/api.ts`，写操作走 `useDataStore().mutate(...)`（自动 refresh + Toast + 撤销）。
- 推导规则只在 `frontend/src/lib/` 的纯函数里，组件不写规则。
- 颜色只用令牌；颜色字面量只许出现在 `design/tokens/primitive.css`。`themes/dark.css` 里同一组值写了两段（手动黑夜、跟随系统），改一处就要改两处。
- `cfg(target_os` 只在 `backend/src/platform/`；`shell/` 调 `platform::` 函数。
- 暂时关掉、以后可能加回来的功能，用 `frontend/src/lib/features.ts` 里的开关关掉，不删代码；被关掉的行为在测试里临时打开开关覆盖。
- 对外表面（日志、AppError message、脚本输出、CI）一律英文；UI 文案走 i18n（`frontend/src/i18n/locales`，zh-Hans 为源，en 必须同步；Rust 托盘 / 通知 / 窗口标题走 `backend/src/i18n.rs`）。代码里出现中文（注释除外）= 漏进 i18n，`check-ui-copy.py` 拦；识别规则行用 `// not-ui-copy: <理由>` 豁免。
- 语言标签按文字：`zh-Hans`，不写 `zh-CN`（那是 OS 报上来的地区标签，只在测试里当输入出现）。
- 排序键用 `<` 比较，不许 `localeCompare`；不许 `tauri-plugin-sql`；`@tauri-apps/*` 只在 `lib/api.ts`。
- `tauri.conf.json` 是**开发身份**（`app.weekpage.dev`）；任何 debug 构建都不加 `--config`。
- 版本号只写在 `backend/Cargo.toml`，`tauri.conf.json` 不写 version。
- 库文件仍叫 `task-desk.db`（每日备份 `task-desk-YYYYMMDD.db`），不要改名，见 decisions.md 2026-10-01 15:44:43 +00:00「产品改名 WeekPage」条里的「故意不改」。
- 手动跑 cargo 前先 `export PATH="$HOME/.cargo/bin:$PATH"`，原因见 lessons.md。
- 做窗口 / 快捷键 / 托盘 / 打包这类系统集成前，先 grep `docs/memory/lessons.md`。

（以下维护协议段由 project-memory-init skill 注入）

<!-- BEGIN: PROJECT MEMORY PROTOCOL (injected by project-memory-init skill) -->

## 项目记忆维护协议

本项目维护三份长期记忆文件：

- `docs/memory/product.md` — 当前产品是什么、为谁做、不做什么（滚动更新）；理解产品意图和范围时读
- `docs/memory/decisions.md` — 重大技术决策的追加式记录（只增不改）；做架构 / 选型决策前先看有无先例
- `docs/memory/lessons.md` — 踩过的坑与教训（追加为主，修复后剪枝）；遇到诡异现象时优先 grep，可能已有人踩过

另外一个文件不属于长期记忆，但同样要认得：

- `docs/roadmap.md` — 1.0 冻结时没做完的切片，不再排期

### 时间戳规范

追加到 `decisions.md` / `lessons.md` 以及任何归档注释块的条目标题，**必须**使用 `YYYY-MM-DD HH:MM:SS +00:00` 格式（24 小时制 + UTC），例：`2026-04-25 21:30:45 +00:00`。不要只写日期。

**时区一律用 UTC（协调世界时），偏移量恒为 `+00:00`，不跟本机时区走，也无夏令时切换**。

**为什么**：(1) 本项目可能同时开多个 git worktree 改同一份记忆文件，仅凭日期无法稳定排序——合并时容易冲突，错误记录也无法对回到当时的代码状态；(2) worktree / PR 可能从不同时区的机器上合并，统一钉成 UTC 这一个零偏移基准才能跨机器正确排序、无夏令时歧义，PR 合并时也按这个基准判断先后。

**读取时以时间戳为准，不要以文件中出现的顺序为准**：worktree 合并 / 并行追加 / Claude 误插位置等场景下，新条目可能落在文件中较旧条目之后但实际时间更早。判断"哪条最新 / 谁 supersede 谁 / 同一天的先后"一律看 header 里的时间戳，**不要**靠文件位置推断。位置错乱按 `decisions.md` 的「只增不改」原则不主动重排——动既往位置反而违反追加式协议。

**获取当前时刻（一律取 UTC，不取本机时区）**：

- bash（Linux / Mac / Windows Git Bash 均可）：`date -u "+%Y-%m-%d %H:%M:%S +00:00"`（`-u` 强制 UTC，跨平台一致，不依赖 tzdata）
- PowerShell（Windows）：`[DateTime]::UtcNow.ToString("yyyy-MM-dd HH:mm:ss") + " +00:00"`

`product.md` 是滚动更新文件，不受此规范约束。

### 在以下情况主动提议沉淀

1. **做出非平凡的技术决策**（选型、架构变更、推翻旧方案、引入新依赖）→ 提议追加到 `decisions.md`
2. **修复一个花了 30 分钟以上才定位的 bug** → 提议追加到 `lessons.md`
3. **用户说"砍掉 X 特性" / "改成 Y 方案" / "这个方向不对"** → 提议更新 `product.md`
4. **发现代码里有"看起来奇怪但其实有原因"的地方** → 提议追加到 `lessons.md`

**提议方式**：给出**具体的文字草稿**，不要只问"要不要记"。让用户直接回复"记"或"不用"。

**决定权在用户**：说"记"则写入，说"不用"则跳过。**绝不自作主张更新文件**。

### `.claude/CLAUDE.md` 与 `README.md` 同步检查

`decisions.md` / `lessons.md` 沉淀**历史**；`.claude/CLAUDE.md` 和 `README.md` 描述**当前状态**——前者给未来的 Claude 读，后者给人类读。两份"门面文档"最容易悄悄落后于代码。

**触发时机**：上面四类触发里的 #1（非平凡技术决策）和 #3（方向性变化）发生时——简单说，**任何值得写进 `decisions.md` 或改动 `product.md` 的变化**，都要顺带跑一次本节的检查。

**检查做什么**：

1. 把这次的变化摘出来
2. 对照读 `.claude/CLAUDE.md` 和 `README.md`（两份都看，不是二选一）
3. 找三类不一致：
   - **事实相矛盾**（例："技术栈 = X" 但实际已切成 Y）
   - **功能说明指向已删功能**（例：README 还在教装某个已撤掉的模块）
   - **漏记新能力**（例：新增了 `install.sh`、新目录、新脚本，文件结构树没补）
4. 有不一致时，**分别**给出 `.claude/CLAUDE.md` 和 `README.md` 的修改草稿让用户确认——两份受众和粒度不同，不要套用同一份草稿
5. 两份都没问题也要**明确说一句**"CLAUDE.md / README.md 已核对，无需改动"，避免"默默跳过"让用户不确定你查没查

**边界**：

- `decisions.md` 记"为什么做这个决策"；`.claude/CLAUDE.md` / `README.md` 记"当前是什么状态"。同一变化在多处出现是正常的，角度不同
- 不要把决策的背景 / 选项 / 代价抄到 CLAUDE.md 或 README.md 里，**只抄结论**（当前事实）
- 没有实际变化就不改——不要为了"看起来在维护"做无意义修订

### 以下情况不要记录

- 小 bug、typo、无需思考就能修的问题
- 事后看来显然的决策（"obvious in retrospect"）
- 可以直接从代码看出的事实
- 临时讨论、没落地的想法

### 会话状态：不落盘

"当前在做什么 / 卡在哪 / 下一步做什么"是会话状态，不是项目记忆，不写进 `docs/memory/`；需要交接时写进 PR 描述或 issue。

### 各文件的变更模式

- `product.md`：滚动更新。方向有较大调整时重写对应章节。
- `decisions.md`：**追加式，只增不改**。历史决策永远不修改；如被推翻，新建条目并在其中引用旧条目（如 "Supersedes 2026-01-15 14:30:45 +08:00 的条目"）。
- `lessons.md`：追加为主。坑被彻底修复后可剪枝对应条目；有长期警示价值的保留。

<!-- END: PROJECT MEMORY PROTOCOL -->
