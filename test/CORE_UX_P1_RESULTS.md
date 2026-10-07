# Core UX P1 — Compact Safe Area 实现与验收记录

日期：2026-10-07。依据 [Core UX 设计](../doc/todo/CC-Niri%20Core%20UX%20下一阶段实施设计.md)第 29–34、51、57 节，先实现 P1。状态：代码、完整门禁与部署核验已完成；人工视觉验收待反馈。

## 范围

主屏 `GapBottom` 的 RuntimeConfig、KConfig schema 与配置界面默认值统一从 70 改为 8，使用 `node tools/build.js` 更新生成包。顶部 50、左右 24、inner gap 8 保持；显式保存的主屏边距（含 0 / 60 / 70）继续优先，副屏 `SecondaryGapBottom` 独立配置与默认 24 保持。

此次不修改 Spring / Scroll / WorkspaceMotion 曲线或参数、Native Core / FFI、Focus Ring stroke 或 owner、Fullscreen、Width / Wide 模型和快捷键。P2 的持久化 `full` 尚未实现，Full Column 验证随 P2 进行；现有安全区域最大化已覆盖新高度。

## 验证

| 检查 | 结果 |
| --- | --- |
| 四个针对性 JS 回归 | 通过：RuntimeConfig / OutputTopology 默认及自定义配置、Pair 投影、Maximize / Wide 高度、Fullscreen 原生边界及退出恢复、生成运行时 Ring eligibility 窗口几何 |
| `node tools/build.js` | 通过，布局生成包只更新默认值 |
| `node tools/check.js --native` | 通过：Rust fmt / clippy / 30 单测、89 JS 回归、Bridge 16 CTest / 3 隔离 D-Bus、Clip 15 CTest、Ring 22 CTest、Plasmoid 构建、生产符号边界 |
| 安装后只读运行状态 / 几何核验 | 通过：当前可见 Pair 的两个窗口底部均保留 8；原 workspace / focus / width / presentation / anchor 保持，脚本与 Effect 已加载，Bridge active |
| 主屏底部留白 / Ring / Maximize / Fullscreen 人工视觉验收 | 待用户反馈 |

2560×1440 逻辑屏幕的新默认 safe rectangle 为 `24,50 2512×1382`，下边界 1432，底部保留 8。两个 half Column 分别为 `24,50 1252×1382` 和 `1284,50 1252×1382`，水平 seam 仍为 8。安全区域最大化采用同一 safe rectangle；72% Wide 为 `375,50 1809×1382`。Fullscreen 仍由 KWin 采用整屏边界，退出后恢复新的 safe rectangle。旧 V2 显式 70px fixture 保留，避免把用户配置迁移成新默认。

P1 是默认配置调整，不新增每帧工作或动画时钟；本阶段不新增 FPS / GPU / 性能基准结论。自动检查不能替代实机视觉验收。

## 部署与回滚

已沿用 save-current-state / cc-niri stop / KPackage upgrade / cc-niri start 更新布局包；安装后的布局 JS、schema、配置 UI 与仓库字节相同。Native 两个 immutable 插件、Bridge、CLI、动画包、Plasmoid 的安装哈希与 canonical 路径前后相同。KWin PID **2050** 不变，DP-1 保持 **3840×2160@60Hz / 150%**，副屏输出配置、主屏独立工作区及 **420ms** WorkspaceMotion 设置保持。

本机主屏 `GapBottom` 原本未显式保存，已采用新默认 8；副屏显式 `SecondaryGapBottom=24` 保持。只读临时 KWin 探针确认当前可见 Pair 的几何从 `24,50 1252×1320` / `1284,50 1252×1320` 变为 `24,50 1252×1382` / `1284,50 1252×1382`，已卸载探针。隐藏及非当前工作区的窗口保留既有延迟几何生命周期，未强制重写；这些窗口重新进入布局时由 LayoutEngine 使用当前配置。

核验时间 UTC **2026-10-07T02:06:53.136245+00:00**；会话已解锁，受管列 UUID 顺序、widthMode、workspaceId、focusedUuid、presentation、viewportAnchor 前后相同。日志无 TypeError / ReferenceError / SyntaxError、`INVARIANT_FAIL`、`FAIL_SAFE`、completion timeout、Rust panic 或崩溃。没有自动驱动 H/L、Wide、最大化或 Fullscreen 实机交互；这些视觉复验仍待用户反馈，不能从只读几何与自动测试推定通过。

备份与审计：`/tmp/cc-niri-core-ux-p1-live-w08399v4`，含旧布局包 `layout-before/`、kwinrc、workspace state、前后运行状态和窗口几何、安装步骤及日志；指针 `/tmp/cc-niri-core-ux-p1-live-path`。门禁日志 `/tmp/cc-niri-core-ux-p1-native-gate.log`，安装日志 `/tmp/cc-niri-core-ux-p1-install.log`。`/tmp` 备份可随重启清除。

若已保存 `GapBottom`，升级不会覆盖它。要临时恢复旧主屏边距，可执行：

```sh
kwriteconfig6 --file kwinrc --group Script-cc-niri-maximize --key GapBottom 70
cc-niri restart
```

恢复 P1 默认可删除该显式键后重载；源码回退本阶段独立提交并重新安装布局包即可恢复原默认。副屏使用独立 `SecondaryGapBottom`，无需随主屏回滚。
