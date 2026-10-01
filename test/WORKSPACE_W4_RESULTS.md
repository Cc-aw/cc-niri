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

本阶段提交时未部署日用脚本；本轮后续部署记录见下节。W4 实机视觉验收尚未完成；本机 native 构建不代表远程 CI。
下一次主屏测试使用 Meta+J 向下、Meta+K 向上，检查 1 → 2 → 1 的列顺序、焦点、
滚动锚点及 Dock；快速连按、Wide/Dock scroll 中切换、切换时新增/关闭窗口，以及 emergency。
现有单内屏即可验收，不以双屏为前提。

Snapshot 当前仅在脚本运行内保存；跨 Reload 的多 Workspace Bridge 持久化留到 W5。
完整窗口 transfer 留到 W6；Effect motion/clip 清理留到 W7。

## 部署与终端控制（2026-10-01）

按用户要求执行完整 `./install.sh`，W4 已部署到当前用户 KWin Script。
新增 `~/.local/bin/cc-niri start|stop|restart|status`，仓库 `./cc-niri` 同样可用。
Installer 在全部 build 成功后先恢复/停止旧 runtime，再替换 native binary 和 packages；
Uninstaller 复用同一 stop 路径。日常启停不重新编译或重启 Plasma Shell。

部署后实际执行一次 `./cc-niri restart`，关闭与重新启动成功。status 确认 Script loaded=true、
登录启用=true、transition/viewport-clip 两特效已加载、Bridge active。
安装的 main.js 与仓库 W4 bundle 完全一致；终端命令与仓库内容完全一致。
Meta+J/K 已注册并写入 KGlobalAccel 配置。Bridge 已发布主屏 eDP-1、Workspace 1 的初始状态。
部署日志未发现本轮 workspace failure、invariant failure 或 JavaScript 运行异常。

终端控制 mock 测试验证恢复→卸载→Bridge stop 顺序、恢复失败拒绝卸载、
D-Bus 查询失败拒绝继续、重复 start/stop、targeted Script.run、先 native 后 scripted effect、restart 和 status。
新增控制测试后的完整 gate 为 61 个测试文件、三项 native 构建通过。
用户接下来进行主屏 Workspace 上下切换与窗口布局的视觉验收。

## 实机 H/L 无效修复（2026-10-01）

用户反馈 H/L 无效，实际读取 Bridge 发现 Columns 为空，而 Script、Effects、Bridge 及
Meta+H/L 注册正常。临时只读 KWin 诊断确认 window.desktops 是 Qt sequence：length=1、
可按索引/map 读取，但 Array.isArray=false。原 WorkspaceMembership 的 Array.isArray gate
错误排除了全部普通窗口；此前纯 JS Array 的 VM fixture 未暴露此差异。

WorkspaceMembership 改为验证 object + 非负整数 length，然后按索引复制为 JS Array。
继续排除空列表 Sticky、多 Desktop、非法 ID；字符串或非法 length 不被视为有效归属。
新增 Qt sequence 单元回归；完整生产 bundle 的 VM 中所有窗口 desktops 改用非 Array
的索引列表，覆盖启动、切换、Adoption 和 membership 变更。61 文件测试及 native 构建通过。

仅升级 KWin Script 并安全停止/重启；无须重启 Plasma Shell。真实 Bridge 确认普通窗口
已进入 Columns。连续调用 L/H 后读取 focusedUuid，确认分别移到下一列和上一列，
不再停留于空 Columns。独立窗口诊断脚本已卸载，未改动窗口 Desktop 归属。
