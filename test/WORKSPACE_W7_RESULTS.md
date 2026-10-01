# W7 — WorkspaceEffectGuard

2026-10-01，feature/workspace-stack。实现工作区切换的动画与裁剪清理。
代码与自动验证完成，尚未部署到日用会话；W6 同样待部署实机验收。

## 实现

- 独立 WorkspaceEffectGuard 接入 KWin EffectsHandler.desktopChanged 的四参数信号。
  主屏切换递增 Effect epoch，进入 clearing 屏障；其它输出事件不取消主屏动画。
- 清空 MotionTransaction、pendingWideExit，取消所有 MotionController 动画，释放 Wide
  opacity isolation 与 minimize/unminimize grab；清理整个 stackingOrder 上的角色 1001
  （viewport clip）、1003（motion plan）、1004（completion）以及临时视觉属性。
  状态图外残留的旧 animation IDs 也会取消；保留角色 1002 原生裁剪能力。
- clearing 中同步 animationEnded 不执行 Wide completion 或重新建立 isolation。
  取消后旧 IDs 找不到新状态；KWin identity-free 的 animationId=0 增加当前动画时长检查，
  未到本组结束时间（容许一帧 16 ms）不结束新的 Motion，避免旧 group end 提前清理新状态。
- Effect 的 geometryChanged 与 Wide 邻列寻找排除 onCurrentDesktop=false 的窗口，防止
  休眠工作区的几何变化重新开启横向动画或选取错误邻居。切换后正常 H/L Motion 继续可用。
- 原生 viewport-clip 独立监听同一 Desktop signal，按输出清理 active/plan 集合与三个
  角色并 repaint。记录每个输出的切换时间，在改写任何现有 marker 前验证完整计划：
  已关闭/休眠窗口或 issuedAt 早于屏障的排队计划被拒绝；新的有效计划仍可使用。
  同毫秒 issuedAt 允许通过，归属检查仍生效；时间屏障不构成新的跨进程事务协议。
- 不修改 Workspace 的纵向动画，仍由 KDE Virtual Desktop effect 绘制。
  不修改 Bridge schema；Effect/clip 清理与 W4 的布局事务取消配合工作。

## 自动验证

`node tools/build.js`、`node tools/check.js --native` 通过：67 个 JS 测试文件，Bridge
QJSEngine / persistence CTest，隔离 D-Bus integration，native clip 的 AppStream 与
workspace-clip-barrier CTest，以及 Bridge / clip / Plasmoid 三项 native 构建。

新增测试运行真实 CCNiriScrollTransition 构造、信号连接及 MotionController：

- 活动 SCROLL / Pair-to-Wide、pending Wide exit、透明度保持、parking grab 和旧角色同时清理；
- cancel 同步触发 group-end 时不发送旧 completion；取消后的旧 IDs、晚到 group-end
  不提前结束新的动画，新动画按本组时长正常结束；
- orphan animation IDs 与临时视觉属性清理，clip capability 保留，repaint 请求；
- sleeping window 不重启动画、不作为 Wide 邻居；主屏往返与非目标输出过滤；
- 屏障解除后正常横向滚动能重新启动。

原生测试调用生产 clearWorkspaceClipWindows / acceptsWorkspaceMotion，验证输出过滤、
orphan 角色清理、dataChanged 同步修改集合、三个角色全部清除、capability 保留，以及
旧时间/休眠计划拒绝与当前计划接受。生产 Effect bundle 同时经过真实 QJSEngine 编译检查。

## 后续部署与实机验收

W6/W7 需要部署 KWin Script、scripted Effect 与 native viewport-clip。本阶段未操作实机。
之后在内屏验证 H/L 滚动中 J/K、Wide 进入/退出中 J/K、快速桌面往返以及恢复后 H/L；
检查裁剪/透明度/残影并结合 Effects.debug、WORKSPACE_CLIP_NATIVE 日志验收。
Qt/KWin 可能保留已加载的 native library，部署后须确认会话实际运行新版本；构建通过
不能替代真实 compositor 的视觉验收。
