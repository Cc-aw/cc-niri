# CC Niri Phase 15.1：Contextual Wide Runtime Hardening

> **归档状态（2026-10-01）：** 已实现（1e87364）。
> 文档状态与阅读顺序见 [文档索引](../README.md)。原设计正文保留作为历史依据。

> 项目：`Cc-aw/cc-niri`  
> 当前基线：`b9c54b89c8d8e686e66a1989b0e69229759f4a8b`  
> 本阶段目标：**冻结 Wide 交互，不再改变用户语义，只做 Runtime Hardening。**  
> 完成本阶段后再进入：
>
> ```text
> Phase 16：Window Policy / Dialog Always Floating
> Phase 17：Multi-window Column
> ```
>
> 两条核心原则：
>
> ```text
> Animation can fail.
> Layout cannot fail.
> ```
>
> ```text
> State must have one clear owner.
> ```

---

# 1. 为什么现在必须先 Hardening

当前 Contextual Wide 已经完成了最关键的语义拆分：

```text
persistentWide
    ↓
Wide preference

ViewportMode
├── PAIR
└── WIDE_FOCUS

FocusSource
├── DIRECTIONAL
├── POINTER
├── DOCK
├── ALT_TAB
└── PROGRAMMATIC
```

同时 Wide ↔ Pair 已经形成：

```text
LayoutSnapshot
    ↓
Viewport Motion Plan
    ↓
MotionPlanCommitGate
    ↓
Bridge
    ↓
Native EffectWindow data
    ↓
Scripted Effect
```

当前问题已经不是“Wide 怎么更好看”，而是：

```text
这套状态和 IPC 链路是否足够稳定，
能够作为 Dialog 和 Multi-window Column 的基础。
```

如果现在直接叠加：

```text
Dialog Policy
Multi-window Column
```

新的：

```text
Column state
Window state
Viewport state
Wide runtime state
Multi-window state
```

会同时存在。

所以必须先完成一次 Runtime Hardening。

---

# 2. Phase 15.1 范围

本阶段只处理：

```text
1. State Owner 收敛
2. IPC fail-safe
3. Native regression gate
4. README / 版本与架构文档同步
```

本阶段明确不处理：

```text
Dialog
Transient
Utility
Multi-window Column
Tabbed Column
Overview
Session persistence
Spring motion
Gesture
Focus Ring
```

---

# 3. Wide 交互冻结

本阶段不得修改当前已经确认的 Wide 行为。

## 3.1 Wide Preference

继续：

```js
column.persistentWide
```

其含义只是：

```text
这个 Column 偏好 Wide
```

而不是：

```text
这个 Column 永远以 72% 展示
```

## 3.2 Pair

PAIR：

```text
1(50%) | 2(50%)
```

即使：

```text
1.persistentWide = true
```

也仍然是 50%。

## 3.3 当前 Pair 内可见的 preferred Wide

```text
1|2
focus=2

Meta+H
    ↓

1@72%
```

Wide 为：

```text
72%
居中
两侧为空
```

## 3.4 屏外 preferred Wide

```text
2|3
Meta+H
    ↓
1|2
focus=1

Meta+H
    ↓
1@72%
```

第一次只 reveal，第二次同方向确认进入 Wide。

## 3.5 Pointer / Dock / Alt+Tab

继续：

```text
focus only
```

不得自动：

```text
PAIR → WIDE_FOCUS
```

---

# 4. 当前需要 Hardening 的状态

当前 runtime application glue 中存在：

```js
let lastCommittedViewportMode;
let lastCommittedWideColumnId;

let contextualWidePark;
let nextContextualWideParkToken;

let contextualWideExit;
let nextContextualWideExitToken;
```

以及：

```text
prepareContextualWidePark()
scheduleContextualWidePark()
requestContextualWidePark()
finalizeContextualWide()

requestContextualWideExit()
finalizeContextualWideExit()
```

