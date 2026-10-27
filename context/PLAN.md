# macOS Web 功能完整性提升计划

## 1. 目标与已确定范围

交付一个面向桌面和笔记本、保留 Monterey 风格的完整版本。**首要验收目标是实现顶部所有菜单下拉与状态栏面板**，并让菜单、窗口、桌面文件和应用行为保持一致。

已确定：

- Finder、TextEdit、Terminal 支持多窗口；其他应用保持单窗口。
- 增加桌面文件、Spotlight、窗口总览、Control Center。
- 完善 Calculator、Sketch、Safari，移除 Studio。
- Safari 默认主页和 Home 按钮统一使用 `https://vectorindex.cloud`。
- 保留现有文件操作范围，新增 Empty Trash；不增加文件复制/移动、多选、导入或整库备份。
- 恢复设置、窗口布局和已保存文档；不恢复未保存的 TextEdit 草稿。
- 保持静态站点架构，核心资源本地化；不加入 PWA 或服务端。

## 2. 顶部菜单：完整实现清单

所有菜单共用命令注册表，统一处理执行、禁用状态、勾选状态及快捷键。打开菜单时保留原窗口、文本选区和文件选择，防止操作目标随菜单焦点改变。

| 入口 | 本版必须实现的内容 |
|---|---|
| **Apple** | About This Desktop、System Settings、Restart Desktop。重启先处理未保存内容，再恢复允许保存的会话状态，不清空文件。 |
| **当前应用名称** | About 当前应用、关闭该应用全部窗口。Finder 关闭窗口后保留桌面；批量关闭先完成所有保存确认，取消时不继续关闭。 |
| **File** | 根据当前应用显示真实可用的文件动作，具体见下表。 |
| **Edit** | 文本输入的 Undo、Redo、Cut、Copy、Paste、Select All；Sketch 的 Undo、Redo、Clear Drawing；Calculator 的 Copy Result。Finder 不增加文件剪贴板操作。 |
| **View** | Show Desktop、Window Overview、外观切换；文件视图增加按名称/类型排序；TextEdit 暴露已有字体与字号设置。 |
| **Go** | Desktop、Documents、Downloads、Trash；Finder 的 Back、Forward、Enclosing Folder；Safari 的 Back、Forward、Home；TextEdit/Terminal 的 Reveal in Finder。 |
| **Window** | Minimize、Maximize/Restore、适用应用的 New Window/New Document；列出全部窗口，标记当前及最小化状态，点击后恢复并聚焦。 |
| **Help** | 本地 Desktop Guide、Keyboard Shortcuts、Storage & Browser Capabilities，内容与本版真实功能一致。 |

**File 菜单按应用分派：**

| 当前上下文 | 功能 |
|---|---|
| 桌面 / Finder | New Finder Window、New Folder、New Text File、Open、Rename、Get Info、Move to Trash、Empty Trash |
| TextEdit | New Document、Save、Save As、Export `.txt` |
| Terminal | New Terminal Window |
| Safari | Open Location、Open Current Page Externally |
| Sketch | New Drawing、Import PNG、Export PNG |
| Trash | Restore Selected Item、Empty Trash |
| 所有应用窗口 | Close Window |

**右侧状态栏全部可打开：**

- **电池：**显示浏览器提供的电量和充电状态；不支持时明确显示不可用，移除固定的 `84%`。
- **网络：**显示浏览器在线/离线状态，不虚构 Wi-Fi 名称或硬件开关。
- **搜索：**打开 Spotlight，搜索应用和整个虚拟文件系统中的文件、文件夹名称。
- **Control Center：**切换外观、减少动态效果、Dock 自动隐藏，并提供 Settings 入口。
- **时钟：**当前日期时间，以及支持上月、下月、Today 的月历。

菜单支持方向键、Enter、Escape、子菜单导航、外部点击关闭及焦点恢复。禁用项不能执行；剪贴板权限失败必须明确反馈，Cut 只有在复制成功后才删除文本。Safari 内嵌页面的内容不作为 Edit 菜单的操作对象。

## 3. 窗口、桌面与状态架构

