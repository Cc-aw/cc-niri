# W3 — 原生 Desktop 切换与批量 Workspace Mount

2026-10-01，feature/workspace-stack。实现仅管理 targetOutput（主屏）的 Column Session。
纵向布局沿用 W2 已设置的 KDE 单列桌面；本阶段不实现 J/K 或自定义 Workspace 动画。

## 实现

- VirtualDesktopTopology：KDE 顺序、稳定 Desktop ID、current(output)、非 wrap
  previous/next，以及主屏 Desktop 事件过滤；null output 按全局事件处理。
- WorkspaceMountController：唯一 activeWorkspaceId，其它 Workspace 存放纯数据 Snapshot。
  原生 currentDesktopChanged 查询 KDE 实际 current，避免信号旧 payload 覆盖实际状态。
- 切换屏障：cancel MotionPlanCommitGate、Dock scroll、ContextualViewport reveal、
  ContextualWideCoordinator。实际 KDE Desktop 与 mounted ID 不一致时也提前阻止 Adoption，
  覆盖 activeChanged/windowActivated 先于 currentDesktopChanged 的信号顺序。
- capture → 专用 unmount → reconcile → 全部建 Column → recompute logical layout →
  恢复焦点和 anchor → Pair + normal → 一次 relayout → Dock generation commit。
  空 Workspace 也完成一次布局事务；Startup 的初次 Dock 发布仍由 RuntimeLifecycle 完成一次。
- Unmount 不调用 removeColumn、不释放 sleeping parking、不更改归属、不重置 nextColumnId；
  清理 mounted 标记、临时 Column ID 和跨 Workspace 的 viewport 临时引用。
- Reconcile 保留仍存在的旧 UUID 顺序，丢弃关闭或失效归属，追加新 eligible 窗口；
  Sticky/multi-desktop、Floating/Dialog、其它输出及无 UUID 窗口不进入 Columns。
  native maximize/tile 准备后的归属会再次检查；准备中新增窗口通过第二轮枚举加入同一批次。
- 焦点顺序：KDE 当前 active Column → Snapshot focusedUuid → 第一列 → 空列表 -1。
  只恢复 Column focus，不抢 KDE activeWindow。
- 在 logicalX 计算后恢复 UUID + delta 锚点并 bound。有效锚点保持原值；若 KDE
  选择了不同于 Snapshot focus 的 Column，则优先 reveal KDE 的焦点。
- 保存并恢复 widthMode、persistentWide；每次 mount 强制 Pair + normal。
  已属于 Snapshot 的 managed fullscreen 保留 Column 归属且不强制退出 fullscreen；
  新的 native fullscreen 不通过 mount 自动加入。
- 关闭窗口清理休眠 Snapshot；休眠窗口变 Sticky/policy-floating 时立即释放停车状态。
  基础 membership 变更仍使用 W2 detach/adoption 路径；完整 transfer 偏好迁移留到 W6。
- 新增 wrong-workspace、mounted-workspace-owner、inactive-mounted、
  duplicate-workspace-owner critical invariants。Invariant audit 在完整 mount 后执行。
- 失败关闭屏障、停止 controller，并调用既有 emergency Recovery 恢复所有 Workspace
  的 script-owned parking、禁用布局。准备中出现新的原生 Desktop 切换时，批次结束后
  再 reconcile KDE 最终 current，避免停留在旧 mounted ID。

RuntimeLifecycle 负责 Desktop 信号连接/断开；main.js 仅增加实例化、依赖注入、
薄 signal wiring 和入口 guard，Startup 批量算法移入 WorkspaceMountController。
StartupLayout 保留，旧 protocol 1 的单 Workspace 保存数据映射到当前 KDE Desktop。
Dock Snapshot 增加 workspaceId/workspaceIndex，仍仅发布 active columns。

## 自动验证

`node tools/build.js`、`node tools/check.js --native` 通过：59 个测试文件；
Bridge / Viewport clip / Plasmoid 本机 native 构建通过。

新增 topology、mount、ownership invariants 和完整生成脚本的 VM 集成测试。
VM 使用模拟 KWin signals/windows、Bridge 回调与 QTimer，执行实际生产 bundle，覆盖：

- 启动、1 → 2 → 1、空 Workspace、新/关闭窗口、顺序、焦点、滚动锚点和 Wide 偏好。
- 每次原生 Desktop change 恰好一个 relayout，Startup 仅一次 Dock 发布。
- 焦点信号提前到达、stale Desktop payload、prepare 期间新增/归属变化/再次切桌面。
- 原生 Fullscreen 保持、Maximized/Wide 返回 Pair + normal。
- 实际 DockScrollController 的旧 deferred command 与 MotionPlanCommitGate 的旧
  Wide ACK/timer，在新 Workspace mount 后均不能写 geometry。
- sleeping parked → Sticky 的 geometry/opacity/minimized 恢复，以及 emergency
  Recovery 对所有 Workspace 停车窗口的可访问性恢复。
- prepare 异常退出屏障，保持 controller 停止状态。

## 当前边界与实机验收

未部署日用脚本，VM 不代替实机视觉验收；远程 CI 未触发。
W3 Snapshot 只在本次脚本运行内保存，跨 Reload 的所有 Workspace 持久化是 W5。
完整窗口 transfer 元数据是 W6；Effect motion/clip 清理是 W7。

下一轮主屏实机准备：桌面 1 至少 5 个普通窗口，桌面 2 至少 2 个；
可用已有空桌面测试空列集。使用 Win+Ctrl+Down/Up 原生上下切换，
验证 1 → 2 → 1 的 order/focus/scroll/Dock，以及 Wide 中切换、Dock 连续滚动中切换、
休眠窗口关闭、新窗口、所有桌面开关和 emergency restore。
主屏验收不以连接双屏为前提。Meta+J/K 待 W4；不将 Reload 全 Workspace 恢复判为 W3 验收项。
