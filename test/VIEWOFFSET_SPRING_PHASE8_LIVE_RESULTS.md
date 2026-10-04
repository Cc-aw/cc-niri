# ViewOffset Spring Phase 6–8：内屏部署与验收

日期：2026-10-04。部署代码：`73980ff`。配套部署、自动实机检查及本轮内屏人工验收通过。

## 部署与恢复

- 升级 Bridge、KWin Script、Script Effect 和 native viewport clip；保留 Plasmoid。
- 升级前保存 Bridge 工作区状态，备份旧脚本、Effect、Bridge binary、kwinrc、workspaces.json 和 native 发现链接。先恢复停放窗口再卸载，未覆盖 KWin 映射中的旧库。
- 新 native canonical 路径：`~/.local/lib/cc-niri/viewport-clip/2af1990b41a6fc23c3fb722b1ab77c70f33bee9ba5c4562b3d44594c9d223043/cc-niri-viewport-clip.so`。
- 四个组件运行并登录启用。KWin 部署前及短验收后均 PID=2088。
- 备份及日志：`/tmp/cc-niri-spring-phase8-backup-20261004-635cfb52`；入口指针 `/tmp/cc-niri-phase8-backup-path`。

## 自动实机检查

仅 eDP-1；viewport 为 x=24、y=50、width=1872、height=960。普通半宽窗口为 932，逻辑间距为 8。

- 慢速正向：约 55ms 时 native active=true。outgoing 仍保持原真实 frameGeometry、opacity=1、minimized=false；完成后 x=-5028、opacity=0、minimized=true。
- 普通半宽布局，20ms 按键间隔执行 `LLHH`、`LLHHLH`、`LLHLHHHLH`。每组完成后 native inactive、焦点符合预期，最终 pending outgoing 正确停放。
- 保持工作区、列 UUID 顺序和宽度；恢复原焦点和 Wide 偏好。为原有两个窗口补一个临时 Konsole，结束后关闭且确认原窗口集合和焦点恢复。
- 最后一轮独立日志范围没有 native fallback、completion timeout、ReferenceError、TypeError、FAIL_SAFE 或 INVARIANT_FAIL。
- 生产 VM 的 equal-offset / 延迟 ACK 矩阵在代码阶段已通过；本次快速实机输入没有强制制造 ACK 延迟，不宣称该特定竞态已被真实屏幕覆盖。

记录：`smoke-result.json`、`smoke-kwin.log`、`deployment.log`、`manifest.json`。自动状态检查不能替代视觉平滑性、间距和重影验收。

## 已观察边界

第一轮在保存为 Wide 的窗口之间以 20ms 间隔换向，发生一次 `native fallback epoch=21`，没有 KWin 重启，窗口及焦点恢复。日志显示此前为 Wide 尺寸 Motion Plan；尺寸变化尚未完成时，新 SCROLL 的真实 frameGeometry 不满足 native 接管前提。第一版 Spring 保留 Wide 尺寸路径，未放宽尺寸与 frame 校验。

该记录保留在 `smoke-first-attempt-kwin.log`。普通半宽单独重测通过；Wide→普通滚动的快速交界仍需人工观察，不能据此宣称所有 Wide 快速混合操作均无回退。

## 人工验收

用户已确认第一轮快速 H/L、动画中反向及交错输入：“正常，连续且间距稳定”。
用户已确认第二轮滚动中 J/K 清理和 Wide 工作区状态保持：“两项都正常”。
两轮后 KWin PID 仍为 2088，人工操作日志没有 native fallback、超时或运行异常。主屏普通 H/L Spring 本轮验收通过；上述 Wide 尺寸变化期间的极快混合操作边界保留记录，不纳入无回退承诺。
人工记录：`manual-result.json`、`user-fast-hl-kwin.log`、`user-workspace-kwin.log`。当前保持新阶段启用，终端可使用 `cc-niri stop` 恢复停放窗口并关闭。
双屏 / mixed DPI 按用户主屏范围要求暂缓。Focus Ring 尚未开始。
