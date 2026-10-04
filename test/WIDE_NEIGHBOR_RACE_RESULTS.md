# Wide 返回 Pair：邻窗偶发不可见竞态修复

日期：2026-10-04。代码和自动验证完成；已单独部署动画脚本并通过加载检查，用户确认原缺窗问题已修复。

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

## 本轮单独部署与实机验收

用户再次反馈截图里右侧窗口没有出现。核对时发现已安装动画脚本仍为旧版本：未包含 WideNeighborLifecycle，SHA256 为 `d6414bd5d9d7efe655c4274104b55509f5adb42febcb24e52972132d477f58c7`。此前代码 / 自动回归通过不能代表当前桌面问题已经消失。

本轮通过已安装 `cc-niri stop/start` 的恢复流程，只替换 `effects/cc-niri-maximize-scroll-transition/contents/code/main.js`：

- 已安装与仓库修复版 SHA256 一致：`38c85a97fd2f485463784a857a1d8541f86d90ad5696d394aeb5b17cef3fd8fa`，Effect 加载成功。
- KWin PID 前后均为 2088，没有重启；布局 Script 加载成功。
- 已安装布局 hash 前后相同；Focus Ring 仍为 `static-isolated-border-poc`，Phase 2 未部署。
- 未覆盖 Native 库，没有安装源码里新的 Phase 2 插件。
- 备份与命令审计：`/tmp/cc-niri-wide-neighbor-backup-20261004-l_od7rgz`，包含旧 Effect、kwinrc、Bridge 原快照、commands.json、manifest.json、result.json、部署后 KWin 日志。
- 日志没有新 Effect 语法错误或 KWin 崩溃；旧布局的 QV4 deferredScrollParking 前向引用警告仍可见，本轮未修改该布局。

部署后邀请用户复测 Meta+L 从 72% Wide 返回 `1|2`，以及 H/L 往返。用户于 2026-10-04 回复“这次修复了”，确认原邻窗不可见问题已解决，本缺陷实机验收通过。用户未逐项记录不同往返间隔，不将该反馈扩展为完整时序矩阵验收。Focus Ring Phase 2 尚未部署。

后续 Focus Ring Phase 2 配套验收时，在主屏用 Meta+Z 为窗口 1 保留 Wide 偏好，然后重复 Meta+L 返回 `1|2`、Meta+H 回到窗口 1；分别测试立即反向、动画刚结束和等待停放后返回。确认窗口 2 都会出现，位移 / 淡入连续，不需要额外点击。再检查普通 H/L、滚动中 J/K、Wide J/K 状态保持，以及独立 Focus Ring 的新版本资格同步。
