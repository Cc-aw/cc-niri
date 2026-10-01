# ViewOffset Spring Phase 3：原生 continuing 投影

日期：2026-10-01。基线：Phase 2 `a57bf01`；分支 `codex/native-view-offset-scroll`。

## 本阶段实现

- `ScrollViewportRuntime` 独立维护 SCROLL session/workspace/output、epoch、共享
  ViewportMotion 和 UUID → target rect；不保存 EffectWindow 指针，不改真实几何。
- 仅 `visible → visible` 列交给 native；同一 paint pass 共用一次单调时钟采样。
  位移为 `targetOffset - paintedOffset`，等价于
  `viewport.x + logicalX - paintedOffset - realFrame.x`。
- 帧间 retarget 从上一帧实际绘制的 offset 重新起 Spring，第一版速度重置为 0。
  target rect 尚未提交时不投影；无 continuing 的跳跃退回旧路径。
- 原生 Effect 完成 transformed mask、持续 repaint、direct scanout 阻断，以及
  RenderViewport 的逻辑 viewport → device clip 映射。
- Script 先经 Bridge 发布计划，再调用 `org.kde.KWin` 下
  `/ccNiriViewportMotion`、`org.cc.NiriViewportMotion1.ArmScrollPlan`。
  Native 验证工作区与真实 continuing 源几何，安装 role 1005 后回复 ACK；
  ACK 后 Script 才提交原几何计划及延迟的焦点激活。
- `ScrollPlanCommitGate` 与 Wide gate 独立。拒绝、同步异常或 150 ms 超时进入
  回退；通常先等 `CancelScrollPlan` 确认角色已清除，再提交旧动画几何。
  取消端点不可达时最多再等待 150 ms，避免布局一直阻塞。
- Scripted Effect 在 role 1005 安装时取消该列的旧动画；实际 continuing 几何事件
  仍建立旧 SCROLL transaction，供 incoming/outgoing 推断方向，但匹配 native target
  的 continuing 不再播放 Script Translation / Scale / Opacity。
- session/workspace/output 改变、无效 authority、桌面切换、输出删除、关闭/删除窗口、
  emergency restore、workspace transfer 和 Effect 卸载清理 ownership。
  旧 epoch 的取消不能清除新 motion；取消的 epoch 不能被迟到 arm 复活。

## 验证

完整门禁 `node tools/check.js --native` 通过：

- 74 项 JS 测试；包含 Bridge ACK 与 native ACK 的提交顺序、取消确认顺序、
  超时及有界回退、异常、过期 ACK、workspace switch 和 Script continuing 通道交接。
- Bridge：5 项 CTest；3 项隔离 session bus 集成测试。
- Viewport Clip：4 项 CTest；新增测试直接编译生产 `ScrollViewportRuntime`，验证
  fractional/负坐标、首帧 old projection、提交前排除、共享采样、重复/冲突 epoch、
  reverse 的位置连续、取消、settle、workspace/reload/窗口关闭、非重叠回退。
- Bridge、Viewport Clip、Plasmoid 全部构建成功。
- 最后的帧间 retarget 起点修正后，再构建 Viewport Clip 并补跑全部 4 项 CTest。

日志：`/tmp/cc-niri-spring-phase3-check.log`、
`/tmp/cc-niri-spring-phase3-final-native.log`。

## 阶段边界与后续

本轮没有安装或启用新 bundle / .so；没有声称实机动画验收通过。
阶段 0 的新 H/L 视频基线仍需在实际部署前补录。

incoming/outgoing 仍由旧 Scripted Effect 播放；它们与 continuing 的曲线尚未统一。
跨角色连续 L/L/L、快速按键、完整 reverse、混合缩放的视觉闭环仍需后续阶段及实机验收。
本阶段证明共享投影与同一 continuing 列的帧间 retarget 数学连续，不能替代完整视觉验收。

下一步 Phase 4：incoming 从 parked → visible 后使用 native projection，并关闭其旧
Translation / Scale / Opacity；Phase 5 再处理 outgoing 的 deferred park。

## 后续实机部署

2026-10-01 23:02 起完成第三阶段部署，详见[内屏验收记录](VIEWOFFSET_SPRING_PHASE3_LIVE_RESULTS.md)。
上面的“本轮没有安装”描述的是 `07591a9` 开发提交完成时的状态；本次验收中发现并修复
原生库热加载复用问题，确认 native ARM 和工作区清理正常。滚动中间距变化仍待 Phase 4/5。
