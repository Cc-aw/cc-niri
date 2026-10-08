# Core UX P7 — Dockless Core

日期：2026-10-08。依据 [Core UX 设计](../doc/todo/CC-Niri%20Core%20UX%20下一阶段实施设计.md) 的 P7 / §§35–40、64 实施。P6 已完成并部署。P8 Bridge 命名 / 清理和延期分数列宽不在本轮范围。

## 行为与边界

新增 KWin Script 配置 `EnableDockIntegration`，默认 `false`，配置 UI 提供显式开关。关闭时不创建 `DockScrollController`，它也不再是必需的 runtime controller；不注册 Dock 的 `focus-column-right`、`set-column-order`、`set-presentation-mode` 或 `advance-dock-scroll` handler。来自旧 / 已安装 Dock 的命令只被拒绝并重发 canonical snapshot，不能改变列、焦点、窗口归属或展示。

键盘 H/L、J/K、重排、half / Full、Wide、Floating、相对 / 数字工作区移动、动态工作区、Startup Restore、Workspace Persistence、Recovery 与独立 Focus Ring 沿用既有流程。保留 contextual reveal 的取消逻辑，避免可选 Dock 的取消 hook 影响 Wide 语义。删除无调用方的四个 Dock wrapper；可选滚动的 begin / advance / cancel 与原生 activation 都处理 planner 缺席。

通用 Bridge 始终保留：状态读取 / 发布、protocol 2 快照、session / generation、动画计划 / 完成、Wide parking / exit、vertical workspace layout 和紧急恢复。`CCScrollPublishDockState` / `CCScrollApplyDockCommand` 仍是通用 Bridge 重发 / 队列入口，CLI stop fallback 与动画完成照常工作；名称与现有 D-Bus / ABI 保留至 P8，不因“Dock”字样删除这些通用能力。

显式 `EnableDockIntegration=true` 创建原 Dock planner 并恢复四类 UI 命令，仍经过现有 envelope / generation / Workspace barrier / 列集合校验，JS 保持布局 authority。

## 安装

`./install.sh` 默认安装 Core / Bridge / 两个 Native 插件 / Script Effect，不构建或安装 Plasmoid、不重启 Plasma Shell；保留已有 Dock 包与显式集成设置，不删除或改写面板。`./install.sh --with-dock` 额外构建 / 安装 CC Scroll Tasks、设置 `EnableDockIntegration=true` 并重启 Plasma Shell。`--help` 和未知参数在任何部署前结束。

所有 CMake 调用保留 `/usr/bin/g++` 与共享工具链 guard；save-state → stop → immutable Native install → Bridge / package → start 顺序保持。完整 Native 门禁继续编译并测试可选 Plasmoid，安装选项不降低门禁。

## 自动验证

最终 `node tools/build.js`、`node tools/check.js --native`、`bash -n install.sh` 通过：

- 99 个 JS 测试文件。新增 `dockless-runtime.test.js` 默认 / 显式关闭下直接执行生产生成包，覆盖键盘日常流程、persist / reload、禁用 Dock 命令无几何变化、独立 Ring / Native / Bridge 流量、通用 Wide 完成与紧急恢复；显式开启覆盖 Dock 重排、逐步滚动与展示菜单。
- 新增 `dockless-install.test.js` 在临时 HOME 和模拟外部命令下验证默认 / opt-in 安装、用户配置保留、compiler 参数、组件顺序及默认不重启 Plasma；没有在用户桌面运行两遍完整安装器。
- Rust 1.99.0 fmt / locked clippy `-D warnings` / locked workspace test：31 单测通过。
- GNU GCC 16.x 的既有构建树：Bridge 16、Clip 15、Ring 22 CTest，包含 Golden differential；3 个隔离 D-Bus 测试通过。Qt 原生 JS 语法、Plasmoid、生成包一致性、生产 Rust 边界与 whitespace 检查通过。

首轮 Node 回归通过，但 Qt 原生语法测试发现新增 object spread 不受 KWin JS 引擎支持；已改为 `Object.assign`，单独原生语法复验及最终完整重跑通过。首轮日志 `/tmp/cc-niri-core-ux-p7-native-gate.log` 保留；最终日志 `/tmp/cc-niri-core-ux-p7-native-final.log`。

本轮不改 Rust / C++、Native protocol、FFI / ABI、CMake 文件、动画曲线 / 参数或 frozen oracle，没有新布局 / 焦点 authority 和时钟。未额外重跑独立 Core Debug / Release、umbrella 或 configure 编译器拒绝路径。默认减少 Dock planner 实例与 Dock-specific deferred command；未测 FPS / GPU 或长期性能。

