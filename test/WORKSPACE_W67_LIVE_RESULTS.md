# W6/W7 崩溃修复后的主屏实机检查

2026-10-01，feature/workspace-stack，修复提交 `64f568a`。
用户要求离线测试通过后启用并实机测试。离线完整门禁已通过，随后运行 `./install.sh`。

## 部署与状态

- KWin Script、scroll-transition、native viewport-clip 已加载，Bridge active。
- Script enabled at login=true；已安装 main.js 与仓库 bundle 的 SHA256 一致。
- 测试输出为笔记本主屏 `eDP-1`，两个原有 KDE Desktop，没有双屏测试。
- 首次部署故障已记录在 [崩溃分析](WORKSPACE_W67_CRASH_RESULTS.md)。本次安装日志
  `/tmp/cc-niri-w67-fixed-deploy.log`，自动实机日志 `/tmp/cc-niri-live-acceptance.log`。

## 通过的自动实机检查

使用独立 Qt Widgets 进程创建临时 Wayland 窗口，通过短期 KWin Script 改变测试窗口的
原生 desktops/activeWindow，通过 KGlobalAccel 调用生产快捷键处理器，读取 Bridge
protocol 2 快照和实际窗口属性验证。未关闭或迁移用户窗口。

1. 创建两个真实测试窗口。
2. 两个窗口被当前桌面采用并登记。
3. active → inactive 迁移只有一个 Snapshot 归属。
4. J 快捷键挂载下一桌面，Dock workspaceId 一致。
5. 测试窗口进入 Wide，presentation.mode=wide。
6. Wide 迁移保留列 widthMode 和 persistentWide 偏好。
7. K 返回目标桌面后窗口被采用，归属唯一。
8. Floating 窗口迁移保持不进入布局 Snapshot。
9. 目标桌面解除 Floating 后重新采用。
10. 8 轮 H 滚动期间 J/K 往返，最终挂载原桌面。
11. Wide 开始后立即 J/K 往返，随后正常退出 Wide。
12. 连续创建并关闭 40 个真实窗口，结束后无 Lifecycle 测试窗口残留。
13. 两个测试窗口移至 inactive 桌面后关闭，两个 Snapshot 中都不再有其 UUID。
14. cc-niri restart 后恢复当前桌面，关闭 UUID 没有重新出现。

第一次测试脚本误将 Wide 断言为 widthMode=wide；实际 presentation 已正常进入 Wide，
widthMode 仍为 half。清理该次临时窗口后，改用正确的 presentation/persistentWide 字段
重跑，以上 14 项全部通过。

## 结束检查与边界

- 恢复原桌面、原焦点、原列顺序和原 viewportAnchor；临时窗口及状态接收器全部退出，
  临时 KWin 探针均已卸载。组件保持启用。
- KWin Effects.debug 返回 `No window is animated`，静置后没有动画残留。
- 原生日志观察到工作区切换的 `WORKSPACE_CLIP_NATIVE CLEAR`。
- 查询自 16:09:00 起的 KWin core dump 没有记录；对应日志没有 INVARIANT_FAIL、
  FAIL_SAFE、TypeError、ReferenceError。restart 的 external-unload EMERGENCY_RESTORE
  属于正常退出时恢复停车窗口。
- 本次结果验证真实 compositor 的窗口生命周期、迁移、快捷键和结束状态，不代表已观察
  每一帧画面。H/L 动画流畅度、纵向 J/K 动画、透明度/裁剪/残影需用户视觉确认。
- Sticky/multi-desktop、更多异常路径及长期使用仍未在此次实机检查中覆盖；不将 W6/W7
  全部人工验收项记为完成。

临时测试代码、逐步 JSON 快照和日志保存在 `/tmp/cc-niri-live-*`，重启后可能被清理。