- 将当前按应用 ID 管理窗口的实现改为独立 `windowId`。Finder 各自保存路径、历史和选择；TextEdit 各自保存文档、编辑历史和修改状态；Terminal 各自保存工作目录、命令历史及清理逻辑。
- 保留 vanilla JavaScript、jQuery 和现有静态部署方式，拆分窗口管理、应用控制器、共享文件服务和桌面菜单，避免继续扩展全局变量与固定 DOM ID。
- 明确内部接口：窗口管理提供 `openApp`、`focusWindow`、`requestClose`、`listWindows`；应用控制器提供命令、关闭检查、会话快照和资源清理；共享 `openPath` 负责文件打开。
- Dock 点击聚焦或恢复该应用最近使用的窗口；显式 New Window 才创建额外窗口。同一文本文件再次打开时聚焦已有编辑器，不创建重复副本。
- 最小化、关闭后激活最近使用的可见窗口。窗口尺寸变化或会话恢复后重新约束边界，保证标题栏和控制按钮可访问。
- 桌面直接显示 `/Desktop` 内容，共用 Finder 的单选、打开、重命名、新建、Get Info 和移入 Trash 行为。右键菜单及排序均可用；Get Info 展示现有数据能够支持的路径、类型、大小或子项数量。
- 窗口总览展示所有窗口，选择后恢复并聚焦；Show Desktop 临时隐藏窗口，返回时保留原窗口状态。

**数据兼容与保护：**

- 保留现有文件存储键、v1 格式、容量限制、损坏数据保护和跨标签页防覆盖机制。
- 文件变更通知增加受影响路径，使所有窗口、桌面和 Spotlight 同步更新。新增事务式 `emptyTrash()`，执行前确认，失败时保留原数据。
- 文件夹重命名同步调整相关窗口路径。删除前检查所有受影响的未保存文档；取消则中止删除。
- Terminal 修改已打开文件时，干净编辑器刷新内容；有修改的编辑器保留草稿并提示冲突，不能静默覆盖。
- 设置、会话使用独立的版本化存储。恢复窗口位置、大小、显示状态、Finder 路径、已保存文档和 Terminal 工作目录；无效路径安全回退。Safari 恢复打开时加载指定主页。
- 默认沿用深色外观，增加浅色与跟随系统选项；持久化壁纸、Dock 设置、减少动态效果和时钟格式。

## 4. 应用完善与实施顺序

**Safari**

实现地址验证、Back/Forward、Reload、Home、外部打开及加载提示，只接受 HTTP(S) 地址。历史覆盖 Safari 地址栏和 Home 发起的导航；不承诺追踪跨域 iframe 内部跳转。

默认主页固定为 `https://vectorindex.cloud`。目前未能从检查环境连通该地址，嵌入能力需在实施时实测；始终保留外部打开入口，不把 iframe 的 `load` 事件当作页面成功显示的可靠证据。

**Sketch**

采用固定文档画布与可缩放视口，调整窗口不裁掉图像。实现可靠的 Pointer Events 绘画、画布外释放处理、Undo/Redo、清空、PNG 导入导出。

用独立 IndexedDB 保存最近一个绘画草稿，避免挤占文本文件的 localStorage 配额。完成笔画后自动保存；失败时保留画布并提示导出。新建或导入替换现有作品前确认。

**Calculator**

完成小数、正负号、百分比、连续运算、重复等号和键盘输入；处理除零、显示精度和重新打开后的状态一致性。采用普通计算器的逐步运算模式。

**实施顺序**

1. 完成窗口实例化、共享命令和文件事件基础，同时保持现有文件流程通过测试。
2. 优先交付顶部菜单、状态面板、桌面文件和多窗口联动。
3. 加入 Spotlight、窗口总览、设置与会话恢复。
4. 完善三个应用、移除 Studio、本地化资源并完成整体回归。

脚本、图标、字体及壁纸均随静态站点提供，保留必要许可证。继续使用现有 `develop` → `gh-pages` 发布方式，不改写分支历史。

## 5. 验证与完成标准

- **菜单验收：**逐项验证以上菜单表；覆盖无窗口、不同应用、无选择、只读存储和操作不可用等状态。所有可点击项有实际结果，快捷键、工具栏和菜单执行相同命令。
- **多窗口：**两个 Finder 独立导航，两个 TextEdit 独立编辑，两个 Terminal 独立运行；保存始终作用于正确窗口，关闭一个窗口不影响其他实例。
- **文件安全：**覆盖文件夹重命名、删除涉及多个脏文档、Terminal 修改已打开文件、Empty Trash、配额失败、损坏数据和陈旧标签页。
- **恢复：**旧版文件无需迁移即可使用；设置和保存后的工作区恢复正确；屏幕缩小时窗口仍可操作。
- **应用：**验证 Calculator 运算序列；Sketch 绘画、撤销、缩放、PNG 往返及草稿恢复；Safari 主页、历史、非法地址和无法嵌入时的外部入口。
- **真实浏览器：**补充 Playwright 流程，验证拖动、缩放、菜单键盘操作、模态焦点和窗口总览；在 Chromium、Firefox、WebKit 桌面尺寸下检查。
- **资源与回归：**阻断第三方网络后，桌面和本地应用仍能加载；运行语法/资源检查及全部测试。当前检查已通过，80 项文件与 Terminal 测试通过，DOM 测试需安装已有的 `jsdom` 依赖后运行。

