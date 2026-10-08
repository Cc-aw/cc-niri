# Core UX P3 — Column Width Controls 实现与验收记录

日期：2026-10-07。依据 [Core UX 设计](../doc/todo/CC-Niri%20Core%20UX%20下一阶段实施设计.md) 实施。**最新范围：按用户要求撤回 third / twoThirds，只保留 Meta+R / Meta+F 的 half ↔ Full；niri resize 协调和部分可见窗口裁剪暂停。下文四档与实验验收记录为历史，不代表当前生产实现。** 最新验证与部署见文末。

## 原四档实现行为与持久化（已延期）

| 快捷键 | 动作 | 行为 |
| --- | --- | --- |
| Meta+R | CCScrollCycleColumnWidth | third → half → twoThirds → full → third |
| Meta+F | CCScrollToggleColumnFull | 非 Full → Full；Full → 先前非 Full 宽度 |

ColumnWidthController 只选择当前实际活动的受管列，不寻找 remembered Column。Fullscreen、浮动、副屏、无活动列、禁用布局和工作区切换期间 no-op。列顺序和焦点保留；退出 Wide / 安全区域最大化展示，保留 persistentWide 偏好。Full 与 P2 一样占 100% Safe Area，并使用普通列条带。

`previousNonFullWidthMode` 只允许 third / half / twoThirds。进入 Full 保存当前非 Full 宽度；循环从 Full 进入 third 时更新为 third；Meta+F 从 Full 恢复保存值。ColumnStore 初始化、WorkspaceSnapshotStore 归一化、capture / hydrate、workspace transfer 和活动工作区 adoption 一起保留此字段。旧普通列无记忆时使用当前非 Full 宽度，旧 Full 或无效记忆回落 half。JS schema 保持 protocol 1/2；Bridge 已能原样保存该字段，生产 C++ 无需改变。

宽度操作使用现有 LayoutTransaction / LayoutEngine / GeometryCommitter / StabilitySupervisor，取消旧 Scroll / Wide ACK、待处理 reveal 和 deferred parking，清除旧 presentation 恢复上下文。新几何作为同一布局批次提交；不新增 resize Spring、动画时钟或每帧 JSON 工作，不改变 H/L、Wide 或 WorkspaceMotion 参数。Rust Core / FFI、Native Ring owner 与工作区选择保持。

## 快速切换修复

首次实机验证发现连续 Full 往返后，JS 已回到 twoThirds，但真实窗口仍为 Full。GeometryCommitter 仅检查当前 frame 是否等于目标；Wayland 客户端尚未确认 Full 请求时，当前 frame 仍是 twoThirds，因此切回被跳过，待确认的 Full 最终生效。已自动回滚该次部署并恢复原布局和原生最大化绑定。

修复后的提交器同时检查 `scrollLastRequestedGeometry`：实际 frame 等于目标但最后请求不同，仍发出最终目标，以覆盖旧 configure；实际和最后请求都已稳定时继续跳过重复写入。缓存为 WindowState 中的瞬态副本，不进入 workspace persistence。新增可延迟 frame ACK 的生成运行时 fixture，先复现该故障，再验证快速切换得到最终尺寸，且稳定布局不产生重复几何写入。没有引入定时重试或第二套几何 authority。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `node tools/build.js` / `--check` | 通过，生成布局包与 src 一致 |
| ShortcutCatalog / runtime entry | 通过：Meta+R / Meta+F 的动作、默认键、处理器接线；旧 presentation 快捷键没有恢复 |
| 宽度运行时回归 | 通过：四档循环、三种非 Full 往返、尾列 clamp / reveal、焦点和顺序、Full 记忆、J/K / reload、workspace transfer 及活动 adoption、旧/无效快照回落 |
| 生命周期 / ACK 回归 | 通过：Scroll publish / Native arm / Wide ACK 迟到不能覆盖新宽度；实际活动窗口优先于待激活目标；工作区切换、浮动、副屏、Fullscreen、无活动窗口和禁用 no-op；安全区域最大化退出与 Fullscreen 恢复 |
| 延迟几何 ACK 回归 | 通过：待确认 Full 后切回旧尺寸仍覆盖请求；客户端最终 ACK 使用新目标；稳定几何跳过重复写入 |
| `cargo fmt --manifest-path native/rust/Cargo.toml --all --check` | 通过，完整门禁执行 |
| `cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings` | 通过，完整门禁执行 |
| `cargo test --manifest-path native/rust/Cargo.toml --locked --workspace` | 通过，30 单测 |
| `node tools/check.js --native` | 修复后重新完整执行并通过：92 JS 回归、Bridge 16 CTest / 3 隔离 D-Bus、Clip 15 CTest、Ring 22 CTest、Plasmoid 构建、三个生产符号边界，包含既有 Golden differential |

Bridge 对象测试与隔离 D-Bus 覆盖 Full 和 previousNonFullWidthMode 的 protocol 1/2 落盘、重连 / 重启恢复；原有宽度一致性与 generation / authority 规则保持。完整门禁在允许创建隔离测试总线的环境执行。

未修改 CMake / Core / FFI / Qt 转换，未另行重复 Core Debug / Release、umbrella 或 BUILD_TESTING=OFF 矩阵。门禁日志：`/tmp/cc-niri-core-ux-p3-native-gate.log`；初次纯 JS 门禁日志：`/tmp/cc-niri-core-ux-p3-js-gate.log`。

## 部署与实机核验

沿用 save-current-state / cc-niri stop / KPackage upgrade / cc-niri start 更新布局包，Native immutable 插件不替换。本机 Meta+F 原先由 KWin“最大化窗口”占用，已改为 Meta+PgUp；Meta+R / Meta+F 分别登记到上述新动作。实际 KGlobalAccel 键值与 owner 已核对；仓库默认快捷键继续尊重已有自定义绑定，不在每次 start 时强制覆盖其他用户动作。

