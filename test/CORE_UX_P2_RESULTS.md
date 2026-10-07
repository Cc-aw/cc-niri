# Core UX P2 — Persistent Full Column 实现与验收记录

日期：2026-10-07。依据 [Core UX 设计](../doc/todo/CC-Niri%20Core%20UX%20下一阶段实施设计.md)第 4–10、13、51、57、59 节实现 P2。状态：代码、完整门禁、部署与实机状态核验完成；人工动画连续性及视觉验收待反馈。

## 范围与语义

`ColumnLayout.computeColumnWidth("full")` 使用 `Math.max(1, safeWidth)`，不扣除 inner gap。Full 仍使用普通 ColumnStrip 的 logicalX / pixelWidth、最小 reveal、SCROLL transaction 和 parking 生命周期，不新增 Full Presentation、KWin Fullscreen 或动画时钟。默认新窗口仍为 half。

WorkspaceSnapshotStore 接受第四个列宽预设 `full`；现有 protocol 1 迁移、protocol 2 持久化、WorkspaceMount 和原生桌面迁移沿用同一归一化路径，保留宽度与 UUID owner。Bridge 原有校验已允许该 widthMode，仍要求 active root 与对应 workspace 的列顺序和宽度一致；无需改生产 C++ 校验或提高协议版本。本阶段通过 Bridge 对象测试和隔离 D-Bus 覆盖 Full 落盘、重启恢复及宽度不一致的原子拒绝。

Full 优先于 72% Contextual Wide：保留 persistentWide 偏好但暂停 Wide 展示，避免 H/L、恢复或 Meta+Z 把 Full 缩窄。PresentationController 复用 ContextualViewport 的有效 Wide owner 查询，拒绝残留 Full/Wide 状态；普通非 Full 列的 Wide 行为保持。Rust Core、FFI、Spring、Scroll / WorkspaceMotion 曲线及参数、Ring owner、工作区选择和快捷键均未修改。

Meta+R 宽度循环、Meta+F Full toggle 与 previousNonFullWidthMode 属于 P3，本阶段尚未加入；测试通过正式快照恢复路径装载 Full。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `node tools/build.js` | 通过，生成包与 src 一致 |
| Full 几何 / LayoutEngine / persistence 回归 | 通过：不同 Safe Area / gap、half/full/half logical positions、最小 reveal、100% 真实几何、普通 SCROLL entry、三种旧宽度和 Full protocol 1/2 roundtrip、active root 宽度冲突原子拒绝 |
| 生成运行时回归 | 通过：H/L 与快速方向输入、J/K、重载、原生 workspace transfer 往返、默认新窗口 half、Full/Wide 优先级、UUID owner 和 invariant |
| ContextualViewport 回归 | 通过：各 focus source、显式 Wide、快照 restore、残留 Wide 和过期 pendingReveal 均不能缩窄 Full；非 Full 可重新使用保留的 Wide 偏好 |
| `cargo fmt --manifest-path native/rust/Cargo.toml --all --check` | 通过，完整门禁执行 |
| `cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings` | 通过，完整门禁执行 |
| `cargo test --manifest-path native/rust/Cargo.toml --locked --workspace` | 通过，30 单测 |
| `node tools/check.js --native` | 通过：91 JS 回归、Bridge 16 CTest / 3 隔离 D-Bus、Clip 15 CTest、Ring 22 CTest、Plasmoid 构建和三个生产符号边界；Golden differential 随 CTest 执行 |

第一次门禁已通过 JS / Rust / Bridge CTest，但沙箱禁止隔离 D-Bus 创建 socket。随后在允许创建测试总线的环境完整重跑并通过，没有绕过门禁。日志：`/tmp/cc-niri-core-ux-p2-native-gate.log`。

未修改 CMake / Core / FFI / Qt 转换，未另行重复 Core Debug / Release、umbrella 或 BUILD_TESTING=OFF 构建矩阵；现有四个生产构建树与差分测试均按完整门禁使用。

## 部署与实机核验

沿用 save-current-state / cc-niri stop / KPackage upgrade / cc-niri start 更新布局包。通过停服后的持久化快照临时设置主屏中间列为 Full 且保留 Wide 偏好，重启后的 JS 正式恢复布局；没有向活动布局注入第二套 authority。

在 DP-1 **3840×2160@60Hz / 150%**、2560×1440 逻辑屏幕上，执行 H/L、快速 L L H、J/K 和 `cc-niri restart`。每次回到 Full 后，只读临时 KWin 探针确认真实 frame 为 **`24,50 2512×1382`**，与 Safe Area 完全一致，窗口活动、非 fullscreen、非 minimized；Bridge 的 widthMode=full、Pair viewport 和 normal presentation 保持，Native Ring owner 与该窗口 UUID 一致。重启产生新 JS session 并重新连接 Bridge 后，Full 仍保留。所有探针执行后已卸载。

测试结束通过原始快照恢复了原列宽、persistentWide 偏好、Wide 视口、主屏工作区和焦点。安装后的布局包与仓库字节相同；Native immutable 插件、Bridge、CLI、动画包及 Plasmoid 的哈希和 canonical 路径未变。KWin PID **2050** 保持，主副屏输出、主屏独立工作区、副屏窗口几何、边距和 **420ms** WorkspaceMotion 设置保持。部署时段日志无 TypeError / ReferenceError / SyntaxError、INVARIANT_FAIL、FAIL_SAFE、completion timeout 或 Rust panic。

核验时间 UTC **2026-10-07T02:26:43.146641+00:00 — 02:26:53.530151+00:00**；门禁及实机核验通过不等于人工视觉验收。没有测量 FPS / GPU 性能，没有自动移动真实应用到另一工作区；workspace transfer 由生成运行时回归覆盖。Full 在屏幕配置变化后的数值计算已测试，未实机改变分辨率、缩放或边距。

P2 不增加每帧算法工作；Full 窗口内容面积更大，实际绘制成本仍取决于应用。未据此宣称帧率提高。

## 回滚与后续

本阶段为独立提交。回退提交并重新生成、安装旧布局包即可恢复 P1 路径；旧版不识别 full，会将该宽度归一化为 half。当前实机测试的原始列宽已恢复，因此回退不会丢失临时测试偏好。

备份与审计：`/tmp/cc-niri-core-ux-p2-live-qv88pp70`，含旧布局包、kwinrc、原始 workspace state、Full fixture、前后 Bridge / Ring / 窗口几何和操作日志。指针：`/tmp/cc-niri-core-ux-p2-live-path`；部署日志：`/tmp/cc-niri-core-ux-p2-install.log`。`/tmp` 可随重启清除。

下一阶段 P3 提供 Meta+R / Meta+F 和前一非 Full 宽度记忆；通过快捷键设置 A half / B full / C half 后，继续人工确认动画连续、Ring 视觉正确和 parking 无闪现。
