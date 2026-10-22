# 踩过的坑与学到的教训

本文件记录"代码里看不出的东西"：诡异 bug 的根因、反直觉的行为、重构中学到的教训。被修复的条目可以剪枝删除，但能长期留作警示的坑建议保留。

---

## 2026-10-01 08:30:44 +00:00: 菜单栏应用（LSUIElement）拿不到 computer-use 权限

**现象**：`request_access` 对「任务台 Dev」「任务台」（2026-10-01 起改名「WeekPage Dev」「WeekPage」）都返回「未安装」，`list_apps` 里也搜不到，没法在真 App 里点和输入。
**原因**：LSUIElement 应用不进普通应用列表。
**做法**：真 App 只能靠日志（`logs/` 或 `~/Library/Logs/app.weekpage/`）+ `CGWindowListCopyWindowInfo` 找窗口号 + `screencapture -x -o -l <窗口号>` 截 App 自己的窗口 + System Events 发全局快捷键；界面交互在浏览器预览（`window.__wp`）里做，真后端写路径靠 `cargo test`。往 webview 注入脚本的 debug 开关会被权限分类器当成 RCE 面拒绝，别再走这条路。完整演示脚本只能人工走。

## 2026-10-01 08:30:44 +00:00: 列高只靠 ResizeObserver，连续两次新建会落进同一列

**现象**：演示脚本里（旧版 ui-spec §22，用 `git show 1bfea22:docs/ui-spec.md` 看）连续「变任务」，第二张卡也进了第 0 列（应该是最矮的第 2 列）。
**原因**：ResizeObserver 要到下一帧才回报，紧接着的写操作读到的 `columnHeights` 还是旧值。
**做法**：`TaskGrid` 在每次快照变化后的 layout effect 里同步量一次列高（`071ab0a`）。凡是「下一步决策依赖刚渲染出来的尺寸」的地方都要同步量，不能只等观察者。

## 2026-10-01 08:30:44 +00:00: 测量阶段用 visibility:hidden 会让浮层拿不到焦点

**现象**：「变任务」、⌘N 打开浮层后标题框没有焦点。
**原因**：先隐藏测量再定位时用了 `visibility: hidden`，此时调用 `focus()` 无效。
**做法**：测量阶段用 `opacity: 0`。

## 2026-10-01 08:30:44 +00:00: 窗口隐藏时动画不往前走，animationend 不可靠

**现象**：浏览器预览窗格隐藏时、真 App 窗口隐藏时，CSS 动画停住，等 `animationend` 的逻辑（卡片收起后归档、弹窗退场后卸载）会卡住。
**做法**：退场 / 收起一律用定时器（与动画时长一致）结束，失败时恢复显示。验收动画只能确认「挂上了、时长和起止值对」，播放效果要在真机上看。

## 2026-10-01 08:30:44 +00:00: Windows CI 的五个坑

1. `.claude/` 是指向 `.agents/` 的软链接，windows-latest 默认 `core.symlinks=false` 会检出成文本文件，check.sh 第 1 步失败：checkout **之前**先 `git config --global core.symlinks true`。
2. Windows runner 上 `python3` 不一定能用：`check.sh` 先试 `python3 -c ""`，不行退回 `python`。
3. Python 在 Windows 上默认输出编码不是 UTF-8，打印 ✓ / ✗ 会抛 UnicodeEncodeError：设 `PYTHONUTF8=1`（脚本读文件已显式 `encoding="utf-8"`）。
4. **`cargo test` 的测试进程起不来**：`0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND`。tauri-build 只把 Common Controls v6 的应用清单链进 bin（`rustc-link-arg-bins`），同样链接了 Tauri 的测试可执行文件拿到的是 comctl32 v5，缺入口点。`check.sh win`（windows-gnu 只 `cargo check`、不链接）抓不到。做法：`build.rs` 用 `WindowsAttributes::new_without_app_manifest()` 关掉 tauri-build 的清单，自己用 `/MANIFEST:EMBED` + `/MANIFESTINPUT:windows-app-manifest.xml` 对所有产物嵌入（只在 MSVC 目标）。
5. Windows 上 bin 与 lib 的 `.pdb` 同名（现在都叫 `weekpage`；2026-10-01 改名前是 `task-desk` / `task_desk`），cargo 报 `output filename collision`（只是警告，`-D warnings` 不管 cargo 自身警告）。要消掉得给 lib 改名（Tauri 模板用 `xxx_lib`），会动 `main.rs` 与集成测试的 `use`，暂未改（改名时 lib 名照旧跟包名走）。

