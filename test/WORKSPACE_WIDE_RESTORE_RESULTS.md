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
