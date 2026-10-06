# 主屏工作区切换与呈现帧时间

日期：2026-10-06。用户确认上一个 Pair→Wide / J 中途画面问题成功修复，随后要求 J/K 只切换主屏，并报告感觉工作区动画不足 60fps。主屏独立模式已启用并实测；普通 J/K 未复现低于 60fps，人工流畅度复验待反馈。

## 原因与实现

本机 KWin 6.7.5 的 `perOutputVirtualDesktops=false`。既有布局脚本已正确调用 `setCurrentDesktopForScreen(desktop, primaryOutput)`；KWin 在联动模式仍对所有输出发送 desktopChanged，所以问题不在 J/K 选错屏幕。[KDE 6.7 VirtualDesktopManager](https://github.com/KDE/kwin/blob/Plasma/6.7/src/virtualdesktops.cpp) 的 setCurrent 分支与实机两屏事件吻合。

新增 `cc-niri workspace primary|global|status`，通过 KWin 原生 `[Windows] PerOutputVirtualDesktops` 设置启用 / 恢复独立工作区。命令检查平台支持；应用失败恢复旧设置；KWin 的 [reconfigure](https://github.com/KDE/kwin/blob/Plasma/6.7/src/workspace.cpp) 延迟 200ms，命令有限轮询实际状态，不把 D-Bus 返回当作 apply ACK。安装 / start 不强制改用户选择。没有移动窗口、复制工作区状态或建立第二套 workspace authority。

原 Native Clip 对每次变化的 deviceClip 格式化字符串并输出 MAP 日志；工作区纵向滑出令 key 每帧改变。现改为默认关闭的 debug 诊断，显式启用时按 transaction / role / scale / departure 去重，最多 256 条 key；普通 paint 不生成日志字符串。Scroll runtime 不活跃时跳过逐窗 UUID / geometry projection 查询；完成后仍 active 的 Outgoing 保留原路径。不改 Spring / retarget / Slide 参数和上一修复的冻结画面。

Native Adapter 新增按需 `StartWorkspaceFrameCapture` / `GetWorkspaceFrameCapture`，读取每个输出 `KWin::RenderLoop::framePresented` 的真实 monotonic 呈现时间；默认不采集，每次最多三秒，每输出固定 512 个样本、16 个 desktop 事件，不逐帧分配、不写日志、不触发 repaint。移除输出会断开监听并清理数据。JSON 只在查询时生成，统计在独立只读工具 `tools/summarize-workspace-frames.py` 中计算，Core / FFI 与生产 authority 不变。

## 实机测量

输出：DP-1 为主屏，3840×2160、scale 1.5、60Hz；HDMI-A-1 为副屏，2560×1440、scale 1、60Hz。eDP-1 已禁用。NVIDIA RTX 2060 / driver 615.71.09、OpenGL EGL。保留 BlurStrength=14、Slide 背景与 spring 设置。

每个模式三次 J/K 往返，共六次切换。过滤 desktopChanged 至 fullscreen transition idle 后一个刷新周期的呈现样本，避免把静止时无 damage 的空闲时间计为掉帧。间隔超过 1.5 个刷新周期（60Hz 时 25ms）记为长间隔；统计呈现帧率，不证明每个应用内容更新率或所有复杂动画均流畅。

| 模式 | 改变工作区的输出 | 主屏呈现帧数 | 每次平均呈现 fps 范围 | 最大 P95 间隔 | 最大间隔 | 长间隔 |
| --- | --- | --- | --- | --- | --- | --- |
| 全局联动 | DP-1、HDMI-A-1 | 323 | 59.994–60.000 | 16.822ms | 16.926ms | 0 |
| 主屏独立 | 仅 DP-1 | 326 | 59.997–60.000 | 16.750ms | 16.854ms | 0 |

全局模式基线已使用清理日志后的诊断 Clip，不是原版本的 FPS 基线，不能据此声称日志清理提高了多少帧率。原体感低帧率暂未复现。普通 Slide 从切换至完全 idle 约 0.89 秒，参数保持原样。副屏探针在主屏模式下持续报告原 desktopId，主屏六次事件均只包含 DP-1；返回原 workspaceId，列顺序、宽度与 presentation 不变，最后往返焦点与该轮开始一致。

## 自动验证与部署

- 固定 Rust fmt / clippy `--locked -D warnings` / workspace test：26 项单测通过。
- `node tools/check.js --native`：88 个 JS、Bridge 5 CTest / 3 隔离 D-Bus、Clip 16 CTest、Ring 23 CTest、Plasmoid 构建通过。实机发现延迟 ACK 后补充 CLI 回归并再次执行最终完整门禁。
- Release Core 12/12 CTest（全部既有 C++–Rust 差分），全 Rust ON 的 `build/native-r6-on` 27/27 CTest 通过。无 CMake / FFI / Rust Core 改动，不要求新增 backend 矩阵。
- 实际 bundle 回归覆盖两个输出不同 currentDesktop、主屏 J/K、禁止全局 setter、副屏桌面事件不挂载主屏、副屏几何 / opacity / minimized / window membership 保持。
- CLI 回归覆盖配置生效、延迟生效、恢复 global、只读 status、不支持 / 查询失败无写入，以及失败后旧配置恢复。

UTC `2026-10-06T08:13:31.424108+00:00` 沿用 save-state / stop / immutable install / start 部署；KWin PID 前后均为 **2044**，没有重启 compositor。部署前后 workspaceId、focusedUuid、columns、presentation 一致，布局和动画脚本 byte-for-byte 不变，Ring 沿用原 Rust 版本；Scroll Runtime / Native Protocol / decoration geometry 均保持 Rust。

Clip SHA-256：`59630331badf788037aebb0eee1b0877b0a265df5aaaec5f6344843667ed02fb`。canonical：`/home/cc/.local/lib/cc-niri/viewport-clip/59630331badf788037aebb0eee1b0877b0a265df5aaaec5f6344843667ed02fb/cc-niri-viewport-clip.so`。CLI 补充延迟验证后单独更新；不重新加载动画组件。主屏设置已写入 kwinrc 并验证运行状态 true。

最终 CLI SHA-256：`8f649ba68f3291286606e659b3920c22514053248a3b3b74848120c5b9225c89`，与仓库源码一致。最终完整门禁通过。按当前 KWin PID 2044 过滤部署后日志：TypeError、ReferenceError、SyntaxError、INVARIANT_FAIL、FAIL_SAFE、completion timeout、Rust panic、native fallback、MAP paint 日志均为 0；机器上其它 Plasma applet 的 TypeError 不混入此统计。Ring coreBackend / nativeProtocolBackend 均为 Rust，drawCount=14,087，owner 位于 DP-1；只读观察器确认主屏切换期间 HDMI-A-1 的 desktopId 始终不变。

测量与审计：`/tmp/cc-niri-output-frames-20261006-7j27h9pb`，含前后状态、组件 / 配置备份、12 份原始呈现数据、comparison.json、measurement.json、只读观察器与命令记录。测量结束已卸载观察器。门禁日志 `/tmp/cc-niri-workspace-{native-check,native-final,differential,r6-ctest,js-final}.log`。

仅恢复双屏联动：`cc-niri workspace global`。恢复本次修改前的 CLI、Clip 与模式：

```sh
python3 /tmp/cc-niri-output-frames-20261006-7j27h9pb/rollback.py
```

回滚保留上一版已验收的布局 / 动画脚本与 R6 Rust 后端。`/tmp` 备份可能随重启清理，immutable library 仍保留。尚未覆盖 Pair→Wide 中途切换、重负载、所有 HiDPI 交互和长期使用的帧时间，不推进 R7，不把普通切换的 60fps 测量记为全部视觉验收。