## 2026-10-01 08:30:44 +00:00: 正式版验证的几个细节

- 新装进 /Applications 的 .app 不会马上进 Spotlight 索引，`mdfind` 搜不到时 `mdimport /Applications/WeekPage.app` 再等几秒。
- release 构建忽略 `WEEKPAGE_*` 环境变量，要在安装版上测提醒又不想往日用库写测试数据：退出安装版，用临时 `HOME` 启动同一个二进制（数据、日志、LaunchAgent 都落临时目录）。通知授权按 bundle id 记，对正式安装版同样有效。
- 第一条通知是在授权回调里才投递的；授权框没人点之前进程退出，这条就丢了（不是 bug，测试时要等点完「允许」）。
- 用 System Events 发的合成 ⌃⌥Space 被 App 收到、输入法没切换；这不能证明物理键盘也一样（系统快捷键可能对真实按键先生效），要人工按一次。
- `osascript -e 'quit app id "app.weekpage"'` 能正常退出 LSUIElement 应用，但日志里没有 `quit requested` 那行（走的是 AppleEvent，不是前端 ⌘Q 兜底）。

## 2026-10-01 12:07:13 +00:00: 只写了 `::-webkit-scrollbar { width }` 的滚动区会冒出粗横条

**现象**：任务卡关键点超过 5 个时，列表底部有一条圆角灰色「横框」，盖住第 5 行；两指横扫时更明显。
**原因**：`overflow-y: auto` 会让 `overflow-x` 也变成 `auto`；行用了 `margin: 0 -4px` 比滚动区宽 4px，于是出现横向滚动。自定义了 `::-webkit-scrollbar`（只写 `width: 3px`）后滚动条不再是 macOS 浮层样式，横向条按默认高度 ~15px 常驻绘制，滑块几乎占满宽度，看起来就是一块灰框。
**做法**：只要纵向滚动的区域写 `overflow-x: hidden`，并给 `::-webkit-scrollbar` 写 `height: 0`；负外边距的行要收在滚动区自己的内边距里。

## 2026-10-01 12:15:43 +00:00: 语言解析的三处输入不一样，规则同构也会对不上

**现象**：前端 `resolveLang` 与 Rust `i18n::resolve` 规则逐字一致，但繁体中文系统（`zh-Hant-TW`）上，访达里的 App 名会是英文的 Task Desk（改名前的英文名；现在中英文都叫 WeekPage），托盘是简体中文。
**原因**：三处读的不是同一份列表。Rust 经 `sys-locale` 读系统原始首选语言；WKWebView 的 `navigator.languages` 已经按 `CFBundleLocalizations` 过滤过；访达按 bundle 里有哪些 `.lproj` 匹配，而 Apple 不会把 zh-Hant 回退到 zh-Hans（实测：`Bundle.preferredLocalizations(from: [zh-Hans, en], forPreferences: ["zh-Hant-TW"])` → `en`）。
**做法**：自己的规则向平台的匹配结果看齐（按文字判简繁，繁体跳过），并用平台 API 实测一遍，不要只比对两份代码。

## 2026-10-01 12:15:43 +00:00: serde `alias` 会让 tauri-specta 拆类型

**现象**：给 `Language` 加 `#[serde(alias = "zh-CN")]` 兼容旧值后，`bindings.ts` 里 `Snapshot`、`SettingsApplied` 等全变成 `Snapshot_Serialize` 一类的双份类型。
**原因**：specta 认为带 alias 的类型序列化 / 反序列化形状不同，并沿着包含它的类型一路传染。
**做法**：旧值兼容放在读库的地方做（`db::settings::upgrade_stored`），线上类型保持一份。

