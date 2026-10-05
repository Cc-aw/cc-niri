# 工作区返回时恢复 Wide

日期：2026-10-02。

## 问题与修复

Meta+J 离开当前桌面，再用 Meta+K 返回时，原本 Wide 的窗口变成 50%。
快照已保存 Wide UUID 和 persistentWide，但 WorkspaceMountController 在挂载末尾无条件重置成 Pair。

挂载仍先清理旧 presentation，然后在保存的 Wide 窗口仍有效、拥有 Wide 偏好且仍被选中时，按稳定 UUID 找到新 Column ID，恢复 contextual Wide，再提交布局。
KDE 选择其他列、窗口已关闭、只有 Wide 偏好而快照为 Pair、以及 fullscreen/maximized 状态，不强行恢复 Wide。

## 自动验证

`node tools/check.js`：77 项通过。新增生产运行时回归检查实际窗口位置和宽度、跨工作区隔离、重新分配 Column ID、原 owner 的后续激活、KDE 改选其他列、已关闭 owner；原工作区切换与过期回调检查保持通过。

## 实机验证

仅热更新当前 Phase 3 KWin Script 中的工作区挂载模块和依赖注入；没有部署 Spring Phase 4 或替换 native effect。

通过 KGlobalAccel 调用实际 WorkspaceNext / WorkspacePrevious 快捷键，确认离开后返回原桌面、原焦点和 Wide owner。临时只读 KWin Script 获取 frameGeometry，测量完成后已卸载：

| 几何 | J 前 | K 返回后 |
| --- | --- | --- |
| x | 286 | 286 |
| y | 50 | 50 |
| width | 1348 | 1348 |
| height | 960 | 960 |

返回后 Dock presentation 仍为 wide。KWin PID 为 1996，与热更新后的检查一致；验证期间日志没有 TypeError、ReferenceError、INVARIANT_FAIL、FAIL_SAFE 或 mount failed。
实机记录：`/tmp/cc-niri-workspace-wide-hotfix/live-result.json`；完整自动检查日志：`/tmp/cc-niri-workspace-wide-fix-check.log`。

## 2026-10-05 修复返回 Wide 时普通邻窗短暂重叠

用户反馈：工作区 1 为 Wide 时，从工作区 2 返回，先显示 Wide 覆盖部分普通邻窗，随后普通邻窗才消失。

此前修复正确恢复了 viewport 与 Wide owner，但 ContextualWideCoordinator 仍把前一工作区的 Pair 当作动画起点，创建新的 Pair→Wide 计划，保留普通邻窗并延迟停放。新增生成运行时回归复现此行为：返回前后 motionPlans 从 1 增至 2，失败日志 `/tmp/cc-niri-wide-return-before.log`。

本次 hydrate 始终明确恢复 Pair / Wide viewport，再通过 `adoptRestoredViewport()` 同步协调器已提交基线、清理旧 pending 状态，之后才提交挂载布局。返回已有 Wide 不再重复播放展开动画，也不重新保留邻窗；正常工作区内 Meta+Z 切换仍走原有动画流程。

自动回归覆盖左右 Wide anchor、原展开 ACK 已完成 / 尚未完成、三轮返回、迟到旧 ACK、每次 opacity 写入、即时隐藏和几何不变量；返回过程中普通邻窗没有一次重新显示。`node tools/check.js` 全部 85 项通过，生成包与 whitespace 检查通过，日志 `/tmp/cc-niri-wide-return-check.log`。

已只更新布局脚本，并使用现有 cc-niri stop/start 恢复流程加载。安装 SHA256 为 `ed6446fd6991a8aa1d100f3596e7819c08b286788e05d28233c71b8fa7556f45`，与修复源码一致；KWin PID 部署前后保持 2083。动画 Effect、Native Clip、Focus Ring 与 CLI 安装 hash 保持不变；Script、相关 Effect 与 Bridge 运行正常，Ring 绘制 active=true、cornerRadius=12。部署日志未发现新增脚本异常、INVARIANT_FAIL、FAIL_SAFE、mount failed 或崩溃错误。

备份与命令审计：`/tmp/cc-niri-wide-return-backup-20261005-qwdnen68`；部署脚本 / 日志：`/tmp/cc-niri-wide-return-deploy.py` / `deploy.log`。部署后用户反馈“功能正常”，本轮内屏 Wide 返回瞬态画面验收通过。