这些逻辑已经组成一个完整 runtime transition state machine。

功能正确，但 ownership 又回到了：

```text
package/contents/code/main.js
```

这与之前完成的模块化设计相冲突。

---

# 5. 目标 State Owner 架构

目标：

```text
src/kwin/presentation/
├── ContextualViewport.js
├── ContextualWideCoordinator.js
└── PresentationController.js
```

三者职责必须严格区分。

---

# 6. ContextualViewport

`ContextualViewport` 只负责：

```text
PAIR
WIDE_FOCUS
pendingReveal
FocusSource
shouldEnterWide()
confirmReveal()
cancelReveal()
```

它回答：

> “逻辑上当前 Viewport 应处于什么状态？”

---

# 7. ContextualViewport 必须成为 Single Writer

现在：

```text
ContextualViewport
+
PresentationController
```

都可能修改：

```text
appState.viewport
```

这必须消除。

## 7.1 禁止

任何其它模块不得：

```js
appState.viewport.mode = "pair";
appState.viewport.wideColumnId = null;
```

也不得：

```js
appState.viewport.mode = "wide-focus";
appState.viewport.wideColumnId = column.id;
```

## 7.2 允许

只能通过：

```js
contextualViewport.pair()
contextualViewport.wide(column)
contextualViewport.select(column, intent)
contextualViewport.confirmReveal(column, direction)
contextualViewport.cancelReveal()
contextualViewport.restore(snapshot)
```

---

# 8. 为什么 Single Writer 很重要

`ContextualViewport` 不仅拥有：

```text
appState.viewport
```

还拥有：

```text
pendingReveal
```

如果外部直接修改 viewport：

```text
PAIR
→ 外部改成 WIDE_FOCUS
```

内部 `pendingReveal` 可能没有同步清理。

后续：

```text
Meta+H/L
```

就可能错误消费旧 confirmation。

因此：

```text
Viewport state
+
Pending reveal state
```

必须原子地由同一个 owner 管理。

---

# 9. PresentationController 收缩职责

最终 `PresentationController` 主要负责：

```text
NORMAL
MAXIMIZED
```

以及 explicit 用户命令：

```text
Meta+Z preference toggle
```

但是它不能直接写 viewport。

## 当前

类似：

```js
appState.viewport.mode = "pair";
appState.viewport.wideColumnId = null;
```

## 目标

改为：

```js
this.viewport.pair();
```

进入 Wide：

```js
this.viewport.wide(column);
```

恢复：

```js
this.viewport.restore(savedViewport);
```

---

# 10. 新增 ContextualViewport.restore()

建议：

```js
restore(snapshot) {
    this.cancelReveal();

    if (!snapshot ||
            snapshot.mode !== ViewportMode.WIDE_FOCUS) {
        return this.pair();
    }

    const column = this.appState.columns.find(
        item => item.id === snapshot.wideColumnId
    );

    if (!column || !column.persistentWide) {
        return this.pair();
    }

    return this.wide(column);
}
```

以后：

```text
Maximize
Fullscreen
Restore
```

都不需要外部直接修改 `appState.viewport`。

---

# 11. 新模块：ContextualWideCoordinator

新增：

```text
src/kwin/presentation/ContextualWideCoordinator.js
```

它负责：

> “已经决定发生 PAIR ↔ WIDE_FOCUS 切换后，
> geometry / motion / parking / activation 如何安全完成。”

它不负责决定：

```text
要不要进入 Wide
```

这个决定仍属于 `ContextualViewport`。

---

# 12. Coordinator 独占状态

从 main runtime 移入：

```text
lastCommittedViewportMode
lastCommittedWideColumnId

contextualWidePark
nextContextualWideParkToken

contextualWideExit
nextContextualWideExitToken
```

建议内部重命名：

```js
lastCommittedViewport
pendingPark
pendingExit
nextParkToken
nextExitToken
```

