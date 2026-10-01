# W6 — WorkspaceTransferController

2026-10-01，feature/workspace-stack。实现固定 KDE Desktop 间的单桌面窗口迁移。
本阶段代码完成并自动验证。2026-10-01 与 W7 一起部署后发生 KWin 连续崩溃，实机验收未通过。
用户已停用 Script、两个 Effect 与 Bridge；仓库修复通过离线验证，尚未重新部署。
崩溃证据与测试边界见 [W6/W7 崩溃分析](WORKSPACE_W67_CRASH_RESULTS.md)。

## 行为

- 独立 WorkspaceTransferController 接收 window.desktopsChanged，以 KDE 的最终 Desktop
  列表为归属权威。UUID 只属于一个 Snapshot；由 active Column 或原 Snapshot 携带
  widthMode / persistentWide，新窗口默认 half / false。
- active → inactive：取消待处理的几何提交、窗口 Wide 状态和 Dock scroll，先恢复停车窗口
  的可达坐标、opacity 与脚本拥有的 minimized，再移除 active Column 和原 Snapshot 引用。
  更新 workspaceOwnerId，追加目标 Snapshot，managedByScrollLayout=false、columnId=null，
  转为 WAITING_WORKSPACE，不激活后继或目标窗口。
- inactive → inactive：释放休眠窗口停车状态，迁移 Snapshot 归属及列偏好，不污染 active graph。
- inactive → active：移除旧 Snapshot 引用，经现有 Adoption 等待真正激活，不主动写
  workspace.activeWindow。待激活的列偏好保存在 WindowState，采用时恢复；不会把未挂载列
  发布为 Dock active columns，也不会因一次 active capture 丢掉待采用偏好。
- Sticky / multi-desktop 转换：退出列与 Snapshot，释放停车，owner=null，由 KDE 原生管理。
  Floating/Dialog 继续按原 policy 处理。新原生 Fullscreen 不因休眠快照登记而被采用。
- inactive 新窗口立即登记；启动时也登记现有休眠窗口，保留其已有顺序再追加新窗口。
  inactive 关闭立即清理并发布 Snapshot，避免缓存留下 ghost UUID。
- 迁移过程暂停 Adoption、普通几何布局和 Dock 发布。同步信号重入时合并布局，最终归属
  确定后再提交，避免中间 wrong-workspace 触发 StabilitySupervisor。
  同一窗口在停车释放中再次改变 Desktop 时最多重试 8 次并跟随最终归属；关闭中的窗口
  不会追加到目标。准备/布局/采用/保存异常进入现有 Emergency Recovery，释放全部停车。
- WorkspaceSwitch 的屏障继续生效：迁移清理归属，但不在 AWAITING_KWIN 提前 commit Dock；
  最终 mount reconcile 目标。Emergency Recovery 停止 Transfer，晚到信号不重启布局。

## 自动验证

新增生产 bundle VM 测试，使用 Qt 风格非 Array desktops 与同步几何/激活信号，覆盖：

- visible 与 parked active → inactive，宽度与 Wide 偏好，目标已有窗口后追加；
- inactive → active 的等待激活与采用后偏好恢复，inactive → inactive；
- Wide target 迁移后旧 ACK 无法提交几何；Sticky/multi-desktop 释放并脱离；
- Floating/Dialog 原生行为，新 inactive 窗口、native Fullscreen、inactive 关闭发布；
- WorkspaceSwitch 等待期间迁移、最终 mount、Emergency 后晚到信号；
- 重复信号去重，同窗口与不同窗口同步重入、释放期间关闭、异常恢复。

正常用例同时检查每次 protocol 2 发布的 root 与 active Snapshot 一致、跨工作区 UUID
唯一归属、最终 InvariantChecker 无错误、全过程无 INVARIANT_FAIL / FAIL_SAFE。
完整门禁：66 个 JS 测试文件，QJSEngine Script/Effect 语法、Bridge persistence CTest、
隔离 D-Bus Bridge integration 及三项 native 构建。

## 后续主屏实机验收

部署后通过 KDE 原生“移动到桌面”验证可见窗口、H/L 停车窗口、Wide 窗口及 Floating 窗口
在两个桌面间往返；检查目的桌面可见性、原列移除、目的列追加、焦点和 Dock。再验证
“所有桌面显示”、休眠窗口关闭及 cc-niri restart 持久化。仅需内屏，不需要双屏。
本阶段不添加窗口迁移快捷键，不实现 W7 的 Effect motion/clip 清理与自定义 Workspace 动画。