交付包含代码、菜单与应用回归测试、更新后的功能说明和浏览器限制说明。以顶部菜单清单及完整用户流程通过验收作为发布条件。


## Current requested update — 2026-10-25

Status: implementation in progress; source push, Pages publication and final live verification pending. This section is the active extension to the existing plan. Earlier plans and verification history are preserved.

- Personalize this non-fork repository as Sean / Yuxiao Li / Vector Index, using the confirmed https://vectorindex.cloud homepage and concise verified professional facts. Review all eight built-in apps; add useful first-run notes, welcome/project files, Terminal identity, Safari shortcuts and About/source links. Keep credits/licenses. Never overwrite saved notes, files, artwork or browser state. New Document stays blank; ordinary TextEdit launch may open the existing starter notes. Do not publish private resume/contact details.
- Add a versioned URL-encoded JSON startup parameter selecting an exact allowlist of registered built-in apps with nested per-app options, including Safari homepage. No arbitrary modules/code. Validate size, schema, unsafe URLs, duplicate parameters and prototype keys; invalid config visibly falls back. Define precedence and examples/schema. Configuration affects this visit, preserves saved files and does not overwrite the regular stored settings/workspace.
- Preserve this repository's own reconstruction, current deployment URL/integration and existing gh-pages publication. Do not invent an upstream. All custom source edits and remote default use develop. main/master remain read-only; Boot Loader, Win11 and WebVM are outside this writer's scope.
- Validate static assets, existing regressions, new configuration and data-preservation behavior, available browser engines, and actual public Pages flows. Recheck remote heads immediately before nonforce pushes; publish the exact develop site tree through existing gh-pages. Report commit, default branch, build and live checks separately, with remaining blockers. No new paid resources, credentials or security changes.

Application coverage and final evidence: context/PERSONALIZATION.md. URL contract: docs/STARTUP_CONFIG.md (being added).

Verification follow-up: the Windows Chromium run exposed modal Tab focus escaping at the boundary and a viewport assertion racing the resize event. Preserve the required focus/visible-window behavior: add explicit modal focus wrapping and wait for the same final viewport constraint in the test, then rerun targeted and full journeys.

Current update status: source personalization and startup configuration implemented/pushed; existing Pages publication succeeded and production flows verified. Detailed version, tests and live evidence are in context/PERSONALIZATION.md. Chromium/Node/schema checks pass; Windows WebKit PNG Blob storage fails identically on the pre-change baseline, and Firefox launch is blocked by host side-by-side configuration. Full cross-engine verification is not claimed.


## Welcome document follow-up — 2026-10-25

User-authorized narrow exception to first-run-only defaults: enrich Desktop/Welcome.txt with verified Sean / Yuxiao Li professional context and Vector Index links, and update existing saved Welcome.txt only when its full text exactly matches one of the two known untouched bundled legacy defaults. Preserve edited text, renamed/deleted files, notes.txt, Trash and all other filesystem content. Keep the v1 storage format.

Before implementation, record and push this scope on develop. Then use focused RED/GREEN tests for fresh seeds, both untouched legacy texts, edited/missing/non-text preservation, damaged/read-only storage, quota/write failure and stale-tab protection. Reuse the existing transaction path so failed or stale writes retain the original saved data. Run file-store regressions and real browser document/persistence checks before root commits and republishes the exact site tree. No main/master changes.

Welcome follow-up delivered: richer copy and exact-default migration pushed in bf301a05e395b72c615806920b3cc4a0b05121cc; existing Pages publication 857655811e28eaa02016f1f3dbafe6dd29cc559e succeeded (run 40206081997). 181 Node tests, 26 Chromium journeys and isolated mobile fresh/legacy/edited/deleted cases passed. The real existing Chrome document upgraded from the exact untouched generic default to the richer welcome without a storage reset. App source tree matches the publication; browser-host limitations from the earlier record remain explicit.


## Canonical welcome rollout — 2026-10-27