---

# 13. Coordinator 推荐 API

保持 API 小：

```js
class ContextualWideCoordinator {
    prepareLayoutTransition(...)
    onPlanCommitted(...)
    onTargetGeometryChanged(...)

    finalizePark(command)
    finalizeExit(command)

    deferActivation(window)
    isActivationDeferred()

    retainedNeighbor()
    wideExitColumn()

    cancel(reason)
}
```

---

# 14. Coordinator 不应该负责

禁止把以下职责塞进去：

```text
Meta+H/L target selection
ColumnStore focus
Dock target selection
persistentWide toggle
Presentation maximize
Column reorder
```

这些继续由各自 owner 管理。

---

# 15. main.js 应恢复为 Glue

当前：

```text
prepareContextualWidePark()
scheduleContextualWidePark()
requestContextualWidePark()
finalizeContextualWide()
requestContextualWideExit()
finalizeContextualWideExit()
```

完成 Phase 15.1 后都应移出 application glue。

Bridge handler 最终类似：

```js
handlers: {
    "finalize-contextual-wide":
        command => contextualWideCoordinator.finalizePark(command),

    "finalize-contextual-wide-exit":
        command => contextualWideCoordinator.finalizeExit(command),
}
```

---

# 16. Coordinator 与 LayoutEngine 的边界

推荐：

```text
ContextualWideCoordinator
决定 runtime transition context

LayoutEngine
纯计算 geometry / motion plan
```

Coordinator 可以向 LayoutEngine 提供：

```js
{
    retainedColumn,
    wideExitColumn,
}
```

但：

```text
timer
DBus
activation
```

不得进入 LayoutEngine。

---

# 17. LayoutEngine 保持 Pure

继续要求：

```js
computeLayoutPlan(options)
```

只做：

```text
old/new projection
placement
viewportMotion
layoutSnapshots
parkAfterComplete
commitOrder
```

不得：

```text
调用 DBus
改 focus
改 opacity
schedule timer
```

---

# 18. MotionPlanCommitGate 当前风险

当前路径：

```text
LayoutPlan
    ↓
MotionPlanCommitGate.schedule()
    ↓
PublishMotionPlan
    ↓
Bridge callback
    ↓
commit geometry
```

handoff 顺序是正确的。

但有一个 fail-safe 缺口：

```text
如果 callback 永远不返回
```

可能造成：

```text
geometry 不 commit
activation 一直 defer
H/L 永久卡住
```

WM runtime 不能允许这个结果。

---

# 19. IPC Fail-safe 原则

必须：

```text
Animation can fail.
Layout cannot fail.
```

所以：

```text
                  PublishMotionPlan
                       │
              ┌────────┴────────┐
              │                 │
            ACK               Timeout
              │                 │
              ▼                 ▼
       motion-aware commit   safe commit
```

---

# 20. MotionPlanCommitGate 增加 Timeout

推荐构造：

```js
class MotionPlanCommitGate {
    constructor(options) {
        ...
        this.timeoutMs = options.timeoutMs;
        this.setTimer = options.setTimer;
        this.clearTimer = options.clearTimer;
    }
}
```

---

# 21. Timeout 推荐值

建议：

```text
150 ms
```

合理范围：

```text
100 ~ 200 ms
```

不要设置到：

```text
500 ms+
```

因为这是本地 D-Bus。

150ms 没有 ACK 时：

```text
优先保证 layout 正确
```

---

# 22. schedule() 推荐逻辑

```text
schedule
  ↓
publish
  ↓
start timeout
```

两条完成路径：

```text
ACK
→ clear timeout
→ normal commit

Timeout
→ invalidate pending
→ warn
→ fallback commit
```

---

# 23. 推荐伪代码

