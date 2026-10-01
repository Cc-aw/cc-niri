# W2 — Workspace Membership（2026-10-01）

新增 WorkspaceMembership 纯 JS 模块与 ADOPTION_WAITING_WORKSPACE。
WindowState 新增 workspaceOwnerId：单 Desktop 使用其稳定 ID，Sticky / multi-desktop 为 null。
窗口归属与当前是否 mounted 分开表达。

## 行为

- WindowPolicy、用户 Floating 判定优先于 Workspace；Workspace 先于 output、
  fullscreen/maximize/tile 和 activation 判定。
- 其它 Workspace 的新窗口保持 waiting-workspace；active/ready/geometry/output
  信号不能绕过此门槛加入当前 Column。
- Sticky、零 Desktop、多 Desktop、无有效 Desktop ID 的窗口不能进入 Column；
  返回 ignored，保持 KDE 原生行为。
- Startup、直接 addColumnAt、Floating attach 均检查当前主屏的 Desktop 归属；
  Startup 不会对其它 Desktop 或 Sticky 窗口执行 maximize/tile 的准备操作。
- Floating 的记忆窗口不能跨 Workspace 重新加入或拉走焦点。
- window.desktopsChanged 薄连接进入 AdoptionController：更新 owner、重新判定。
  managed 窗口变为 Sticky 或离开当前 Desktop 时走普通 detach，恢复 parking
  的 opacity/minimized 和可访问 geometry，不激活 successor。
- 新增 sticky-managed critical invariant（含 multi-desktop），保护 Column 单归属。

窗口改 Desktop 的这条基础 detach/adoption 路径不写 WorkspaceSnapshotStore；
完整 transfer 和休眠 Snapshot 更新在 W6 实现。
W2 不监听 Workspace 切换，不实现 per-Workspace mount、恢复或 J/K。
未部署日用脚本；W3 实现 mount 后再验证完整多 Workspace Column 切换。

## 上下布局修正

用户明确要求 Workspace 上下切换，仅主屏实现。
通过 KDE VirtualDesktopManager 将当前两个 Desktop 从 Rows=1 改为 Rows=2，
形成 2 行 1 列；kwinrc 的 [Desktops] Rows=2 已持久化。
保留两个 Desktop 的稳定 ID、名称和 navigationWrappingAround=false。
通过 kglobalaccel 触发 Switch One Desktop Down 后读取 current 为桌面 2，
触发 Switch One Desktop Up 后读取 current 为桌面 1，完成原生方向往返。
原生按键为 Meta+Ctrl+Down / Up；Meta+J/K 待 W4。
这是 KDE 原生布局调整，cc-niri 没有添加纵向 compositor 或动画。
双屏隔离测试可选，且不阻塞当前主屏开发。

## 验证

先写 membership / adoption tests，再实现模块和最薄 wiring。
另补 runtime guard 测试，实际执行生成脚本的 Startup、addColumnAt 和 removeColumn，
验证 parked → Sticky 后 geometry/opacity/minimized 均恢复可访问。
覆盖 Floating 跨 Workspace 焦点隔离和 critical invariant。

`node tools/build.js`、`node tools/check.js --native` 通过：55 个测试文件；
Bridge / Viewport clip / Plasmoid 本机 native 构建通过。
新增 parking 回归断言单独运行通过。远程 CI 未触发。