Active scope supersedes the earlier rich Welcome copy. The approved immutable text comes from DOT_NOTES projects/repos/boot-loader/welcome.md at bb681b8fd0085af3cc15ef02e6da1b955404e5ce: 525 UTF-8 bytes, Git blob fe7e9edba1d4cbbe07d44e43dea42bd5e3f234b7, SHA256 8CFADE6F56F8046D1A2DEAE329E43D3F024095917D18DC11E436B095D9C9FB36, no trailing newline. Use it exactly for fresh Desktop/Welcome.txt and fresh Documents/notes.txt because normal TextEdit launch opens notes.txt. Do not append headings, storage notices or credits to this text; existing Help/About/Project and license surfaces remain separate.

Work from verified develop 48c7b88b1bba8013ac43335cbcaae5fbf36528b0 on a feature branch and draft PR to develop. Retain both original exact Desktop Welcome legacy defaults and add the immediately previous untouched 725-character rich copy. Migrate only those exact Desktop Welcome values. Preserve every saved Documents/notes.txt value including previous seed, edited and empty values; do not recreate deleted/renamed/non-text/trashed files. Preserve v1 schema and existing transaction/error/stale protections and startup behavior.

Verify the committed canonical fixture by exact bytes, Git blob and SHA256; use RED/GREEN tests for fresh defaults and the added legacy migration, then all existing Node/noninteractive DOM tests and static checks. No user-browser/CUA control is authorized. Publish only after independent root review and normal PR merge; recheck remote heads and preserve current gh-pages history with a normal fast-forward of the exact merged develop site subtree. Verify Pages CI and served JavaScript/default text plus fresh, legacy, edited/empty and deleted safety noninteractively. No main/master changes, new credentials/security changes or unrelated edits.

Baseline remote heads checked: develop 48c7b88b1bba8013ac43335cbcaae5fbf36528b0; gh-pages 857655811e28eaa02016f1f3dbafe6dd29cc559e; main abd30e72e79748ca7d634edd217f2425fc3f602d. Status: implemented on feature/canonical-welcome-20261027 with draft PR https://github.com/yuxiaoli/macos/pull/1. Both focused requirements failed before their changes and passed afterward; 184 Node tests (including noninteractive DOM) and static checks pass. Fixture Git blob, SHA256 and 525-byte length match; targeted -text attribute prevents newline conversion. Independent root review, normal PR merge and exact merged-develop Pages publication remain pending.


## Current welcome-copy privacy follow-up — 2026-10-27

Current-source cleanup only: remove the previous Welcome biography and its direct plaintext copies from migration recognition, tests and the welcome-specific historical description in context/PERSONALIZATION.md. Keep the canonical 525-byte welcome immutable and preserve unrelated About/Profile/Project identity, upstream attribution and licenses. This is not a Git/history/provider/local-erasure operation. No history rewrite, force push, protected branch write, credentials/security change or browser UI is authorized.

Start from clean verified develop 6eba57acc4944333a4162335e652ce188779dccb on feature/welcome-fingerprints-20261027 with a draft PR. Replace the three literal defaults with exact UTF-16 length / UTF-8 byte length / SHA256 fingerprints. Keep constructor and persistence synchronous, reject malformed UTF-16 without normalization, and retain v1 transaction/error/stale protections and edited/empty/deleted/renamed/non-text/Trash/saved-note preservation. Bound startup hashing by the known short lengths before computing digests.

Use RED/GREEN SHA256 differential tests against native Node crypto (standard, padding-boundary, Unicode, NUL, normalization and malformed-surrogate cases) plus synthetic same-length fingerprints for the migration safety matrix, with no raw/encoded/reconstructive biography fixtures or log/PR copies. Production metadata is fixed and checked. Independent root review will transiently read historical Git inputs in memory and verify all three real legacy cases without copying them into new artifacts. Run npm test and npm run check, then wait for independent review before ready/normal merge. Publish only the exact merged develop site subtree via the existing normal fast-forward gh-pages flow, then scan served JavaScript for absence of the welcome-derived biography and verify canonical text and safe migration noninteractively. Report retained historical/provider/local exposure explicitly; no erasure claim.

Baseline heads: develop 6eba57acc4944333a4162335e652ce188779dccb; gh-pages 42391f0463769d1ac8c9bb5639cb946f85a72ac2; main abd30e72e79748ca7d634edd217f2425fc3f602d. Default branch verified develop. Status: implemented on feature/welcome-fingerprints-20261027 with draft PR https://github.com/yuxiaoli/macos/pull/2. SHA256 conformance and metadata checks followed RED/GREEN. All 189 Node/noninteractive DOM tests and static checks pass, current-tree raw/escaped direct-legacy scan is clear, and canonical fixture blob remains unchanged. Independent reviewer transiently validated real historical upgrades, Unicode/edit negatives and storage failures without new plaintext fixtures. Await final committed-head review before normal merge/publication; historical/provider/local exposure remains.