```js
schedule(plan, envelope, context) {
    const pending = {
        plan,
        context,
        activationWindow: null,
        timer: null,
    };

    this.pending = pending;

    pending.timer = this.setTimer(() => {
        if (this.pending !== pending) return;

        this.pending = null;

        this.warn(
            `[MOTION_TX] handoff timeout epoch=${plan.epoch}`
        );

        this.commit(
            plan,
            Object.assign({}, context, {
                motionFallback: true,
            }),
            pending.activationWindow
        );
    }, this.timeoutMs);

    this.publish(envelope, accepted => {
        if (this.pending !== pending) return;

        this.clearTimer(pending.timer);
        this.pending = null;

        if (this.currentEpoch() !== plan.epoch) return;

        if (!accepted) {
            this.warn(
                `[MOTION_TX] plan handoff unavailable epoch=${plan.epoch}`
            );
        }

        this.commit(
            plan,
            context,
            pending.activationWindow
        );
    });

    return pending;
}
```

---

# 24. Late ACK 必须无害

场景：

```text
T0:
schedule plan

T0+150:
timeout fallback commit

T0+280:
Bridge ACK
```

ACK 必须被：

```js
if (this.pending !== pending) return;
```

过滤。

绝不能二次 commit。

---

# 25. Timeout fallback 的目标

Fallback 不要求：

```text
完美 Contextual Wide 动画
```

只要求：

```text
geometry correct
focus correct
parking correct
no permanent stall
```

如果 Effect 没拿到 MotionPlan：

```text
动画退化
```

可以接受。

---

# 26. MotionPlanCommitGate 新增测试

当前已经覆盖：

```text
ACK
reject
superseded
cancel
stale epoch
```

必须继续增加：

## Timeout

```text
schedule
callback 不回来
timer fire
→ commit exactly once
```

## Late ACK

```text
timeout commit
callback later
→ commit count 不变
```

## Cancel Before Timeout

```text
schedule
cancel
timer fire
→ no commit
```

## Superseded Timeout

```text
plan A
plan B

A timeout
→ A 不 commit
```

## Activation Preservation

```text
schedule
deferActivation(window)
timeout
→ fallback commit 收到 activationWindow
```

---

# 27. Timer 必须可注入

不要让单元测试等待真实 150ms。

通过：

```js
setTimer
clearTimer
```

注入。

生产用真实 timer。

测试中手动执行 timer callback。

---

# 28. Native Regression Gate

当前：

```bash
node tools/check.js --native
```

只 build：

```text
Bridge
Plasmoid
```

不完整。

---

# 29. Native Viewport Effect 已是核心依赖

现在 `native/viewport-clip` 负责：

```text
RenderViewport-aware clipping

MotionPlanChanged
    ↓
EffectWindow role 1003

MotionComplete role 1004
    ↓
ReportMotionComplete

MotionParked
    ↓
marker cleanup

repaint assistance
```

因此必须纳入 native gate。

---

# 30. tools/check.js 修改

目标：

```js
if (native) {
    run("Bridge native build",
        "cmake", ["--build", "build/bridge"]);

    run("Viewport clip native build",
        "cmake", ["--build", "build/native-viewport-clip"]);

    run("Plasmoid native build",
        "cmake", ["--build", "build/plasmoid"]);
}
```

推荐顺序：

```text
Bridge
↓
Native Viewport Clip
↓
Plasmoid
```

---

# 31. configure + build 暂不强制

当前：

```text
cmake --build build/...
```

依赖已有 configure。

Phase 15.1 暂时不扩大范围。

以后可以升级成：

```text
configure
+
build
```

本阶段只要求：

```text
native viewport clip 纳入 build gate
```

---

# 32. Native Contract Test

建议增强：

```text
test/native-viewport-clip.test.js
```

明确检查角色编号一致：

```text
1001 = Viewport Clip
1002 = Clip Capability
1003 = Motion Plan
1004 = Motion Complete
```

Script 和 C++ 必须一致。

---

# 33. MotionPlanChanged Regression

测试 C++ 包含：

