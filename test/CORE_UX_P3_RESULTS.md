# Core UX P3 — Column Width Controls 实现与验收记录

日期：2026-10-07。依据 [Core UX 设计](../doc/todo/CC-Niri%20Core%20UX%20下一阶段实施设计.md)第 11–12、21、43、48、51–53、59 节实现 P3。状态：代码、完整门禁、部署与实机状态核验完成；人工视觉验收待反馈。

## 行为与持久化

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