修复版在 DP-1 **3840×2160@60Hz / 150%**、2560×1440 逻辑屏幕上，通过 KGlobalAccel 调用新动作，依次验证四档循环、half ↔ Full、twoThirds → Full、H/L、J/K、`cc-niri restart`、重启后 Full → twoThirds，以及连续 **6 次 Full 切换**。每个稳定状态由只读临时 KWin 探针核验真实宽度：third **832**、half **1252**、twoThirds **1672**、Full **2512**；高度始终 **1382**，Full frame 为 **`24,50 2512×1382`**。Bridge 保存的 width / memory 与真实尺寸一致，窗口活动、非 fullscreen、非 minimized，Native Rust Ring owner 匹配该窗口。全部探针已卸载。

原有列宽、UUID 顺序、persistentWide、视口、主屏工作区与焦点已恢复；过程中新出现一个原生窗口，按现有 reconcile 规则保留并追加为 half，没有关闭、删除或覆盖新窗口。初始核验脚本静态比较整个列数组因此报错，后续只读核验确认原有 UUID 完整恢复、新列 half / memory half，部署与宽度测试本身已通过。

布局包与仓库字节一致；Native 两个插件、Bridge、CLI、动画包及 Plasmoid 的哈希与 canonical 路径不变。KWin PID **2050** 保持，主副屏输出、独立工作区模式、边距、副屏窗口几何和 **420ms** WorkspaceMotion 设置保持。实机时段日志无 TypeError / ReferenceError / SyntaxError、INVARIANT_FAIL、FAIL_SAFE、completion timeout 或 Rust panic。

修复版交互核验时间 UTC **2026-10-07T02:44:21.787899+00:00 — 02:44:32.697853+00:00**，恢复与部署核验见同目录 `restore-verification.json` / `verified.json`。未发送物理按键；动画连续性、Ring 视觉效果及 parking 无闪现仍需人工确认。未实机切换 Fullscreen、最大化或迁移真实应用，这些边界由运行时测试覆盖；未测量 FPS / GPU 性能，未更改显示配置。

## 回滚与后续

本阶段为独立提交。回退 P3 并重新生成、安装布局包即可回到 P2；P2 仍识别 Full，但忽略恢复记忆，Meta+R / Meta+F 新动作停止工作。要恢复本机部署前原生最大化快捷键，可在系统设置中将 Full 动作解绑，再将“最大化窗口”恢复为 Meta+F；对应快捷键配置已备份。原有列宽与工作区偏好已恢复，新增窗口保持默认 half。

修复版备份与审计：`/tmp/cc-niri-core-ux-p3-live-y_zfcsl3`；指针：`/tmp/cc-niri-core-ux-p3-live-path`；部署日志：`/tmp/cc-niri-core-ux-p3-install.log`。首次失败与回滚证据保留于 `/tmp/cc-niri-core-ux-p3-live-0_pvjat_`、`/tmp/cc-niri-core-ux-p3-first-install.log`。`/tmp` 可随重启清除。

人工验收可用 Meta+R / Meta+F 设置 A half / B full / C half，执行 H/L、快速 L L H、J/K 和重启，确认 Full、宽度恢复记忆、动画与 Ring。P4 继续实现 Meta+Shift+J/K 相邻工作区 move-and-follow。

## 2026-10-07 宽度动画修复：按 niri 接续 resize / view motion

用户报告 B 从 half 扩宽时覆盖 A，循环回 half 后显示 B｜C。前者属于动画缺陷；后者是视口最小 reveal 的结果，窗口 UUID、顺序和焦点没有替换。按用户确认，本次不增加“循环一圈恢复 A｜B”的记忆或强制回滚视口。