## 2026-10-01 14:10:00 +00:00: WKWebView 里拖动排序时没被拖的行整行变黑

**现象**：真 App（WKWebView）详情里拖动关键点排序时，除被拖的那行外，每一行底色变成纯黑（字照常画）；待办列表拖动也一样（33%）。Chromium、`WKWebView.takeSnapshot` 都看不到，只有真窗口截图（`screencapture -l`）能看到。
**原因**（复现小程序逐项排除得出）：dnd-kit 拖动时给每个 sortable 行写 `translate3d(...)`，每行变成独立合成层；WebKit 判断层是否不透明时，把 `position: relative` 子元素（SwipeRow 的滑动面）的**纯色不透明背景**算作整层不透明，却没算上外层 `overflow: hidden + border-radius` 的圆角裁剪，于是层的底没清、被裁掉的背景也没画进去，显示成黑色。四个条件缺一不黑：合成层、圆角裁剪、有自己 RenderLayer 的子元素、纯色不透明背景。窗口透明、毛玻璃、backdrop-filter、深浅色都无关。
**做法**：会被裁剪、又在可能合成的行里的背景，用「单色渐变」`linear-gradient(c, c)` 代替纯色（WebKit 不把渐变当已知不透明），SwipeRow 平时不裁剪、只在滑动时裁剪，不动的行不写 transform。`isolation: isolate` 也能修但会把 position: fixed 的日期浮层压到后面的行下面，别用。复现方法（小程序在会话临时目录，未入库，需要时照此重写）：Swift 非激活 NSPanel + 透明 WKWebView 载入 localhost:1420，JS 模拟拖动，`screencapture -l` 截窗口，`blackcheck` 计黑色像素比例）。


## 2026-10-01 15:44:43 +00:00: 仓库搬目录后 build.rs 报 failed to read plugin permissions

**现象**：仓库整个挪到新路径（改名 WeekPage 时）后第一次 `cargo test`，`tauri-build` 在 build.rs 里 panic：`failed to read plugin permissions … failed to read file '<旧路径>/backend/target/debug/build/tauri-*/out/permissions/…/app_hide.toml'`。
**原因**：`backend/target/` 里 tauri 各插件生成的权限清单记的是旧的绝对路径，cargo 不会因为目录搬家而让它们失效。
**做法**：搬目录或改包名后先 `cargo clean --manifest-path backend/Cargo.toml` 再跑 `check.sh`（全量重编几分钟）。

## 2026-10-02 13:18:37 +00:00: 改 identifier 后拷旧数据，开机自启不会重新注册

**现象**：按当时 README 的迁移步骤把 `app.taskdesk` 的数据目录拷成 `app.weekpage`、装好 WeekPage 并启动后，设置里「开机自动启动」是开的，但 `~/Library/LaunchAgents/WeekPage.plist` 一直没有生成。
**原因**：`init_autostart`（`backend/src/shell/settings_apply.rs`）只在首次启动时注册登录项，做完会在 `settings` 表写 `cache:shell-autostart-initialized`。这个标记跟着数据库一起拷过来了，新 identity 以为已经初始化过，直接跳过；平时只有设置值变化时才会调 `set_autostart`。
**做法**：拷完数据后，在 WeekPage 设置里把「开机自动启动」关掉再打开一次。以后再换 identifier，要么让用户这样拨一下，要么在拷贝后删掉这个 cache 行。

## 2026-10-04 04:43:52 +00:00: macOS 非激活面板盖全屏应用：Floating 级别够用，collectionBehavior 少一项会悄悄失效

