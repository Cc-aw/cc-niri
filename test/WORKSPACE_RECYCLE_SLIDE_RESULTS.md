# 空工作区回收等待切换动画结束

日期：2026-10-05。修复、自动验证与配套部署完成；用户确认“已经修复”，内屏交互验收通过。

用户反馈：进入新工作区并关闭最后一个窗口后，按 K 返回上一个工作区时卡顿，怀疑空工作区在向上切换动画未结束时已被删除。

## 原因与修复

WorkspaceRecycleController 原先只检查布局挂载是否完成，200ms debounce 后便可回收不再是 current 的空工作区。逻辑 currentDesktopChanged 与最终动画完成不同步。本机 KWin 6.7.5 [Slide 实现](https://raw.githubusercontent.com/KDE/kwin/v6.7.5/src/plugins/slide/slide.cpp) 使用 Spring 运动判断动画完成，并将 desktopRemoved / desktopAdded 连接至 finishedSwitching；因此中途删除原工作区会直接终止尚未结束的切换。

- Native Clip 的既有 `/ccNiriViewportMotion` endpoint 新增只读 `WorkspaceTransitionActive()`，读取 compositor `hasActiveFullScreenEffect()`。Slide 在真实 Spring 完成后才清除此标记；其他全屏 Effect 活跃期间也保守禁止回收。不改变 Slide 时长或动画算法。
- 回收发现候选空工作区后，先异步查询真实 compositor 状态。仅明确返回 false 才重新计算工作区拓扑、当前保护集合与实时窗口归属，然后提交删除，不沿用查询前的候选对象。
- 每次 currentDesktopChanged / desktopsChanged 使旧查询失效，防止快速 J/K 往返后旧 idle 回复放行删除。停止后迟到回复无效。
- 查询仅在存在回收候选时发起，同一时刻至多一个请求。忙碌 / 无效回复沿已有 200ms 调度重查，每轮最多 60 次，每次有 1000ms 回复超时保护。未确认 idle 则保留工作区，耗尽后停止重试，后续外部事件可以重新请求；不是常驻逐帧查询。
- 未改变原 W9 的当前桌面、其他输出当前桌面、末尾空桌面和窗口归属保护规则；默认开关与 W8 依赖不变。

## 自动验证

新增运行包回归在修复前失败：`empty source desktop survives the entire compositor slide`，日志 `/tmp/cc-niri-recycle-slide-before.log`。

修复后覆盖 compositor 活跃期间保留空源桌面、idle 后无需新输入即可自动回收；补充仅单个在途查询、迟到旧回复、原当前桌面变动、等待期间新增窗口、停止后回复、无回复超时和有界重试。DockGateway 检查状态请求发往正确的原生 endpoint。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| 完整 JS 门禁 / 生成包 / whitespace | 85 项通过 | `/tmp/cc-niri-recycle-slide-js-tests.log` |
| Native Clip 插件与测试构建 | 通过 | `/tmp/cc-niri-recycle-slide-native-build.log` |
| Native Clip CTest | 4 项通过 | `/tmp/cc-niri-recycle-slide-native-tests.log` |

自动检查证明删除与原生状态的调度关系，不替代 K 返回时的最终画面观感。此前 Wide 返回重叠修复继续通过原运行包回归，用户已确认该项正常。

## 配套部署

使用现有 stop/start 窗口恢复流程更新布局脚本与 immutable Native Clip，没有覆盖已映射的旧 canonical。

- 布局脚本安装 SHA256：`b2191d78def6b32c6d6bd1350a37ec5071cbb8d05f8167c3d22a41dc33f6e34c`，与当前生成包一致。
- 新 Native Clip canonical hash：`3117381f96380c40b7f29ed426d52a766135893699157174cb7d7d46df262ed3`。
- 实际运行 GetScrollMotionStatus 返回 `workspaceRemovalGate=compositor-idle`；新 WorkspaceTransitionActive 方法调用成功，静态查询为 false。这确认新库代码与 endpoint 已加载，不声称实测了动画中每一帧。
- KWin PID 前后保持 2083，Script、Clip、动画 Effect、Focus Ring 与 Bridge 均正常。动画 Effect、Focus Ring 与 CLI 安装 hash 不变；Ring active=true、圆角 12。
- 部署时段日志没有新增 TypeError、ReferenceError、SyntaxError、INVARIANT_FAIL、FAIL_SAFE、mount failed 或崩溃错误。
- 部署脚本 / 日志：`/tmp/cc-niri-recycle-slide-deploy.py` / `deploy.log`。回滚备份与命令审计：`/tmp/cc-niri-recycle-slide-backup-20261005-y8uk7dx9`。

## 内屏验收

进入有窗口的新工作区，关闭最后一个窗口后按 K 返回。期望向上动画完整、无中途截断或卡顿，结束后空源工作区才被回收。也检查快速 J/K 返回仍为空的源工作区时，不会删除当前桌面。部署后用户反馈“已经修复”，本轮关闭末窗后按 K 返回的内屏交互验收通过；未补写用户未提供的逐项测试结果。