```text
MotionPlanChanged
```

且最终：

```text
setData(MotionPlanDataRole, ...)
```

---

# 34. MotionComplete Regression

确保：

```text
windowDataChanged
role == MotionCompleteDataRole
```

触发：

```text
forwardMotionCompletion()
```

---

# 35. MotionParked Regression

确保：

```text
MotionParked
```

清：

```text
MotionPlanDataRole
```

并：

```text
addRepaintFull()
```

---

# 36. Mixed-DPI Mapping 必须保留

继续检查：

```cpp
viewport.mapToDeviceCoordinates(logicalClip)
```

不得回退成：

```text
hard-coded *1.5
output-name scale
manual DPI conversion
```

---

# 37. README 更新

README 当前还显示：

```text
3.0.0-alpha.38
```

建议升级：

```text
3.0.0-alpha.39
```

版本语义：

```text
alpha.38
=
native-clipped full-delta ordinary scrolling

alpha.39
=
Contextual Wide runtime + continuous Wide/Pair motion
```

---

# 38. README Wide 语义

明确：

```text
Wide is a preference,
not permanent geometry.
```

---

# 39. README 导航案例

## 当前 Pair 可见

```text
1|2
focus=2

Meta+H
→
1@72
```

## 屏外 preferred Wide

```text
2|3

Meta+H
→
1|2

Meta+H
→
1@72
```

## Pointer / Dock / Alt+Tab

```text
focus only
stay Pair
```

---

# 40. README Development Architecture

必须删除旧：

```text
WideTransition.js
```

因为 production 已经切换。

替换为：

```text
ContextualViewport.js
    ↓
PAIR / WIDE_FOCUS
Focus Intent
pending reveal

PresentationController.js
    ↓
Normal / Safe Maximize
explicit Wide preference command

ContextualWideCoordinator.js
    ↓
runtime Wide transition lifecycle
geometry ACK
motion completion
parking
activation deferral
```

---

# 41. README Motion Pipeline

建议加入：

```text
ContextualViewport
        ↓
LayoutEngine
        ↓
LayoutSnapshot
        ↓
Viewport Motion Plan
        ↓
MotionPlanCommitGate
        ↓
Bridge.PublishMotionPlan
        ↓
Native Viewport Effect
        ↓
EffectWindow role 1003
        ↓
geometry commit
        ↓
Scripted Effect
        ↓
role 1004 completion
        ↓
Native Effect
        ↓
Bridge
        ↓
ContextualWideCoordinator
        ↓
final park
```

---

# 42. Native Effect 职责更新

以前可以描述为：

```text
Viewport Clip Backend
```

现在已经不准确。

当前实际职责：

```text
Viewport Clip
+
Motion Metadata Handoff
+
Motion Completion Relay
+
Repaint Assistance
```

但仍明确禁止它拥有：

```text
layout
focus
Column ordering
Viewport decision
Dock state
```

---

# 43. 新增 Coordinator 测试

建议：

```text
test/contextual-wide-coordinator.test.js
```

覆盖：

```text
PAIR_TO_WIDE prepare
WIDE_TO_PAIR prepare

pendingPark ownership
pendingExit ownership

token mismatch

geometry ACK retry
motion completion
cancel
activation defer
```

---

# 44. Single Writer Test

新增：

```text
test/contextual-viewport-owner.test.js
```

静态检查 production application source。

禁止出现散落的：

```text
appState.viewport.mode =
mainScreenState.viewport.mode =
```

允许写入的位置只有：

```text
ContextualViewport.js
```

---

# 45. PresentationController Test

确认它只能通过：

```text
viewport.pair()
viewport.wide()
viewport.restore()
```

改变 viewport。

---

# 46. Maximize Restore Regression

场景一：

```text
1@72
→ Safe Maximize
→ Restore
→ 1@72
```

场景二：