**现象**：TextEdit 进入全屏后按快捷键，面板出现在它上面并能打字，前台应用仍是 TextEdit。
**原因**：`NSFloatingWindowLevel` 加上 `CanJoinAllSpaces | FullScreenAuxiliary | IgnoresCycle`（`backend/src/platform/macos_panel.rs`）就够了。只设 level、漏了 `FullScreenAuxiliary`，面板就盖不住全屏应用，而且不报错。
**做法**：不要升到 `NSStatusWindowLevel`；真要升，先验证中文输入法候选窗仍在面板之上。改 `macos_panel.rs` 时，三项 collectionBehavior 一项都不能少。风险：tauri-nspanel#123 报告说 macOS 27 上点击非激活面板会激活应用（系统行为变了）。本机是 26.5，升级到 27 后要复测「点击面板时前台应用是否保持不变」。Safari 全屏下的实测还没做，在 `docs/roadmap.md` 的 macOS 人工验证里。

## 2026-10-04 04:43:54 +00:00: 面板形态下 ⌘Q 靠前端兜底，输入法组合态的 Esc 要先给输入法

**现象**：面板显示时按 ⌘Q 能退出，但日志是 `quit requested` → `exit requested (code Some(0))`，走的是前端 `useHotkeys` 的 `mod+Q → api.quitApp()`，不是主菜单的 Quit。另一处：拼音输入处于组合态时按 Esc，被取消的是组合态，设置浮层没关、窗口没隐藏。
**原因**：非激活面板加 Accessory 的组合下，主菜单的 Quit 收不到 ⌘Q（若主菜单生效，会直接 `applicationWillTerminate`，不会有 `quit requested` 那行）。Esc 的处理顺序见 ui-spec §15.4，第一层就是「输入法还在组合中：交给输入法」。
**做法**：前端那条 `mod+Q` 必须保留；Windows 不设 Ctrl+Q。Esc 链的第一层不能动。

## 2026-10-04 04:43:55 +00:00: 偶发：呼出后整个窗口全透明，十余次没复现

**现象**：第一次 `tauri:dev` 运行时，右屏呼出后用 `screencapture -l` 拿到整窗全透明（像素全是 alpha 0）。之后换了两种运行方式（裸二进制、`tauri:dev`）、两块屏、隐藏 50 秒再呼出、呼出后 0.2 / 0.5 / 1 / 2 秒各截一次，十余次都正常，没复现。
**原因**：不明。
**做法**：没有修复动作。日用中再遇到，记下是第几次呼出、哪块屏、日志里 `shown` 的时间。「首次呼出是否闪白 / 空白透明窗」在 `docs/roadmap.md` 的 macOS 人工验证里。

## 2026-10-04 04:43:56 +00:00: macOS 全局快捷键被别的 App 占了，Carbon 注册也不报错

**现象**：⌃⌥Space 已被别的 App（ChatGPT 很可能占了）占用时，我们注册照样成功、没有任何错误，只是按键到不了我们。
**原因**：Carbon 的热键跨应用重复注册不报错。系统自己的快捷键（比如「选择输入法菜单中的下一个输入法」，`com.apple.symbolichotkeys` 第 61 项）也一样，要另外读系统快捷键表才知道。
**做法**：别指望靠注册失败发现冲突。系统快捷键读 symbolichotkeys 检测，在设置面板和首启提示里说明怎么关；被别的 App 占用检测不到，所以首次启动时窗口里提示「按 ⌃⌥Space 试试能不能收起」，设置里能重新录制，托盘菜单兜底。注册本身失败（含回滚）才会 emit 状态并发系统通知。

## 2026-10-04 04:43:57 +00:00: 菜单栏图标 `set_visible` 成功也可能看不见，入口永远留三条

**现象**：作者的另一个 Tauri 应用踩过：应用内开关和系统开关都开着，菜单栏上仍没有图标，`set_visible(true)` 也没报错。
**原因**：`set_visible` 成功只说明系统接受了请求，不说明图标真的画出来了。macOS 的 Control Center 会按 bundle id 把菜单栏项的放置状态跨进程关联，关联错了就看不见。
**做法**：不把托盘图标当唯一入口。入口永远留三条：全局快捷键、托盘图标、Spotlight / 开始菜单。设置里不提供「隐藏托盘图标」（现在就没有这个选项），也不能让用户把所有入口都关掉。

