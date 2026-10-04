# ViewOffset Spring Phase 5：Outgoing Deferred Park

日期：2026-10-04。代码和自动验证完成，尚未部署；当前实机会话仍为 Phase 3 加工作区 Wide 恢复修复。

## 实现

- ScrollViewportRuntime 将 outgoing 加入共享投影。其真实 frameGeometry 保持旧可见位置，绘制位置按 logicalX 和同一帧 Spring offset 计算；incoming / continuing 继续采用最终真实位置。
- GeometryCommitter 在原生 ACK 成功时收集 pendingPark，不提前提交停放坐标、降低透明度或最小化。旧路径和 native 拒绝路径继续立即停放。
- 独立 DeferredScrollParking 模块持有 epoch 和 session / workspace / output，按 32ms 查询原生 GetScrollMotionStatus。只有匹配的真实完成状态才提交最终停放并 disarm；动画时长不是完成依据。
- Spring 完成后仍保持最终裁剪投影，避免 JS 完成确认前旧位置闪回；此时停止持续 repaint。JS 最终停放时保留 outgoing ownership marker，使 Script Effect 跳过旧 outgoing 动画，随后撤销原生 ownership。
- 失联看门狗为 3500ms；先等待 Cancel ACK，丢失 ACK 再通过 150ms 有界恢复。旧回调、重复完成和已关闭窗口不会写入新布局或重建状态。
- 普通新 SCROLL 退休旧 pendingPark 时保留 native 最后绘制采样供 retarget 使用；工作区切换、非 SCROLL 布局和恢复路径通过原 gate 取消并清理。

## 验证

- `node tools/check.js --native` 通过：79 个 JS 测试文件、Bridge 5 项 CTest、3 项隔离 D-Bus 测试、Viewport Clip 4 项 CTest，以及 Bridge / Viewport Clip / Plasmoid 三项构建。
- 后续清理与 Script ownership 检查更新后重跑 `node tools/check.js`，79 项通过。
- 原生逐帧双向测试：0 / 7 / 20 / 60 / 100 / 220 / 400ms，outgoing 保持可绘制，三类窗口间距均为 8 逻辑像素。完成后 outgoing 保持在 viewport 外，取消后 ownership 与完成状态清空。
- 生产 KWin Script VM：A | B → B | C 的 outgoing 保留原 geometry / opacity / minimized；原生完成后才停放。覆盖 J/K 中断、关闭窗口、native 拒绝、连续 retarget、过期完成。
- Script Effect 测试：只有匹配旧真实位置的 outgoing marker 跳过最终停放的旧动画，错误 marker 保留 fallback。
- 控制器测试：错误 epoch / workspace、重复完成、跨会话上下文清理、浮动窗口、丢失完成与 Cancel 回调、有界恢复。

日志：`/tmp/cc-niri-spring-phase5-check.log`、`/tmp/cc-niri-spring-phase5-js-check.log`。

## 边界与下一步

第四与第五阶段需配套部署 Script、Script Effect 和 native effect 后完成内屏验收。
逐帧数学与生产运行时检查不能代替实机视觉验收，此前相邻窗口间距变化仍待确认。
快速连续操作时，旧 outgoing 的退休与重新进入仍沿用当前布局提交边界，完整连续 retarget 矩阵属于 Phase 7。
下一开发阶段为 Phase 6：在 native capability 有效时彻底关闭普通 SCROLL 的旧 Script motion 路径，保留 fallback。