参考 niri 提交 `ed22699d99462f61ab171472d3ea67e844ea580d` 的 [column resize / view offset 协调](https://github.com/niri-wm/niri/blob/ed22699d99462f61ab171472d3ea67e844ea580d/src/layout/scrolling.rs#L1278)、[从 current view offset 接续](https://github.com/niri-wm/niri/blob/ed22699d99462f61ab171472d3ea67e844ea580d/src/layout/scrolling.rs#L715)、[最小视口移动](https://github.com/niri-wm/niri/blob/ed22699d99462f61ab171472d3ea67e844ea580d/src/layout/scrolling.rs#L5588) 和 [tile resize 从当前动画尺寸接续](https://github.com/niri-wm/niri/blob/ed22699d99462f61ab171472d3ea67e844ea580d/src/layout/tile.rs#L272)。niri 的各动画共享 clock / config；本仓库在现有 Rust ViewportMotion 上实现同一个归一化进度来插值整组列矩形，不声称两者内部状态结构相同，也不引入速度继承。

修复前的宽度命令只提交最终 geometry，Script Effect 的尺寸过滤 / half-Wide 分类又不覆盖任意宽度组合。现在 JS 在修改宽度前捕获完整 strip / presentation 矩形，沿用 Scroll v2，添加可选 `layoutTransition` 和逐列 `oldRect`；Bridge observer 与 Runtime 使用同一 Rust validator，拒绝类型错误、缺失矩形、非法尺寸和 placement。普通 Scroll 消息保持原格式和 Golden 行为。

Native ACK 安装唯一 owner 后，JS 才提交实际 geometry。Rust 插值窗口宽高、邻居位置与视口变化，C++ 将投影转换为 paint translation / scale；快速 R/F 或 H/L 从最后绘制矩形接续，迟到的 Wayland configure 不改变绘制矩形。Script Effect 对有效的 resize owner 不再启动第二套分类动画。Outgoing 保持可绘制直到当前 epoch 完成，再由 JS 停车并 disarm；旧 ACK、工作区切换和已退出受管集合的窗口不能继续写回。J/K 中途切换时，C++ Adapter 仅保留 Rust handle 的冻结快照：离开桌面的 scale / translation 使用最后绘制姿态，clip 跟随独立工作区相机移动；compositor 工作区 owner 空闲后释放，不另采样 Spring 或添加时钟。

没有引入另一套 focus / workspace / layout authority，没有修改旧 Scroll、Wide、WorkspaceMotion 参数或 frozen C++ oracle。动画完成后的整窗可见 / 停车规则保留：KWin 的 [findToplevel / hitTest](https://github.com/KDE/kwin/blob/Plasma/6.7/src/input.cpp#L3454) 使用实际输入区域，Effect paint clip 不会同步裁剪输入，因此本次不增加长期跨输出的半露窗口。动画中的虚拟 outgoing 仍由 viewport clip 限定。Meta+F 的非 Full 宽度记忆保持原语义。

新增 `column-resize-motion.test.js`、Rust resize 契约及 Qt/FFI / Bridge / 隔离 D-Bus 用例，覆盖每帧邻居 8px 间距、旧 / 新混合 configure、连续六次 retarget、resize 中途 H/L、Wide painted handoff、非法协议、零分配和 JS scoped parking。新增 opt-in `StartColumnFrameCapture` / `GetColumnFrameCapture` 仅供实机诊断：固定 2048 槽 / 8 秒，paint 只记录数值，JSON 在查询时生成，默认不采集；记录投影参数不能替代人工视觉验收。

本轮验证、部署与实机结果见下方追加记录。

### 本轮验证与部署结果

最终 `node tools/check.js --native` 全部通过：**93 JS 回归、35 Rust 单测、Bridge 16 CTest / 3 隔离 D-Bus、Clip 15 CTest、Ring 22 CTest、Plasmoid 构建和三项生产边界**。Rust fmt / clippy `--locked` / `-D warnings` 通过。Core Debug / Release 构建与 CTest 各 11 项通过；Native umbrella Debug 最终构建 / CTest 26 项通过；`BUILD_TESTING=OFF` 两插件与 Bridge 构建通过，没有 oracle targets / 生产 Legacy policy 符号，GNU16 通过、GNU15 / GNU17 / Clang / 非指定路径拒绝用例通过。冻结 Golden corpus 全部保留并通过，新 resize 行为另有独立契约。早期完整门禁发现 Qt JS 引擎不支持对象展开，已改为 `Object.assign`，KWin syntax 和最终全门禁均通过。

沿用完整 `install.sh` 的保存状态 / stop / immutable install / start 路径部署两个 Native 插件、Bridge、布局包和动画包。独立 DESTDIR 安装字节与实际产物一致，新诊断接口可查询；布局脚本、三项 Effect、Bridge / Plasma 运行正常，所有 Core / protocol 后端为 Rust。KWin PID **2050** 保持；输出 JSON、主屏独立工作区、**420ms** WorkspaceMotion、Meta+R/F 和 Meta+PgUp 原生最大化绑定保持；部署前后列 UUID / 顺序 / 宽度 / 恢复记忆、工作区 / 焦点、presentation / viewport anchor 全部一致。部署观察日志没有 TypeError、ReferenceError、SyntaxError、INVARIANT_FAIL、FAIL_SAFE、completion timeout、native fallback 或 Rust panic。

会话始终锁屏（`ScreenSaver.GetActive=true`），因此 **未执行本轮实际 R/F / H/L / J/K / Wide / Fullscreen / Ring off-on 交互、未采集中间绘制帧、未测 FPS / GPU 性能，人工视觉验收待反馈**。自动回归验证了数值连续性与几何边界，不能据此宣称实机无重叠或已达到 60 FPS。Opt-in paint 采集脚本已准备在 `/tmp/cc-niri-column-resize-live.py`，须在解锁后执行；不更改锁屏、电源或显示设置。完整门禁日志：`/tmp/cc-niri-column-resize-native-gate-final.log`；部署日志：`/tmp/cc-niri-column-resize-install.log`；备份与核验：`/tmp/cc-niri-redeploy-20261007-fugy1fhg`。

FFI DTO 本次扩展，回滚须同时恢复两个 Native 插件、Bridge 和两个 JS 包，不能只回退布局包。已保存旧 immutable 插件与完整已安装运行时，可执行：

```sh
python3 /tmp/cc-niri-redeploy-20261007-fugy1fhg/rollback.py
```

回滚通过原有 stop / 旧 canonical 链接与运行时恢复 / start 流程执行，不恢复生产 C++ Core。`/tmp` 可随重启清除；旧 canonical 插件仍保留。测试代码和生产路径使用 Rust 1.99.0 / GNU16，没有添加依赖或修改 Cargo.lock；本轮未创建 Git 提交。

## 2026-10-07 niri 部分可见窗口

按用户要求补齐上述宽度动画修复未启用的部分可见规则，参考 niri 同一提交的 [scrolling render](https://github.com/niri-wm/niri/blob/ed22699d99462f61ab171472d3ea67e844ea580d/src/layout/scrolling.rs#L2946)：普通滚动布局以窗口与 Safe Area 的**正面积交集**决定 visible，只有完全离屏才 parked。保留完整窗口宽度和 UUID；不把内容缩小到露出的区域，不增加循环后恢复 A｜B 的记忆。Wide / maximize / fullscreen 的独立 presentation 规则继续使用既有路径。

`clipPartial: true` 为 Scroll v2 的可选、严格布尔字段，与 layoutTransition / oldRect 一起校验。旧 envelope 和 frozen Golden oracle 不改；JS 提供布局与 placement authority，Rust 校验交集并决定持久裁剪、输入边界与目标几何匹配。FFI Plan 使用原有对齐空间，大小仍为 **184 bytes**；status 的 reserved bits 分别表示 layout interpolation / partial clip。新增查询同步借用 handle，不分配内存。

Native 完成后，JS 只停放 fully-outgoing，部分窗口保留静态 Core owner；完成轮询和 watchdog 停止，静态 owner 不持续请求 repaint。新布局从同一 owner 接续；取消 / 停止时安全停放部分窗口，Native 拒绝或不可用时回落到原有整窗显示规则。工作区 mount 现在先通过现有 commitDockState 发布已经挂载的 JS snapshot，再发布部分可见 Scroll plan，防止 Bridge 以旧工作区 membership 拒绝计划；没有放宽 Bridge authority 校验。

KWin 6.7 的 [原生 hit testing](https://github.com/KDE/kwin/blob/Plasma/6.7/src/input.cpp#L3454) 不读取 Effect clip，也没有公开的窗口输入区域 setter。Adapter 在输入查询期间使用公开的 hidden-by-desktop predicate 排除视口外的受管窗口，先持有 scene visibility ref，保证应用不被 suspend、绘制状态不改变；事件循环空闲和 prePaint 前恢复标记，停止、关闭和实际 Showing Desktop 时释放引用并尊重原生状态。Pointer / touch / tablet 事件继续通过 KWin 的 native hit testing、surface input region、装饰、implicit grab 和 action filters，不注入点击或新增布局 / 焦点选择 authority。其他 fullscreen scene owner 接管时停用这一适配及持久 strip projection。窗口 geometry ACK 导致 center 越过输出边界时，仅对 Rust 已接受的目标恢复原输出；显式迁移和 interactive move 不固定输出。

| 最终检查 | 结果 |
| --- | --- |
| Rust fmt / clippy `--locked` / workspace test | 通过，**38 单测**；partial query / target ownership 1000 次零分配 |
| `node tools/build.js --check` / `node tools/check.js --native` | 通过，**94 JS**，含部分可见、静态裁剪、缺失 Native 回退和 mount 发布顺序回归 |
| Bridge / Clip / Ring | **16 / 15 / 22 CTest** 与 **3 个隔离 D-Bus** 通过，含严格 partial schema、交集 placement、重复 envelope |
| Core Debug / Release，umbrella Debug | 各 **11**、**26 CTest** 通过，保留 Golden differential 和编译器拒绝检查 |
| `BUILD_TESTING=OFF` 两插件与 Bridge | 构建与生产符号边界通过，无 reference target / 旧 C++ 算法 |

沿用完整 `install.sh` immutable 流程部署；随后只用 KPackage upgrade 更新 mount 顺序修复。安装产物与仓库、独立 DESTDIR 暂存哈希相符；Rust 后端、主副屏配置、主屏独立工作区、420ms 曲线及 KWin PID **2050** 保持。

未锁屏实机核验 UTC **2026-10-07T06:41:55.696450+00:00 — 06:42:06.591634+00:00**：A half / B twoThirds 后，A frame 为 `-396,50 1252×1382`，仍可见且未 minimized；B third 时右侧部分窗口 frame 为 `2124,50 1252×1382`，仍归属 DP-1。`GetViewportHitTest` 在主屏 `(100,700)` / `(2400,700)` 命中对应部分窗口；副屏 x=2600..3200、y=700 的 **7 个点** 均未命中被裁掉的主屏列。它使用与实际输入适配相同的 KWin hit test，并同步恢复临时标记；未发送物理点击。

真实 paint 采集覆盖 resize、连续 6 次 R/F、resize → H/L、resize 中 J/K 往返、Wide → resize，共 **881 条窗口绘制样本 / 361 对可见相邻样本**。按同 epoch、同 paint batch 与 viewport 正面积交集检查，没有可见重叠，最小间距 **7.999853px**（设定 8px）。视口外完全不可见的矩形不作为可见重叠；这些样本数不是 FPS。Ring owner、停止 / 重启和新 session 核验通过；原有列宽、记忆、焦点、副屏窗口几何和边距恢复。最终时段日志无 TypeError / ReferenceError / SyntaxError、invariant fail、fail-safe、completion timeout、Rust panic 或 native fallback。

人工观感、真实点击 / 拖动 / 多点 touch / tablet、fullscreen / Overview 以及缩放动画中客户端坐标命中尚未逐项实机验收；现有 KWin 动画输入坐标仍使用实际 frame，未增加动画逆变换或手写 surface 路由。未测 FPS / GPU 性能、热插拔、长期压力。已有会话显示正常和自动命中查询不替代这些检查。

证据与回滚备份：`/tmp/cc-niri-redeploy-20261007-jo2dv968`（animation-results / frames / windows / journal / partial-final）；完整门禁 `/tmp/cc-niri-partial-native-gate-final.log`，安装 `/tmp/cc-niri-partial-install.log`，实机 `/tmp/cc-niri-partial-live.log`。回滚使用该目录 `rollback.py`，按原有 stop / 旧 immutable 插件与 Bridge / 两个 JS 包 / 偏好 / start 流程整体恢复；不要只替换单个 ABI 消费者。`/tmp` 可能随重启清除，用户自己的 `doc/todo/cc-niri_4K60Hz_Animation_Codex_Spec.md` 未修改。


## 2026-10-07 用户要求暂停三分之一宽度

用户报告 Zed twoThirds 输入时左侧窗口消失，J 离场也丢失左侧窗口，随后明确要求撤销 1/3、2/3，暂缓开发，只保留 Full。生成运行时复现到：未受管的编辑器 transient 弹窗经过 WorkspaceTransferController，误取消全局持久裁剪；workspace-shortcut 准备阶段也提前取消，DeferredScrollParking 因而将部分窗口移到 parking 并最小化。该实验路径没有完成用户验收，本次按要求撤下，不继续扩展它。

生产 Native / FFI / Script Effect 和 Scroll 布局恢复为已提交的 `312b1f0` 基线；Rust 继续是唯一生产 Core。此次实验的改动 patch 与新增测试备份在 `/tmp/cc-niri-width-pause-20261007-145653`，源码移除实验 resize / clipPartial / 输入过滤 / 跨输出固定 / column capture 路径。已有 Wayland pending configure 修复、普通 Scroll / Pair-Wide / WorkspaceMotion / Ring 和 P2 Full 保留。

Meta+R 与 Meta+F 都在 half / full 间切换。ColumnStore、ColumnLayout 和 WorkspaceSnapshotStore 只输出这两档；protocol 1/2 旧快照在 hydrate 前将 third / twoThirds 迁移为 half，所有 previousNonFullWidthMode 回归 half；含旧分数宽度的工作区 anchor delta 归零，UUID、顺序、工作区归属与 Full 保留。Bridge 的旧数据兼容格式不变，迁移由 JS authority 执行。

回归保留 Full 快速切换覆盖迟到 Wayland configure、旧 Scroll / Wide ACK 失效、H/L、workspace transfer / reload、Fullscreen / floating / 副屏 no-op；新增旧快照迁移、休眠工作区 Full 记忆迁移、编辑器 transient 弹窗和 workspace-shortcut 准备阶段双列保持用例。旧 fraction 用例改为显式迁移检查；普通生命周期的宽度记忆测试使用受支持的 Full。

最终 `node tools/check.js --native` 通过：**92 JS 回归、30 Rust 单测**，Rust fmt / clippy `--locked` / `-D warnings`、Bridge **16 CTest / 3 隔离 D-Bus**、Clip **15 CTest**、Ring **22 CTest**、Plasmoid 和生产符号边界全部通过。Core Debug / Release 各 **11 CTest**、Native umbrella Debug **26 CTest** 通过，包含 Spring / Motion / Scroll / Ring / Native Protocol Golden differential、WorkspaceMotion 和编译器拒绝检查；`BUILD_TESTING=OFF` 两插件与 Bridge 构建及无 reference target / Legacy policy 符号检查通过。Rust 测试 38→30、JS 94→92 是撤下本轮实验扩展和对应测试，既有 Golden / Workspace / Ring 检查保留。

按完整 `install.sh` 的保存状态 / stop / immutable install / start 流程部署。Clip 恢复为 `e4e5fce6f2b18a3705a91079ab35b8c0d489277a54e1b3d9200c16142eca1e05`，Ring 为 `aa7154bd4e1ff9f211034aa95693f2e5885486dfa19ddcb00a54c6961ec3b461`，与此前已验收 R7 standalone 基线一致；Bridge、两个包与独立 DESTDIR 安装产物哈希匹配。KWin PID **2050**、主屏 **4K 60Hz / 150%**、副屏几何、主屏独立工作区、420ms 曲线和边距设置保持。

未锁屏实机状态核验 UTC **2026-10-07T07:10:02.325007+00:00 — 07:10:09.646390+00:00**：通过 KGlobalAccel 执行 R / R / F / F、连续 6 次 R、H/L、J/K、停止重启；实际 Full frame 为 `24,50 2512×1382`，half 宽度为 **1252**，窗口 UUID、活动状态与 Rust Ring owner 一致。J 离场早期只读探针确认原双列均未最小化；两次 desktopChanged 均属于 DP-1。重启后新 session、half / Full 与记忆一致；最终恢复测试前已归一化的 workspace / columns / focus / presentation / anchor，副屏窗口与边距前后相同。观察日志无 TypeError / ReferenceError / SyntaxError、invariant failure、fail-safe、completion timeout、native fallback 或 Rust panic。没有向编辑器注入文字；Zed 真实输入和人工观感仍待用户反馈，不将状态核验称为完整视觉验收，也未测试新的 1/3、2/3 或宣称其缺陷已通过继续开发解决。

完整门禁日志 `/tmp/cc-niri-half-full-native-gate-final.log`；Core / umbrella 日志 `/tmp/cc-niri-half-full-{Debug,Release,umbrella}.log`；安装与实机日志 `/tmp/cc-niri-half-full-{install,live}.log`。安装备份、哈希核对、原布局、窗口探针、Workspace framePresented 与 journal 位于 `/tmp/cc-niri-redeploy-20261007-g1h5a0nx`。如需整体恢复本次部署前的实验版本，使用其中 `rollback.py`；保持 Native 插件 / Bridge / 两个 JS 包配套，不单独替换 ABI 消费者。`/tmp` 可能随重启清除；旧 immutable 插件仍保留。用户自己的 4K60Hz 文档未修改；本轮未提交 Git。

## 2026-10-07 half / Full 复用旧动画

用户反馈撤下实验功能后 Meta+R 没有动画，要求按既有架构复用旧动画。原因是 ColumnWidthController 直接提交 Full geometry，而 Script Effect 的几何推断只识别 65%–85% 的 contextual Wide，100% 不进入该分支。本次让 Meta+R / Meta+F 的 half ↔ Full 显式发布现有 protocol-1 Pair/Wide **视觉事务**；Full 仍是持久列宽，logical viewport 为 pair、presentation 为 normal，persistentWide 偏好保留。没有恢复 third / twoThirds、实验 Rust resize graph、部分可见裁剪或输入过滤。

JS 在改宽度前捕获真实 target / 邻窗矩形，复用 LayoutEngine snapshots、MotionPlanCommitGate 的发布先于 geometry ACK、ContextualWideCoordinator 的延迟停放与退出 geometry ACK，以及 Script MotionController 的 Scale / Translation / Opacity、OutCubic、Native viewport clip 和完成回调。时长沿用原有 `PresentationDuration`：代码默认 220ms，本机既有配置 **300ms** 保持。Core / FFI / Spring 与 WorkspaceMotion 参数不变，没有新时钟或布局 / 焦点 authority。Bridge 与 Native Adapter 只扩展既有 DTO 转换：允许一个 target 的 solo 事务，转发显式 Safe Area；两窗 legacy Wide 继续使用原协议。

retarget 时在现有 MotionController 内将采样的绘制矩形换算到新的真实尺寸和 anchor，避免快速 Full 反向时沿用相对旧 frame 的 scale；迟到 Wayland configure 被当前 frame 的请求覆盖、没有 geometry signal 时，也由现有 plan marker 接续动画。邻窗在正常扩展和 J/K 离场期间保持真实半宽窗口，动画完成后或 compositor workspace owner idle 后才停放；编辑器 transient 不退役该邻窗。

| 最终检查 | 结果 |
| --- | --- |
| Rust fmt / clippy `--locked --all-targets -D warnings` / workspace test | 通过，30 Rust 单测；依赖、lockfile、FFI 不变 |
| `node tools/build.js --check` / `node tools/check.js --native` | 通过，93 JS 回归；新增真实布局包与 Script Effect 联动的 Full 动画测试 |
| 动画回归 | 左右扩展 / 收缩在采样点保持 8px 间距、publish 先于真实提交、单列、10 次反向 retarget、延迟 Wayland ACK / 无 geometry signal、编辑器 transient、J/K 冻结与 idle parking |
| Bridge / Clip / Ring / Plasmoid | 16 / 15 / 22 CTest、3 个隔离 D-Bus、构建与生产符号边界通过；Bridge 新增 solo target 接受及无效数量 / role 拒绝用例 |
| Core Debug / Release，Native umbrella Debug | 各 11、26 CTest 通过，包括冻结 Golden differential、WorkspaceMotion 与编译器拒绝检查 |

按完整 `install.sh` 的保存状态 / stop / immutable install / start 部署，独立 DESTDIR 安装产物与当前安装哈希一致；全部 Rust 后端、KWin PID **2050**、主副屏配置、主屏独立工作区、420ms WorkspaceMotion、原有边距与动画时长保持。

未锁屏实机核验 UTC **2026-10-07T07:38:30.192850+00:00 — 07:38:51.378169+00:00**：两个活动列分别 R 扩展 / 收缩、连续 6 次 R、H/L、Full 扩展途中 J/K 往返、72% Wide → Full、Fullscreen 进出与宽度 no-op、Ring off/on、停止重启通过。KWin 日志确认实际启动 Scale / Translation / Opacity，两个方向均完成，快速操作触发 retarget；邻窗 incoming 沿既有 timeline 使用剩余时长。J 离场早期探针确认原可见窗口均未最小化；返回保持 Full，half / Full frame 为 **1252 / 2512×1382**，Ring owner 正确。临时 debug logging、原工作区 / columns / focus / presentation / anchor 均恢复，副屏窗口几何与设置前后一致。日志无 JS 异常、invariant fail、fail-safe、handoff timeout / reject、Rust panic 或 native fallback。

人工视觉感受仍待用户反馈；状态与动画启动 / 完成日志不替代视觉验收。单列与无 geometry signal 的连续性来自自动回归，未另外创建实机窗口验证单列；没有注入编辑器文字、测量 FPS / GPU 性能、长期压力或热插拔。

完整门禁 `/tmp/cc-niri-full-animation-native-final.log`；Core / umbrella `/tmp/cc-niri-full-animation-{core-Debug,core-Release,umbrella}.log`；安装 / 实机 `/tmp/cc-niri-full-animation-{install,live}.log`。安装备份、窗口探针、动画日志与最终状态位于 `/tmp/cc-niri-redeploy-20261007-_82p7xq2`；回滚到本次修复前的 **half / Full 基线**可执行该目录的 `rollback.py`，配套恢复两个 Native 插件、Bridge 与两个包，不恢复分数宽度实验。`/tmp` 可能随重启清除。用户自己的 4K60Hz 文档未修改；本轮没有创建 Git 提交。


2026-10-07 用户反馈“已经通过”：记录本次 half / Full 复用旧动画的用户实机验收通过。该反馈不恢复 third / twoThirds 或部分可见实验，也不扩大为 P4–P8、单列实机、FPS / GPU 性能或长期压力验收通过。

## Full / half 相邻窗口可见性修复（2026-10-07）

复现：Full A（2512px）+ half B（1252px）聚焦 B 后，offset 1260，A 的投影为 x=-1236、width=2512，仍有 1252px 进入 Safe Area。原 `isRectFullyVisible` 把 A 标为 outgoing，Spring 完成后将其停放并最小化，造成左半屏空白。

half / Full 普通条带现在以正面积交集决定 placement。JS 发布 `clipPartial: true` 的 Scroll v2；Rust 严格校验布尔字段、交集、epoch / context，完成后保留静态 owner，沿用原 Spring / retarget，不增加 resize graph。仅完全离开视口的 outgoing 在完成后停放。静态 clip 停止 JS polling / watchdog 和 Native motion repaint，输入查询零分配。Native ACK 不可用时，部分物理窗口仍安全停放。

C++ 仅适配 KWin 原生 hit testing：Rust 给出越界 predicate，平台在一次事件内临时排除隐藏 surface，绘制引用保留 Scene Item；在 frame / idle / 清理时恢复，保护 Showing Desktop / grabs / interactive move / 锁屏和对象生命周期。原生 decoration / surface / focus action 路径保留，不注入点击。工作区离开时克隆冻结的 Rust handle，沿用原 WorkspaceMotion 的竖直投影，待 compositor idle 释放；未受管的编辑器弹窗不再取消全局 Scroll owner。Full 缩回 half 时，既有 WIDE_TO_PAIR 完成信号触发后续静态 clip ACK；目标使用既有 continuing 角色，退出完成命令拥有独立去重编号，保持现有 Scale / Translation 和时长。

1/3、2/3 与实验 resize graph 仍延期；没有修改参数、依赖或 Cargo.lock。FFI Plan 从 176 增至 184 bytes，Bridge / Clip / Ring 与两个 JS 包须一起更新。

| 验证 | 结果 |
| --- | --- |
| Rust fmt / locked clippy / locked tests | 通过，31 单测 |
| `node tools/check.js --native` | 96 JS、Bridge 16 / Clip 15 / Ring 22 CTest、3 隔离 D-Bus、Plasmoid 和生产边界通过 |
| Core Debug / Release | 各 11 CTest，通过冻结 Golden differential 与 partial 独立契约 |
| Native umbrella Debug | 26 CTest 通过 |
| 无测试两插件 / Bridge | 构建与生产边界通过，无 reference target |
| 部署 / 自动实机 / 用户视觉 | 完整 immutable 部署与安装字节核验通过；自动实机通过，用户视觉待反馈 |

门禁 `/tmp/cc-niri-full-half-native-final.log`；Core / umbrella `/tmp/cc-niri-full-half-{core-debug-ctest,core-release-ctest,umbrella-ctest}.log`。安装与实机日志分别为 `/tmp/cc-niri-full-half-install-final.log`、`/tmp/cc-niri-full-half-live.log`。备份 `/tmp/cc-niri-redeploy-20261007-l7rfyqhz` 的 `rollback.py` 可配套恢复本次部署前的 half / Full + P4 / P5 版本和布局，保留 KDE 配置。旧 immutable 插件保留；`/tmp` 可能在重启后清除。未测 FPS / GPU / 长期压力；真实点击、拖动、touch / tablet 与用户视觉仍需实机反馈。用户自己的 4K60Hz 文档未修改，未创建 Git 提交。

最终实机时间 UTC 2026-10-07T13:22:02.628520+00:00 至 2026-10-07T13:22:43.106876+00:00：左右两种 Full / half 保留 2512px Full 与 1252px half，静置超过 watchdog 时限仍可见，快速 H/L、J/K 离开 / 返回、双向 R 返回、Wide、Fullscreen、Ring off-on 与重启通过；右侧 12 个副屏点的原生命中均排除隐藏的主屏窗口。KWin PID 2050、输出配置、主屏独立工作区、Safe Area 与动画设置保持，验证前的工作区 / 焦点 / 列宽 / anchor 已恢复。实机日志没有脚本错误、invariant / fail-safe、超时、Native fallback 或 panic。用户在构建期间变动过窗口与工作区，实机使用验证开始时已有的双窗工作区；恢复的是该次验证开始时的实际状态。

## 双 Full 缩宽时的焦点保护（2026-10-07）

用户报告 A / B 都为 Full，在 A 按 R 缩为 half 后变成 B。回归测试模拟相邻客户端在取消最小化时同步激活：Native ACK 已在原 relayout 结束后返回，geometry commit 没有 transaction guard，激活会重入布局并把焦点 / offset 改成 B；修复前该测试确实失败。

`LayoutTransaction.resume` 现在继续已发布的同一 epoch，恢复 geometry / visibility 批次期间的重入保护，拒绝过期 ACK 并通过 finally 退出。提交前实际活动窗口仍存在且未最小化时，恢复批次引起的焦点变化被还原；显式 H/L / Dock 延迟激活仍交给原 coordinator 的 geometry readiness 流程。JS 仍拥有布局与焦点意图，不修改 Rust / C++ / FFI、协议或动画参数，不增加动画时钟。

自动回归覆盖左右两个 Full 的缩宽、邻窗恢复时激活、1252 / 2512px 与 x=24 / 1284 / -1236、UUID / 列顺序不变、下一次 R 仍操作原窗口、随后用户主动聚焦邻窗正常，以及同 epoch / 过期 ACK / 异常与嵌套事务。完整 `node tools/check.js --native` 通过：96 JS、31 Rust、fmt / locked clippy、Bridge 16、Clip 15、Ring 22 CTest、3 个隔离 D-Bus、Plasmoid 与生产边界；Core Debug / Release 各 11 与 umbrella Debug 26 CTest / Golden differential 通过。

已按 save-state / stop / package upgrade / start 路径部署。安装 JS 哈希匹配，其他 Native / Effect / Bridge 产物保持；工作区、焦点快照、列宽、anchor、输出和动画配置保持，KWin PID 2050 未重启，启动日志无脚本异常 / invariant fail。实机诊断遇到息屏，随后会话锁屏，未获得可靠的 Wayland geometry ACK 与动画完成采样；诊断出现的 Native fallback 不作为验收通过。**本次 R 行为与人工视觉待解锁后复验**，不把上一轮实机结果当作本轮通过；未测 FPS / GPU 或长期压力。

门禁日志 `/tmp/cc-niri-full-full-focus-native.log`；部署 `/tmp/cc-niri-full-full-focus-deploy.log`。当前备份 `/tmp/cc-niri-redeploy-20261007-1afevacl`；执行 `python3 /tmp/cc-niri-redeploy-20261007-1afevacl/rollback-layout.py` 恢复本轮前布局包，保持当前保存的用户布局与 Native ABI。诊断原始状态与日志在 `/tmp/cc-niri-redeploy-20261007-77civxa1`；`/tmp` 可能在重启后清除。用户自己的 4K60Hz 文档未修改，未创建 Git 提交。

## Full 邻窗复用进入动画（2026-10-08）

用户确认上一轮双 Full 缩宽后原窗口保持焦点，但邻窗闪现。原路径把部分可见 Full 邻窗停放到目标收缩动画结束，再通过静态 Native clip 恢复最终位置，因而没有进入动画。

现在先发布原 Pair/Wide protocol 1，再在同一 epoch 通过既有 Scroll ACK gate 安装静态 paint/input clip，随后提交真实几何。Full 邻窗使用原 Translation/Opacity、OutCubic 与目标共用的 Presentation 时间线；延迟收到目标尺寸 ACK 时，在原事务 epoch 内释放 held neighbor，复用剩余动画时间。连续反向时转移待停放窗口，保留已绘制位置；不要求宽度循环恢复原 A/B 组合，也不恢复 1/3、2/3。

Native ownership reader 仅为同 session / epoch 的有效 Pair/Wide 标记保留 Script motion。C++ 缓存绘制来源，只使用 Rust viewport 裁剪，避免重复叠加 Spring translation，也避免目标客户端尺寸 ACK 前提前移动原画面。工作区 departure 复制该绘制来源，随原冻结 handle 在 compositor idle 退休；不新增 Core policy、动画时钟、FFI、参数或每帧 JSON。普通 Scroll 继续使用 Rust projection。实机发现 Wide 返回的旧计划缺少 viewport；已统一补齐，并加入 Full 邻窗的 Wide 返回回归。

自动验证：最终 JS 门禁 96 项通过；完整 Native 门禁通过（Rust fmt、locked clippy、31 Rust 单测，Bridge 16、Clip 15、Ring 22 CTest、3 隔离 D-Bus、Plasmoid 与生产边界）；Core Debug / Release 各 11、umbrella Debug 26 与 Golden differential 通过。回归包含左右同步 8px 间距、Full 宽度保留、焦点、Native ACK 顺序 / 拒绝、Wayland 尺寸 ACK、快速反向、J/K 冻结、Wide 返回、静态 clip 的负坐标 / 待 ACK frame 与真实 Bridge 同 epoch 协议顺序。

已完成 immutable Native 安装与最终布局包更新，安装哈希和 Rust 后端一致。最终实机 UTC 2026-10-08T01:56:36 至 01:57:15 通过左右 Full/half、4 秒静置、H/L retarget、J/K、双向 R、Wide、Fullscreen、Ring off/on、重启及 12 点副屏输入隔离。真实日志记录 4 次 `incoming virtualX` 回调，进度为 0.000–0.204，使用既有 Translation/Opacity 与剩余时长。为验证真正双窗，临时将其余主屏列移到既有非空工作区，最终恢复所有窗口成员关系、列顺序、宽度、焦点、anchor、原工作区拓扑和配置；KWin PID 2050 与输出保持。

早期锁屏和多窗夹具不作为本轮通过证据：多窗缩宽可能露出第三列；修复 viewport 前的 Wide 复验失败也已保留。最终证据在 `/tmp/cc-niri-redeploy-20261007-pjesw1nn/animation-isolated-live`，日志 `/tmp/cc-niri-full-neighbor-animation-isolated-live-final.log`。自动 / 实机几何与回调验证不能代替人工观感，**用户视觉仍待反馈**；未测 FPS / GPU、真实点击 / 拖动 / touch / tablet 或长期压力。

门禁 `/tmp/cc-niri-full-neighbor-animation-native-final.log`；viewport 补齐后的 JS 门禁 `/tmp/cc-niri-full-neighbor-animation-js-final.log`；Core / umbrella `/tmp/cc-niri-full-neighbor-animation-{core-debug,core-release,umbrella}-final.log`。完整修复前备份 `/tmp/cc-niri-redeploy-20261007-v5l1gbrl`：执行其 `rollback.py` 配套恢复本轮前的 Native / Script / Effect / Bridge 安装版本，保留当前保存的布局和 KDE 设置。`/tmp` 可能在重启后清除；用户自己的 4K60Hz 文档未修改，本轮未提交 Git。

## half / Full 外推时的副屏短闪（2026-10-08）

用户报告 A 为 half、B 为 Full，在 A 按 R 时，B 偶尔在右侧副屏闪一下。旧顺序在发布 Pair/Wide 计划之前撤销了静态 Native clip；此时 B 的实际 Full frame 已延伸到副屏，而 Script 动画 clip 尚未安装。用旧撤销顺序运行新增回归，确实在“延迟 legacy ACK 时旧 clip 仍应保留”的断言失败。

JS 现在保留旧 clip 与尚未回调的 Native arm epoch，等待 Pair/Wide publish ACK，再通过原 cancel ACK barrier 安装新的静态 clip。Adapter 在这段事件循环交接期间保存一个冻结的 Rust handle，仅按已发布窗口 membership 转发原 viewport、projection 和 input predicate；不 advance，不重算几何或布局。新 Native arm、对应 Script clip、取消、工作区 context 变化或窗口关闭会释放它，工作区离场继续使用原冻结 handle 路径。保留原 Translation / Scale / Opacity、OutCubic、时间线、8px 间距和焦点保护；Rust policy、FFI / ABI、协议、参数和依赖未修改。交接不增加计时器、静态 repaint 循环或每帧 JSON / 日志。

自动验证全部通过：96 JS，Rust fmt / locked clippy / 31 单测，Bridge 16 / Clip 15 / Ring 22 CTest，3 隔离 D-Bus、Plasmoid 和生产边界；Core Debug / Release 各 11 与 umbrella Debug 26 CTest，包含 Golden differential。回归覆盖左右 settled half / Full 的 R、延迟 publish / Native ACK、原动画与焦点、过期 arm / cancel / Script clip、冻结的最后 Rust sample、副屏输入排除、context / window 生命周期和交接释放。首次完整门禁因沙箱不能创建 D-Bus socket 中断，按现有权限重跑最终完整门禁通过。

已按 save-state / stop / immutable install / start 部署，并独立核对安装字节与 Rust 后端。最终解锁实机 UTC 2026-10-08T06:23:10.828589 至 06:24:00.572730 通过左右 Full / half、4 秒静置、H/L、J/K、双向 R、连续 12 次 R、Wide、Fullscreen、Ring off/on、重启及右侧副屏 12 点原生命中隔离。日志包含 14 次真实 clip handoff；最终 `clipHandoffActive=false`。验证前的窗口 membership、列宽 / 顺序、anchor、主屏布局焦点、全局实际焦点（可能在副屏）、原生工作区拓扑、输出和配置恢复；KWin PID 2050 未重启。

早期夹具的受管窗口不足、只核对 JS 焦点及把副屏全局焦点当作主屏布局焦点的准备失败，不作为实机通过证据；最终夹具在每组 R 用例前核对实际 KWin 焦点。**偶发副屏短闪的人工视觉仍待用户复验**；自动几何、clip 生命周期与输入命中检查不等于逐帧像素验收。未测 FPS / GPU、真实点击 / 拖动 / touch / tablet 或长期压力。

门禁 `/tmp/cc-niri-full-outgoing-clip-native-final.log`；Core / umbrella `/tmp/cc-niri-full-outgoing-clip-{core-debug,core-release,umbrella}-final.log`；部署 / 核验 `/tmp/cc-niri-full-outgoing-clip-{install,final-verify}.log`；最终实机 `/tmp/cc-niri-full-outgoing-clip-live-verified.log`，证据目录 `/tmp/cc-niri-redeploy-20261007-ov6joucv/outgoing-clip-live-verified`。执行 `/tmp/cc-niri-redeploy-20261007-ov6joucv/rollback.py` 可配套恢复本次修复前的安装版本，保留当前保存的布局和 KDE 设置；`/tmp` 可能在重启后清除。用户自己的 4K60Hz 文档未修改，本轮未提交 Git。

2026-10-08 用户反馈“已经完成”：本次 half A / Full B 在 A 按 R 时的副屏短闪修复，用户实机验收通过。上文人工视觉待复验是首次部署历史；该反馈不扩大为延期分数列宽、P6–P8 或 FPS / GPU / 长期压力验收通过。