## 2026-10-04 04:43:58 +00:00: 本机 Homebrew 的 cargo 排在 rustup 前面，手动跑 cargo 会绕过 rust-toolchain.toml

**现象**：手动跑 cargo 时 `rust-toolchain.toml` 不生效，`--target` 交叉编译（`check.sh win`）也用不了。
**原因**：本机 PATH 上 Homebrew 的 `cargo` 排在 rustup 前面。
**做法**：`scripts/check.sh` 开头已经把 `~/.cargo/bin` 放到 PATH 最前；手动跑 cargo 时同样先 `export PATH="$HOME/.cargo/bin:$PATH"`。

## 2026-10-04 04:43:59 +00:00: 窗口隐藏时 requestAnimationFrame 不触发，依赖「首帧之后」的逻辑要有定时器兜底

**现象**：窗口隐藏时，`requestAnimationFrame` 的回调不跑（本仓实测）。窗口启动时就是隐藏的，所以「等首帧再做」的逻辑会一直等不到。
**原因**：WebKit 把没被点过的窗口当 hidden，约 5 秒后挂起页面 JS，隐藏窗口里不出帧（上面「窗口隐藏时动画不往前走」是同一类）。
**做法**：这类逻辑用定时器兜底。例子：`frontend/src/App.tsx` 里告诉 Rust「窗口可以显示了」的 `windowReady`，旁边的注释写了原因。

## 2026-10-04 10:06:02 +00:00: 网页分不清触控板上的手指「停着」还是「抬起了」

**现象**：横滑换页、横滑完成 / 删除，手指停在触控板上没动，页面就以为松手了，提前切页或结算；反过来，手指抬起后系统还会发很久的惯性滚动，按「滚轮停了」来判断又会让行停在「完成」上半秒多才执行。
**原因**：macOS 的滚动事件带阶段（开始 / 进行中 / 结束、惯性开始 / 结束），但 WebKit 只把有位移的滚轮事件交给页面，零位移的阶段事件在派发前就被拦掉了（`Element::dispatchWheelEvent` 里调了 `stopPropagation`）。页面只能靠「惯性开始」「停顿多久」去猜。
**做法**：macOS 上由 Rust 读：`backend/src/platform/macos_trackpad.rs` 用 AppKit 本地事件监听看每个滚动事件的 phase，手指放下 / 抬起时发 `input://trackpad`，前端存在 `frontend/src/lib/trackpad.ts`，`usePageSwipe` 和 `SwipeRow` 据此只在抬起时结算。拿不到信号（Windows、浏览器预览）才退回去猜。

## 2026-10-04 10:06:02 +00:00: tauri:dev 开着时改自定义 hook，窗口可能整页空白

**现象**：`pnpm -C frontend tauri:dev` 开着，改了 `usePageSwipe.ts` 以后，窗口里只剩毛玻璃底，什么都不显示。控制台是 React 的「Rendered more hooks than during the previous render」。
**原因**：热更新（Fast Refresh）保留组件原来的 hook 状态重新渲染。自定义 hook 放在没有 JSX 的 `.ts` 文件里时，hook 的数量或顺序变了也不会强制重挂，React 直接报错；App 没有错误边界，整棵树被卸掉。正式包没有热更新，不会出现。
**做法**：刷新窗口：窗口里右键「Reload」，或改一下 `frontend/src/App.tsx`（它不能热替换，会触发整页刷新），或重启 tauri:dev。窗口隐藏时页面 JS 是暂停的，刷新要等窗口再显示时才执行。

## 2026-10-04 10:06:02 +00:00: Claude 内置浏览器预览里，动画的时间和性能都不能信

