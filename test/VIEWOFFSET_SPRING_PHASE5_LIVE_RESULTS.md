# ViewOffset Spring Phase 4 / 5：内屏部署与验收

日期：2026-10-04。部署代码：`e78ddba`，包含 Wide 工作区恢复修复。

## 部署

- 备份已安装 Script / Script Effect、kwinrc、Dock 快照和旧 native 发现链接；保存工作区状态，再调用 cc-niri stop 恢复停放窗口。
- 配套更新第四、第五阶段的 KWin Script、Script Effect 和 native effect；未改动 Bridge / Plasmoid binary。
- native 插件通过 immutable canonical 路径加载：`~/.local/lib/cc-niri/viewport-clip/38b67426111cf20aea903f05a842f6a9fa891f146561ba7fbd8226d6e794c1fc/cc-niri-viewport-clip.so`。
- 真正 introspection 确认 ArmScrollPlan、CancelScrollPlan 和新增 GetScrollMotionStatus，避免只用 isEffectLoaded 判断新库加载。
- Script / 两个 Effect / Bridge 均已运行，登录启用。

## 自动实机检查

目标仅 eDP-1，viewport 为 x=24、y=50、width=1872、height=960。

| 检查 | 结果 |
| --- | --- |
| 正向、返回的 native ARM | continuing=1 / incoming=1 / outgoing=1 |
| 正向开始约 55ms | status active=true / completed=false，epoch=6 |
| outgoing 真实 frameGeometry | 开始前及动画中均为 x=24、y=50、width=932、height=960 |
| outgoing 绘制状态 | 动画中 opacity=1、minimized=false |
| 完成后停放 | x=-5028、opacity=0、minimized=true；native active=false |
| 返回与恢复焦点 | 原工作区、列顺序和焦点恢复；返回计划 epoch=8 原生接管成功 |
| KWin | 部署前后 PID=2088，一次短验收期间未重启 |
| 日志 | 无 native fallback、completion timeout、ReferenceError、TypeError、FAIL_SAFE、INVARIANT_FAIL |

几何和透明度由临时只读 KWin Script 测量，完成后已卸载。自动检查证明真实 outgoing 延迟停放和原生接管，不能代替视觉间距与平滑性验收。

## 人工验收

用户已确认慢速 Meta+L 两次、Meta+H 两次：“正常，间距稳定且连续滑出”。之前相邻窗口间距拉开的现象在本轮慢速验收中已消失。
用户已确认滚动开始后立即 J、再 K 返回正常，没有窗口消失、残留或裁剪异常；Wide 的 J/K 往返也保持正常，没有退回 50%。

第四、第五阶段本轮内屏验收通过。两轮人工操作后的 KWin PID 仍为 2088，日志没有上述 fallback、超时或运行异常。
快速连续 retarget 和中途反向完整矩阵属于后续 Phase 7 / 8。
双屏 / mixed DPI 暂缓，按用户要求以主屏范围验收。

## 记录

备份与部署日志：`/tmp/cc-niri-spring-phase5-backup-20261004-24989246`。
该目录包含 manifest.json、deployment.log、smoke-result.json、smoke-kwin.log。
当前保持新阶段启用；终端可用 `cc-niri stop` 关闭并恢复停放窗口。