```text
1|2
focus=1
1.persistentWide=true

→ Safe Maximize
→ Restore
→ 仍然 1|2
```

不能因为：

```text
persistentWide=true
```

错误展开。

---

# 47. Pending Reveal + Maximize

```text
2|3
Meta+H
→
1|2
pendingReveal=1

Maximize
Restore
```

必须：

```text
pendingReveal = null
```

下一次 H 不允许消费旧 reveal。

---

# 48. Pending Reveal + Dock / Pointer

同样必须保证：

```text
Meta+H reveal
↓
Dock click / Pointer focus
↓
pendingReveal = null
```

---

# 49. Runtime Fail-safe Test Matrix

至少模拟：

```text
Bridge unavailable
Bridge returns false
Bridge callback late
Bridge callback missing
new motion supersedes old
KWin epoch changed
Recovery cancel
```

所有情况最终：

```text
layout never permanently stalls
```

---

# 50. Manual Soak Test

连续：

```text
H L H L
```

至少 100+ 次。

观察：

```text
stuck motion
wrong focus
stale opacity hold
stale parking
wrong viewport
```

---

# 51. Meta+Z / H / L 混合

测试：

```text
Z
L
H
Z
L
L
H
H
```

包括快速输入。

---

# 52. Wide → Wide

```text
3@72
Meta+L
→
3|4

Meta+L
→
4@72
```

反方向同样验证。

---

# 53. Pointer Interaction

PAIR：

```text
1 preferredWide
2 normal
```

连续：

```text
click 1
click 2
click 1
```

始终保持：

```text
PAIR
```

---

# 54. Dock Long Jump

从：

```text
1@72
```

Dock 点击：

```text
5
```

应该：

```text
退出 Wide
→ stepwise scroll
→ Pair focus=5
```

即使 5 是 preferredWide：

```text
也不自动 72%
```

---

# 55. Window Close / Output Change

测试：

```text
Pair→Wide motion 中 close neighbor
Wide→Pair motion 中 close target
```

以及：

```text
motion 中 target / neighbor outputChanged
```

要求：

```text
Coordinator cancel safely
opacity hold release
parking ownership release
motion marker cleanup
```

---

# 56. tools/check.js 输出名

当前：

```text
PASS Phase 13 regression gate
```

已经过时。

建议改为：

```text
PASS CC Niri regression gate
```

这样后续不需要每个 phase 改字符串。

---

# 57. 推荐 Commit 顺序

## Commit 1

```text
refactor: make contextual viewport the sole viewport state owner
```

内容：

```text
PresentationController 不直接写 viewport
增加 restore()
补 single-writer tests
```

## Commit 2

```text
refactor: extract contextual wide runtime coordinator
```

内容：

```text
pendingPark
pendingExit
tokens
geometry ACK
motion completion
activation defer
```

从 main.js 移出。

## Commit 3

```text
test: cover contextual wide coordinator lifecycle
```

## Commit 4

```text
stability: add motion-plan handoff timeout fallback
```

## Commit 5

```text
test: cover motion-plan timeout and late acknowledgements
```

## Commit 6

```text
build: include native viewport effect in regression gate
```

## Commit 7

```text
test: validate native motion data-role contract
```

## Commit 8

```text
docs: document alpha39 contextual wide architecture
```

---

# 58. 禁止大 Commit

不要把：

```text
Coordinator
IPC timeout
Native build
README
```

一次完成。

Hardening 阶段必须：

```text
每一步可单独验证
每一步可单独回退
```

---

# 59. Phase 15.1 完成标准

## State Owner

```text
[ ] appState.viewport 只有 ContextualViewport 写
[ ] PresentationController 不直接写 viewport
[ ] main.js 不直接写 viewport
[ ] pendingReveal 与 viewport 同 owner
```

## Contextual Wide Runtime

