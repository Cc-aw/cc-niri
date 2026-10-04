# Wide 返回 Pair：邻窗偶发不可见竞态修复

日期：2026-10-04。代码和自动验证完成，尚未部署 / 实机验收。

用户现象：窗口 1 的 72% Wide 视图按 Meta+L 返回 `1|2`，窗口 2 偶尔不出现。用户确认触发键是 Meta+L。本轮在 Focus Ring Phase 2 部署前先修复此问题。

## 已复现的原因

Wide 进入时，窗口 2 的真实 frameGeometry 可能暂时留在原半宽槽位，由 Script Effect 将它移出并淡出；动画完成后，可用持续的 opacity=0 hold 等待真实停放。

快速返回 Pair，或真实停放 / resize ACK 尚未完成时，窗口 2 仍在 Pair 目标位置。GeometryCommitter 不写相同几何，因此不会为它产生新的 geometryChanged。原 Effect 只在几何路径上恢复邻窗：

- 返回后仍保留旧 `PAIR_TO_WIDE/outgoing` 动画，稍后把窗口 2 继续淡出。
- 退出窗口 1 的几何事件已经清理过 hold，但旧邻窗动画随后完成，又安装新的持续透明 hold。
- 两个窗口没有新的几何事件时，已经存在的 hold 也无法仅靠新的 WIDE_TO_PAIR plan 清理。

新增真实 CCNiriScrollTransition / MotionController 回归在修改前稳定失败：返回后邻窗的动画类型仍为 `PAIR_TO_WIDE`，预期为 `WIDE_TO_PAIR`。这复现了代码中的可见性竞态；原实机日志未开启 JS debug，不能单凭日志断言每次用户现象都由同一条时序触发。

## 修复

- 独立 `src/effect/WideNeighborLifecycle.js` 处理邻窗可见性生命周期；不修改布局、72% 偏好、Spring、停放规则或 Focus Ring。
- 监听既有 native motion plan role 1003 的变更。收到 WIDE_TO_PAIR / neighbor 后，主动释放旧 hold，移交旧 Wide 出场动画，恢复不依赖 frameGeometry 变化。
- 邻窗仍在 Pair 目标位置时，用 MotionController 从当前已绘制位移 / opacity 连续 retarget 到位置 0 / opacity 1，沿用原生 clip 和现有 Presentation duration；不写真实几何。
- 邻窗已在停放位置时，只清理旧动画，后续由原有 parked → visible 几何路径恢复；不重复启动入场。
- 出场完成回调在创建持续透明 hold 前，再核对当前 native plan 的类型、role、epoch；Pair 新计划已经接管时，旧完成回调不得重新隐藏邻窗。
- 保留无 native plan 的 geometry-only fallback；活动桌面、目标输出、有效 plan epoch / 时间戳 / 几何检查限制处理范围。

## 验证

- 修复前失败日志：`/tmp/cc-niri-wide-neighbor-before.log`。
- 新 `wide-neighbor-race.test.js` 使用真实生成 Effect、真实 MotionController 与同步 cancel 回调，覆盖左右两个槽位、退场未结束反向返回、动画完成但尚未停放的 hold、没有任何新几何事件、parked → visible、延迟 / 丢失 plan 通知及 30 次不同间隔往返。
- 反向 retarget 的初始视觉位置和 opacity 与原动画采样连续；完成后 opacity=1，没有持续透明 hold。
- 现有 Wide 几何、workspace cleanup 和所有 native SCROLL bypass 回归通过。
- `node tools/check.js`：85 个 JS 测试文件全部通过，生成包一致性和 diff whitespace 通过。日志 `/tmp/cc-niri-wide-neighbor-gate.log`。
- `ctest --test-dir build/bridge -R kwin-javascript-syntax --output-on-failure` 通过，实际 KWin 使用的 Qt JavaScript 引擎可解析新生成 Effect。

## 部署验收待办

未改正在运行的插件 / 脚本。Focus Ring Phase 2 也仍未部署。

配套部署后，在主屏用 Meta+Z 为窗口 1 保留 Wide 偏好，然后重复 Meta+L 返回 `1|2`、Meta+H 回到窗口 1；分别测试立即反向、动画刚结束和等待停放后返回。确认窗口 2 都会出现，位移 / 淡入连续，不需要额外点击。再检查普通 H/L、滚动中 J/K、Wide J/K 状态保持，以及独立 Focus Ring 的新版本资格同步。
