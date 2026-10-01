# ViewOffset Spring — Phase 2 SCROLL Plan

2026-10-01，`codex/native-view-offset-scroll`，起点 Phase 1 `02545c3`。
设计：[ViewOffset Spring](../doc/todo/cc-niri_niri_viewoffset_spring_implementation.md)，
本阶段对应 Commit 2：发布 logical column SCROLL plan，原生端只校验、记录，不改变视觉。

## 数据与边界

- LayoutEngine 的 scrollTransaction 新增 entries，包含实际参与滚动的窗口 UUID、
  columnId、logicalX、pixelWidth、old/newPlacement；排除两端均 parked 的静态列。
  保留既有 continuing/incoming/outgoing 与原提交顺序。
- `ScrollMotionPlan.js` 负责纯数据 envelope。普通 H/L 引发 offset 变化时，在真实几何
  commit 前发出 IPC；同一 Pair 内仅变焦点、边缘 no-op、Wide 专用计划不发 SCROLL。
  宽度及坐标保留 double，绝不使用 parkingRect.x 作为 logicalX。
- SCROLL MotionPlan protocol=2，含 workspaceId、targetOutput 与 sessionId。
  继续复用 PublishMotionPlan / MotionPlanChanged。既有 Wide MotionPlan 仍为 protocol=1，
  Dock command protocol=1、Workspace snapshot protocol=2 不随本协议变化。
- 观察阶段不等待 ACK、不走 Wide geometry gate、不更改停车/焦点时机。
  callback 仅日志；同步 IPC 异常和迟到拒绝也不打断原布局。

## Bridge 与原生端

- 共享 `src/protocol/ViewportScrollPlan.h`：严格类型、有限数值、非负安全整数 epoch、
  唯一窗口与列、有效 viewport 和宽度，以及 placements 与 logical projection 一致性。
  原始载荷上限 256 KiB，entries 上限 256；不硬编码 2 或 3 个参与窗口。
- Bridge 只接受当前已发布 live State 的 session/workspace/output 和当前列 UUID。
  缓存不视为 live authority。epoch 递增；相同完整计划幂等且不重复发信号，冲突/旧计划拒绝。
  新 session 重置序列，工作区切换保留 epoch 屏障。更严格 Motion 元数据无法绑定时
  清除旧权限，而不是沿用旧 session。SCROLL 不覆盖 Wide 的完成/parking token。
- Native 监听 StateChanged，以 GetState 补充启动状态；查询期间若收到状态信号，
  忽略旧查询回复。使用相同的 schema/sequence 类，按实际 EffectWindow UUID 解析，
  核对输出、当前原生 desktop UUID、isOnCurrentDesktop 与既有切换时间屏障。
- 成功记录 `[SCROLL_PLAN_NATIVE] OBSERVE` 和完整 plan；不写 role、geometry、opacity、
  minimize，不 start Spring，不保留额外 EffectWindow/QObject 指针，也不主动 repaint。
  既有 Wide marker 和 scripted SCROLL 继续负责动画。
- 原生输出/desktop API 按本机 KWin 6.7.5 头文件编译确认，未猜测 master API。

## 验证

新增 `scroll-motion-plan.test.js` 运行生产生成 bundle，检查：

- fractional / 负屏幕原点坐标、参与 entries、UUID 规范化与无数据别名；
- 同 Pair 不发 plan，真实 H/L 前后 offset 与递增 epoch，正反向逻辑坐标；
- plan 发出时尚无本次 geometry write，后续几何与激活不等待 ACK；
- W8/W9 配置下切换工作区，旧拒绝 callback 不写几何、不改变新工作区；
- 同步 IPC 失败仍能完成 H/L，未出现 invariant/fail-safe。

新增真实 Bridge `scroll-motion-protocol` CTest：生产 schema/observer sequence、错误类型、
缺失字段、无效投影、重复 window/column、空/超大 payload、session/工作区/输出/epoch、
幂等、legacy Wide completion/park 隔离与缓存权限。

新增隔离 D-Bus 集成：实际进程、实际方法与 signal、完整 JSON round-trip、State→Plan
信号顺序、重复/冲突、工作区变化、Bridge 重启后的缓存非 live、重新发布新 session。
每次 mutation 前核对服务 owner PID 是测试进程，所有调用均在 dbus-run-session 内。

最终 `node tools/check.js --native` 通过：72 个 JS 测试、Bridge 5 项 CTest、
三项隔离 D-Bus 集成、clip 3 项 CTest，以及三个 native 构建。
日志：`/tmp/cc-niri-spring-phase2-check.log`。
本轮未部署，未将协议/原生编译通过记为 Spring 实机视觉验收。

## 后续

Phase 3 / Commit 3：让 continuing 列从共享 ViewOffset 采样获得 paint translation；
其后分别接 incoming、outgoing deferred park，再 bypass 旧 scripted SCROLL。
Phase 0 新运动接入前的视频基线仍待记录。
