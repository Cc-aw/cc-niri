# ViewOffset Spring Phase 3：笔记本内屏验收

时间：2026-10-01 23:02–23:10（Asia/Shanghai）。代码：`07591a9`。

## 部署与加载

- 唯一主屏 eDP-1，1920×1080、scale=1、约 144 Hz；KWin 6.7.5 / Qt 6.11.2 / Wayland。
- 更新 native clip、Bridge、KWin Script 与 Scripted Effect；本轮不重装 Plasmoid。
- 先保存 workspace state、备份已安装文件，再恢复 parked windows、停用并升级。
- 初次安装后的 `isEffectLoaded=true` 不能证明新 native 代码生效：
  `/ccNiriViewportMotion` 未出现。换到独立 canonical library 路径后，原 ID 正常加载，
  真实 introspection 确认 `ArmScrollPlan(s) → b` 和 `CancelScrollPlan(s)`。
- 当前插件发现链接保持 `cc-niri-viewport-clip.so`，指向
  `~/.local/lib/cc-niri/viewport-clip/07591a9/cc-niri-viewport-clip.so`。
- 为后续升级固化 `tools/install-native-clip.py`：CMake 先安装到临时 DESTDIR，
  以产物 SHA256 命名不可变版本目录，再原子切换发现链接。相同版本不重写原文件，
  旧版本留在插件搜索目录之外；避免覆盖仍被 Qt/KWin 映射的库，保证新 canonical path。
  `install.sh` 同时尊重现有 CMake generator，移除与现有 Makefiles 冲突的强制 Ninja。

## 自动与人工结果

| 检查 | 结果 |
| --- | --- |
| Script / transition / native clip / Bridge | 全部运行，新 native D-Bus 端点存在 |
| 自动 Next → Next → Previous → Previous | 焦点索引 1 → 2 → 3 → 2 → 1；原工作区、列顺序和原焦点保持 |
| 真实 native 执行 | 日志确认 SCROLL OBSERVE 与 ARM continuing=1，无测试期间 native fallback 或运行时异常 |
| 用户 H/L 观察 | 用户明确描述两个相邻窗口滚动后间距拉开；不是停稳回跳或振荡 |
| 动画中 J、随后 K 返回 | 用户确认“切换和返回正常”；日志确认 WORKSPACE_CLIP_NATIVE CLEAR |
| KWin 稳定 | D-Bus 实际进程 PID 始终 225495，无重启；不把这一小段测试当成长时稳定性结论 |
| 部署修复回归 | 75 项 JS 门禁；新增测试持有旧 inode，验证升级不覆盖旧库、重复安装不重写及新版本 canonical path 不同 |

## 已知限制与判定

本阶段 continuing 使用共享 Spring，incoming/outgoing 使用旧曲线，因此滚动期间不能
保持固定间距。用户报告与该过渡机制吻合；尚未通过视频逐帧归因，不能声称完整滚动视觉通过。
无需为这个现象调整 Spring 阻尼。下一步 Phase 4 接入 incoming，Phase 5 接入 outgoing，
随后统一 ordinary SCROLL ownership 并复验固定间距、连续按键与 reverse。

新视频基线本轮仍未录制。正常加载、native plan 和工作区清理验收通过；完整视觉验收待后续。

## 日志与回退资料

- `/tmp/cc-niri-spring-phase3-before-support.txt`
- `/tmp/cc-niri-spring-phase3-deploy-build.log`
- `/tmp/cc-niri-spring-phase3-smoke.json`
- `/tmp/cc-niri-spring-phase3-user-test.log`
- `/tmp/cc-niri-spring-phase3-workspace-test.log`
- `/tmp/cc-niri-spring-phase3-deploy-js.log`
- 升级前文件备份：`/tmp/cc-niri-spring-phase3-backup-20261001-230227/manifest.json`

当前保持第三阶段启用。`cc-niri stop` 可恢复 parked windows 并关闭各组件。