## 部署与实机

备份 `/tmp/cc-niri-redeploy-20261007-xkjiy97y`。按既有 save-state / stop / KPackage upgrade / start 路径部署布局包与配置 UI；安装 JS / XML / UI 哈希均核对。Native / Effect / Bridge / CLI / Plasmoid 安装字节、KWin PID 2050、输出、主屏独立模式、原边距 / 动画设置保持；没有更改快捷键或已有面板 / applet。原 `EnableDockIntegration` 未设置，生产采用默认关闭。

最终自动实机状态核验于 UTC 08:41:11–08:41:45 通过（本地 16:41）。创建两个仅运行 `sleep` 的临时 Konsole，按 PID 限定夹具；短暂停止 Plasma Shell，逐项确认其进程与 D-Bus owner 缺席，确保已有 Dock applet 无法参与核心流程。没有删除面板 / applet，也没有创建或回收用户工作区。

| 无 Plasma / Dock 核验 | 结果 |
| --- | --- |
| H/L、键盘列重排 | 通过；实际活动窗口、Bridge 焦点、唯一列归属一致 |
| Full / half | 通过；Full 实际 frame 等于主屏 Safe Area |
| Wide、Floating / 返回列管理 | 通过；Native 完成 / parking 和独立 Rust Ring 正常 |
| J/K | 通过；主屏切换，副屏工作区及窗口属性保持 |
| 数字非相邻移动 / 返回、相对移动 / 返回 | 通过；move-and-follow、列宽与 Wide 偏好保持 |
| CLI restart / persistence | 通过；新 session 恢复各工作区顺序与偏好，启动遵循 KWin 实际焦点；重新聚焦测试列后 Full frame / Ring 正常 |
| 通用 Bridge 紧急恢复 | 通过；未依赖 Dock 的 generic queue 恢复停放窗口，Native / Ring ownership 退休 |
| 测试结束恢复 | 通过；临时窗口关闭，原 membership、顺序、偏好、锚点、工作区、主屏记忆 / 实际全局焦点恢复；Plasma 面板 / applet ID、输出、KWin PID、Native 字节和原配置一致 |

最终证据位于备份下 `p7-live-complete/`，含 `success.json`、`restoration-success.json`、各步骤 KWin 窗口 / Bridge / Ring 状态与 KWin 日志。日志 `/tmp/cc-niri-core-ux-p7-live-complete.log`；部署日志 `/tmp/cc-niri-core-ux-p7-deploy.log`。本次受控矩阵没有新增 JS 错误、`INVARIANT_FAIL`、`FAIL_SAFE`、completion timeout 或 Rust panic，KWin PID 2050 保持。

早期尝试保留在 `p7-live/`、`p7-live-verified/`、`p7-live-owned/`、`p7-live-final/`、`p7-live-final2/`，不计为完整通过。前两次实际激活来源未能确定；使用自建客户端后，发现 restart 断言错误地要求保留旧实际焦点，而既有 startup policy 应跟随 KWin 当前焦点。后两次临时客户端准备时，异步 output 变化后窗口仍等待 activation；最终夹具逐个等待实际主屏 output 后再激活并核对 adoption，完整流程通过。仅修正临时测试夹具，没有因此改动生产焦点、窗口接管或动画 policy。所有尝试均执行 finally 清理 / 恢复，最终恢复另经状态断言核对。

用户动画观感与长期 Dockless 日常 smoke 仍待反馈；此轮未测帧率 / GPU，也未自动替用户移除已有 Dock。受控实机状态通过不能扩大为上述人工与长期验收通过。

2026-10-08 用户反馈“p7没问题 开始p8”：P7 用户实机 / 日常 smoke 验收通过，进入 P8。上述待反馈说明保留为首次部署历史，不代表长期压力、FPS / GPU 测量或 P8 验收通过。

## 回滚

仅恢复部署前 P6 布局包，保留当前持久布局、KDE 配置、快捷键、Native 与 Plasma 面板：

```sh
python3 /tmp/cc-niri-redeploy-20261007-xkjiy97y/rollback-p7.py
```

只需要重新使用已安装 Dock 时，将 `EnableDockIntegration` 设为 `true` 并 `cc-niri restart`。源码回滚限定本轮 RuntimeConfig / package glue / XML / UI / 安装选项与对应测试，再生成包；不撤销已验收 P1–P6 和 Full 动画修复。
