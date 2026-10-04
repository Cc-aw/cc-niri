# ViewOffset Spring Phase 8：中途反向与交错输入

日期：2026-10-04。实现和自动检查完成，尚未部署。当前实机仍保持通过内屏验收的第五阶段，第六至第八阶段待配套部署与快速交互验收。

## 换向边界与实现

已提交目标之间换向继续复用共享 Spring：从上一帧真实 offset 接管，初速度重置为零，不要求速度连续。

新增修复针对 ACK 尚未提交的目标：例如最后提交 offset=0，旧请求已将 native Spring arm 到右侧，随后快速 H 返回 offset=0。两个逻辑 offset 相等，不代表当前绘制位置已经返回。以前会取消动画并直接提交普通布局；现在通过同一个 native ACK gate 发送显式返回计划。

- 独立 ScrollMotionPlan 中增加纯 `prepareViewportReturnPlan`，仅将没有普通 scrollTransaction / Wide motion 的静态目标布局准备为返回计划，不修改原布局。entries 为最终可见列的 visible→visible；既有 pending outgoing 仍通过最新 epoch 转移。
- protocol 2 SCROLL 新增可选布尔 `retargetOnly`。只有该值为 true 时允许 oldScrollOffsetX == newScrollOffsetX；普通计划仍要求两个 offset 不同。字符串标记、标记与 offset 不一致、错误 placement、owner、workspace、session 和 epoch 仍拒绝。
- Bridge 与 native 共用校验器。返回请求让 native 从当前绘制位置回到已提交目标；若此前请求还未到达 native，则自然成为静态完成，不增加等待或动画队列。
- latest plan 继续暂停旧完成轮询，传递或释放 pendingPark 所有权；旧完成与旧 ACK 不会停放重新进入的窗口，也不会覆盖最终焦点。
- 此次使用协议补充，部署需同时更新 Bridge、KWin Script、Script Effect 和 native effect。旧 Bridge / native 拒绝新返回计划时，仍有有界 fallback。

## 自动检查

- `node tools/check.js --native`：82 个 JS 测试文件、Bridge 5 项 CTest、3 项隔离 D-Bus 测试、Viewport Clip 4 项 CTest，以及 Bridge / Native / Plasmoid 构建通过。
- 最后补充完成边界与拒绝反向后，重跑 82 项 JS 检查，并重新构建 / 测试 native viewport clip。
- Native 60ms 换向、采样后 3ms arm：geometry ACK 前后的已有窗口位置均连续；10ms 新段采样与 v0=0 的 Spring 数学一致。
- Native 连续交替目标 epoch 3–9：列间距保持 8 逻辑像素，旧 epoch cancel 不能结束新段，只有最新完成才能清理。
- Native equal-offset 返回：隐式计划拒绝，显式 retargetOnly 接管后不瞬移；此前没有 native arm 时立即静态完成。隐藏且未提交的 incoming 不被误当作 drawable outgoing 保留。
- Native 前一段已完成但尚未清理时，新反向接管仍连续，迟到旧完成不能撤销新段。
- KWin Script 生产 VM：已提交反向、未提交目标返回、L/L/H/L 等交错输入、延迟 Bridge / native ACK、旧完成、最新最终焦点与停放状态、J 中断、native 拒绝、前段完成后重新进入，以及拒绝反向时恢复原 pending outgoing。
- Bridge CTest 与隔离 D-Bus：返回标记完整透传、重复幂等、非布尔或不匹配标记拒绝；旧 SCROLL、Wide 和上下文 authority 保持通过。

日志：`/tmp/cc-niri-spring-phase8-check.log`、`/tmp/cc-niri-spring-phase8-js-check.log`、`/tmp/cc-niri-spring-phase8-native-boundary.log`。

## 实机验收与完成边界

主屏核心 Phase 1–8 的代码阶段已实现；完整快速交互视觉验收尚未完成。
下一步配套部署第六至第八阶段，验证连续 H/L、滚动中反向和快速交错输入、固定间距、最终窗口停放、J/K 清理及 Wide 回归。
Phase 9 mixed DPI / 双屏按用户主屏范围要求暂缓。Focus Ring 尚未开始。
