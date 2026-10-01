# W4 — Workspace 切换事务与 Meta+J/K

2026-10-01，feature/workspace-stack。仅管理主屏 Column Workspace。

## 实现

- 独立 WorkspaceSwitchController：IDLE → PREPARING → AWAITING_KWIN → MOUNTING → IDLE。
  Meta+J 请求 KDE 顺序中的下一个 Workspace（向下），Meta+K 请求上一个（向上）。
  到达边界不 wrap、不创建 Desktop；纵向动画使用 KDE 已配置的单列桌面布局。
- 切换开始即建立 workspaceSwitching 屏障，取消 MotionPlanCommitGate、Dock scroll、
  ContextualViewport reveal、ContextualWideCoordinator，然后 capture 原 Workspace。
  请求 KDE 前启动 400ms 单次定时器，兼容 setter 同步发出 Desktop signal。
- AWAITING_KWIN 保留旧 Columns 供恢复，暂停 Adoption、布局快捷键和 Dock 布局命令。
  重复 J/K 忽略，不排队。等待期间新增窗口只记录归属，最终 reconcile 时批量加入。
  关闭窗口正常清理 UUID/Column 归属，但屏障期间不激活旧后继、不提前 commit Dock。
- mountPrepared 复用 W3 批量 mount，保持外层屏障；不会在 KDE 已切换后再次 capture
  覆盖旧 Workspace Snapshot，也不会提前开放输入。最终挂载后只 commit 一次 Dock generation。
  准备期间再次发生原生 Desktop change 时，继续挂载 KDE 最终 current；连续 8 次不稳定则 Recovery。
- 原生 Desktop 切换同样经过事务。Desktop signal 忽略旧 payload，查询实际 current(output)；
  其它输出信号不完成主屏切换。Topology change 等待期间立即按实际 Desktop reconcile。
- 400ms 超时或 KDE 请求抛错后挂载实际 current，可能是原 Workspace、请求目标或其它 Desktop。
  不把请求目标当作切换成功的依据。准备或挂载失败调用 emergency Recovery 并禁用布局。
- switchEpoch 独立单调递增，旧 timeout 回调不能完成新事务；Recovery 先 stop switch，
  增加 epoch、断开定时器，再恢复所有 Workspace 的窗口停车状态。
- KDE 请求使用 setCurrentDesktopForScreen(desktop, output)，不可用时回退 currentDesktop setter。
  RuntimeLifecycle 继续负责信号连接/断开；main.js 仅增加实例化、入口 wiring 与屏障 guard。

## 自动验证

`node tools/build.js` 和 `node tools/check.js --native` 通过：60 个测试文件；
Bridge、Viewport clip、Plasmoid 三项本机 native 构建通过。

独立事务测试覆盖上下边界、重复输入、同步/异步信号、超时恢复三个实际 Desktop、
请求异常、定时器异常、过期 epoch、外屏过滤、旧 signal payload、准备期间再次切换、
Topology change、输出丢失失败恢复、capture/mount 异常，以及 stop 后晚到的 signal/timeout。

生成生产 bundle 的 VM 集成测试覆盖真实快捷键注册/调用、KDE API fallback、
等待期间新增/关闭窗口、其它快捷键与 Dock presentation 屏障、单次 Dock generation、
Wide 旧 ACK 在等待与挂载后不能写 geometry、超时重挂载、旧 epoch timeout，
以及切换等待期间 emergency 恢复全部窗口且停止旧回调。W0–W3 与现有 V3 回归均通过。

## 边界与主屏实机验收

未部署日用脚本，尚未做 W4 实机视觉验收；本机 native 构建不代表远程 CI。
下一次主屏测试使用 Meta+J 向下、Meta+K 向上，检查 1 → 2 → 1 的列顺序、焦点、
滚动锚点及 Dock；快速连按、Wide/Dock scroll 中切换、切换时新增/关闭窗口，以及 emergency。
现有单内屏即可验收，不以双屏为前提。

Snapshot 当前仅在脚本运行内保存；跨 Reload 的多 Workspace Bridge 持久化留到 W5。
完整窗口 transfer 留到 W6；Effect motion/clip 清理留到 W7。
