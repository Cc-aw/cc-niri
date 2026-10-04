# ViewOffset Spring Phase 7：连续 Retarget

日期：2026-10-04。实现和自动检查完成，尚未部署。当前实机保持已验收的第五阶段；第六、第七阶段需配套升级。

## 问题与实现

以前每次 relayout 都退休上一段 pendingPark，尚在屏幕内的 outgoing 会提前隐藏。ACK 尚未到达时，下一按键还会从旧 native activeWindow 重置焦点，且新计划的 old offset 可能指向从未实际提交的目标。

- pending ACK 时从逻辑焦点继续推进。最新计划从最后实际提交的 offset 重算，合并尚未提交的目标，旧 ACK 不回放旧几何。
- 新 SCROLL 只暂停上一段完成轮询和看门狗，不提前停放或撤销 native ownership。新 ACK 成功后，将仍未滑出的 outgoing，包括新快照中为 static parked 的窗口，转交新 epoch；原生失败或非 SCROLL 布局走原清理路径。
- 原生 retarget 使用最后一次绘制的 offset，新 Spring 初始速度仍为零。不等旧动画完成，不建立动画队列。
- Native runtime 保留不在新协议 entries 中的上一段 outgoing，并更新最终 strip 投影。没有扩展 protocol 2 或改变 Bridge schema。
- Native effect 提供当前实际 frameGeometry；runtime 同时识别已知 source / target frame，使 arm 到 geometry ACK 之间，以及提交后，都绘制在同一视觉位置。停车坐标、未知位置和 resize 不继承该 source ownership。
- 一对已提交窗口内部的方向焦点移动保持当前 Spring。仍在绘制的旧 outgoing 重新进入时，允许 native incoming 从可见的真实 source 接管，不要求先跳到 parking。
- workspace / output / session、窗口关闭、native 拒绝、超时和非 SCROLL 路径沿用既有清理，暂停的旧轮询、完成回调和看门狗不能清理新 epoch。

## 自动验证

- `node tools/check.js --native`：81 个 JS 测试文件通过；Bridge 5 项 CTest、3 项隔离 D-Bus 测试、Viewport Clip 4 项 CTest、Bridge / Native / Plasmoid 构建通过。
- 最后补充工作区切换和关闭窗口用例后，`node tools/check.js` 81 项再次通过。
- Native runtime 在左右两个同方向链上测试三段目标：40 / 80ms 绘制采样，采样后 3ms retarget。已有窗口在 source 和 target 几何下均与上一帧位置一致；五列中尚未退场的 outgoing 都保留，120ms 采样列间距固定为 8 逻辑像素。
- Native 补充 superseded arm 尚未 geometry ACK 的用例：最新计划 old offset 回到最后实际提交位置，视觉起点仍保持上一帧，旧 epoch cancel 不结束最新 motion。
- 生产 KWin Script VM 测试：连续三次滚动目标推进到第五列，第一段 outgoing 保持原 geometry / opacity / minimized，三段合并的 outgoing 只在最新完成后停放。
- 延迟 Bridge ACK、延迟 native ACK：逻辑焦点不退回旧 activeWindow，合并目标从最后已提交 offset 计算，旧 ACK 不再提交几何。
- 覆盖 pair 内焦点移动不取消 Spring、native 拒绝时清理、暂停旧完成与看门狗、retarget 中 J、关闭 retained outgoing 与迟到回调。
- 现有 Wide、J/K、native ownership、parking、fallback 和协议检查保持通过。

日志：`/tmp/cc-niri-spring-phase7-check.log`、`/tmp/cc-niri-spring-phase7-js-check.log`。

## 验收边界与下一步

本阶段尚未做实机快速连续输入验收，数学连续性和 VM 所有权检查不能替代视觉观察。
部署第六、第七阶段后，检查连续 L/L/L、H/H/H、窗口固定间距和末尾停放，以及滚动中 J/K 和 Wide 回归。
同方向链已覆盖；完整中途换向、快速交错输入和旧完成边界矩阵留给 Phase 8。
核心剩余 Phase 8；Phase 9 mixed DPI / 双屏按主屏范围要求暂缓。