**现象**：在内置浏览器里预览（`pnpm -C frontend dev` 的 dev server）验证动画时，`requestAnimationFrame` 1 秒才跑一次，`setTimeout` 偶尔一卡几百毫秒；挂载一页量出来 600ms（可见时约 60ms）。
**原因**：预览窗格经常处于隐藏状态（`document.visibilityState === "hidden"`），浏览器对隐藏页降频。
**做法**：要看动画轨迹，在页面里把 `requestAnimationFrame` 换成 `setTimeout(cb, 16)` 的垫片，按时间采样 `style.transform`，只看形状不看耗时；手势用合成 `WheelEvent` 模拟（`deltaX` 为正 = 自然滚动下手指往左）。卡不卡、跟不跟手只能在真 App 里试。

## 2026-10-05 07:35:08 +00:00: 横滑换页往空的那边拉过头，再滑或松手会一卡一卡

**现象**：日历页往右、任务页往左多滑几下，或者用力甩一下，页面一跳一跳的：松手时先被甩出去一截（实测从 53px 甩到 136px）才弹回；弹回途中手指再放上去，页面往中间猛跳（127px → 31px）；松手后还会自己跟着惯性再动几轮。任务页更明显。
**原因**：三个原因叠在一起。
- 重新抓住拉过头的页面时，把屏幕上的位置当成拉动量又过了一遍橡皮筋，阻力算了两次。
- 松手时交给弹簧的是手指的速度。拉过头以后页面比手指慢得多，弹簧就把页面甩了出去。
- 页面忙时，WebKit 会把几次惯性滚动合并成一次更大、更晚到的，按滚动量猜惯性会误判成手指。任务页渲染更重，合并得更多。

**做法**：都在 `frontend/src/components/shell/` 里。
- 抓住时用 `unRubberBand` 反算出拉动量。
- 松手速度乘以 `rubberSlope`，也就是页面在屏幕上的速度。
- 拿到 `input://trackpad` 信号时，松手后的滚动一律吞掉，直到报告手指重新放下（`usePageSwipe` 的 `fingersBack`）。

`shell.test.tsx` 的「sliding past an end」对这三点各有一个测试。

## 2026-10-05 10:24:16 +00:00: WKWebView 里圆圈中的图标偏 1 个物理像素

**现象**：真 App 里关键点圆圈中的铃铛偏下、沙漏和信封偏右，各差 1 个物理像素（Retina 上半个 CSS px）。偏哪边随卡片位置变；Chromium 里完全居中，`getBoundingClientRect` 量出来也是正中。
**原因**：WebKit 画内联 `<svg>` 时把位置取整到整 CSS px，边框和背景却对齐到物理像素。圆圈落在 .25 / .5 / .75 这类位置时，两者就差出 1 个物理像素。
**做法**：`styles.css` 给所有 `svg` 加 `transform: translate(0)`，有 transform 的元素 WebKit 会按物理像素画，Chromium 画法不变。这会让图标变成层叠上下文，加之前按「同一层叠上下文里，有没有更早的定位元素或更晚的不透明块盖着图标」查过各页面，没有冲突；以后给图标上盖遮罩时留意。复现：Swift 起离屏 WKWebView 载入页面，`takeSnapshot` 出 2x 图，比较圆环和图标的像素重心。

## 2026-10-07 07:49:57 +00:00: 跨文件 `composes` 在 Vite 开发模式下的两个坑

**现象**：① 改了 `components/ui/Glass.module.css`，热更新后组件还是旧样式，刷新页面也不变。② 共用玻璃配方里写了 `position: relative`，今日速览胶囊自己写的 `position: absolute` 被它盖掉，胶囊跑偏。
**原因**：① 被 `composes` 的文件改了，Vite 不会让引用它的模块失效，它们手里还是旧的那份。② 开发模式下每个引用方的样式表里都内联一份被组合的规则，后加载的那份会盖掉先加载的组件里同优先级的属性，结果取决于加载顺序。
**做法**：① 改了被组合的文件就重启 dev server（只改引用方自己的文件不用）。② 共用配方里允许组件覆盖的属性（定位、底色、描边、阴影）放进 `:where(.glass)`，优先级为 0，组件自己的规则总能赢，见 `Glass.module.css` 头部注释。