```text
[ ] contextualWidePark 不再是 main.js global
[ ] contextualWideExit 不再是 main.js global
[ ] token allocation 由 ContextualWideCoordinator 管理
[ ] geometry ACK 由 Coordinator 管理
[ ] motion complete 由 Coordinator 管理
[ ] deferred activation 由 Coordinator 管理
```

## IPC Fail-safe

```text
[ ] MotionPlanCommitGate 有 timeout
[ ] callback missing 时 layout 最终 commit
[ ] timeout 后 activation 最终执行
[ ] late ACK 不重复 commit
[ ] cancel 后 timeout 无副作用
[ ] superseded plan 不 fallback commit
```

## Native Gate

```text
[ ] node tools/check.js PASS
[ ] node tools/check.js --native PASS

[ ] --native build Bridge
[ ] --native build Native Viewport Clip
[ ] --native build Plasmoid
```

## Native Contract

```text
[ ] role 1001 consistency
[ ] role 1002 consistency
[ ] role 1003 consistency
[ ] role 1004 consistency

[ ] MotionPlanChanged tested
[ ] MotionComplete tested
[ ] MotionParked tested
[ ] RenderViewport mapping retained
```

## README

```text
[ ] version -> alpha.39
[ ] Wide described as preference
[ ] Pair / Wide Focus described correctly
[ ] visible/off-screen directional rule documented
[ ] Pointer / Dock / Alt+Tab behavior documented
[ ] old WideTransition references removed
[ ] ContextualViewport documented
[ ] ContextualWideCoordinator documented
[ ] MotionPlanCommitGate documented
[ ] Native Effect expanded responsibilities documented
```

---

# 60. Phase 15.1 完成后冻结 Wide

完成以上内容后：

```text
Wide subsystem = frozen
```

以后除：

```text
bug fix
```

外不再重构 Wide。

---

# 61. 下一阶段：Phase 16 Window Policy

Phase 15.1 完成后开始：

```text
Window Policy
```

先建立：

```text
NORMAL
DIALOG
TRANSIENT
UTILITY
PIP
USER_FLOATING
POLICY_FLOATING
```

Dialog：

```text
永远不进入 ColumnStore
```

更准确地说：

```text
WindowPolicy
    ↓
POLICY_FLOATING
```

不能通过用户 Floating Toggle 把 policy-floating Dialog attach 到 Column。

---

# 62. 为什么 Dialog 要先于 Multi-window

Multi-window Column 最重要的问题之一就是：

```text
哪些 Window 可以成为 Column member？
```

Dialog 是最明显的第一条 eligibility rule。

---

# 63. Phase 17：Multi-window Column

最终：

```text
Column != Window
```

变为：

```js
Column {
    id,

    windows: [
        windowA,
        windowB,
        ...
    ],

    activeWindowIndex,

    persistentWide,

    logicalX,
    pixelWidth,
}
```

它会影响：

```text
ColumnStore
WindowStateStore
Focus
Dock UUID mapping
Close
Insertion
Reorder
Floating
Fullscreen
Presentation
Motion
```

所以必须在 Phase 15.1 Hardening 完成后再开始。

---

# 64. 最终开发顺序

```text
b9c54b8
Contextual Wide functional baseline
        ↓
Phase 15.1
Runtime Hardening
        ↓
alpha.39
        ↓
Phase 16
Window Policy / Dialog Always Floating
        ↓
Phase 17
Multi-window Column
```

---

# 65. 本阶段最终原则

本阶段不是继续增加功能，而是：

```text
把当前已经正确的功能
变成可以继续扩展的稳定基础。
```

最终必须做到：

```text
Viewport has one owner.

Wide transition has one owner.

Motion handoff can fail safely.

Native dependencies are part of regression.

Documentation matches runtime reality.
```

只有完成这些，后续的：

```text
Dialog
Multi-window Column
```

才不会把项目重新带回：

```text
main.js 巨型状态机
+
多个模块同时写状态
+
动画依赖时序运气
```
