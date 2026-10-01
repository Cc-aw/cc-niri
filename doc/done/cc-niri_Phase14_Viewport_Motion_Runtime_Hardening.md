# CC Niri Phase 14：Viewport Motion Runtime Hardening 实现文档

> **归档状态（2026-10-01）：** 已实现 MotionTransaction、native clip 与 full-delta 滚动（883f778）。
> 文档状态与阅读顺序见 [文档索引](../README.md)。原设计正文保留作为历史依据。

> 项目：`Cc-aw/cc-niri`  
> 基线：`3.0.0-alpha.37` / `a6d590b`  
> 当前阶段：模块化稳定性架构已经完成，下一阶段只处理滚动动画的运行时质量。  
> 目标：解决 CC Niri 当前仍存在的 **Dock restore 动画干扰、右侧仅 20 px 假滚动、双屏情况下无法使用完整 strip translation** 三个问题。  
> 原则：**不再进行大规模架构重构，只做小步、可验证、可回退的 Runtime Hardening。**

---

# 1. Phase 14 总目标

Phase 14 完成后，普通滚动应从当前：

```text
A | B
    ↓
B 保持滚动
C 从右边缘 20 px + scale/fade 出现
```

升级为：

```text
A | B | C
    ↓

整个逻辑 strip 同步左移

A:
outgoing

B:
continuing

C:
incoming
```

视觉上：

```text
A / B / C
```

共享：

```text
同一个 transaction
同一个 deltaX
同一个运动方向
同一个空间速度
```

最终普通 H/L：

```text
Translation only
```

不再依赖：

```text
SAFE_RIGHT_EDGE_SLIDE_X = 20
```

---

# 2. 本阶段不做什么

本阶段禁止同时加入：

- 新窗口管理功能；
- Overview；
- Tabbed Column；
- session persistence；
- 副屏 scrolling layout；
- touchpad inertial scrolling；
- Rust 重写；
- 大规模 Dock 重构；
- spring 动画大改；
- 新的 Presentation 模式。

原因：

> 当前架构已经稳定，Phase 14 只解决 motion runtime 的最后瓶颈。

---

# 3. 当前已具备的基础

以下功能已经存在，本阶段必须复用：

```text
ColumnStore
WindowStateStore

LayoutEngine
LayoutPlan
GeometryCommitter

ParkingManager
Recovery
LayoutTransaction
InvariantChecker

AdoptionController
FloatingController
OutputController
FullscreenController

PresentationController
WideTransition

DockGateway
DockScrollController
ReorderController

MotionTokens
MotionSampler
MotionController
MotionClassifier
MotionTransaction

tools/build.js
tools/check.js
GitHub Regression workflow
```

因此：

> Phase 14 不再新增“第二套”状态系统。

所有改动必须建立在现有 Owner 基础上。

---

# 4. 当前剩余的三个核心问题

## 4.1 问题 A：Parking 仍使用真实 minimize

当前 `ParkingManager` 仍包含：

```js
if (!window.minimized) {
    window.minimized = true;
    state.scrollParkingMinimized = true;
}
```

恢复：

```js
if (state.scrollParkingMinimized && window.minimized) {
    window.minimized = false;
}
```

因此：

```text
parked
→
visible
```

会触发 KWin 的：

```text
Unminimize Effect
```

表现：

```text
窗口从 Dock 图标位置飞出来
```

这会与 CC Scroll Motion 同时发生。

## 4.2 问题 B：Incoming 仍不是 full delta

当前：

```js
const SAFE_RIGHT_EDGE_SLIDE_X = 20;
```

说明右侧 Incoming 仍然只允许：

```text
20 px
```

视觉运动。

即使现在：

```text
Scale = 0.985
Opacity = 0.85
```

已经比早期自然很多，但空间模型仍然不是：

```text
完整 Column Strip Translation
```

## 4.3 问题 C：主屏右边就是副屏

如果直接将 Incoming：

```text
+1260 → 0
```

那么 paint-space 可能进入：

```text
HDMI-A-1
```

因此必须增加：

```text
Primary Viewport Clip
```

才能安全启用 full-delta motion。

---

# 5. Phase 14 最终数据流

最终必须形成：

```text
Meta+L / Dock Step
        │
        ▼
Scroll State Change
        │
        ▼
LayoutEngine
        │
        ▼
LayoutPlan
        │
        ▼
GeometryCommitter
        │
        ▼
Real Window Geometry
        │
        │
        ├──────────────┐
        ▼              ▼
MotionTransaction   Parking Ownership
        │              │
        ▼              ▼
MotionController   ParkingAnimationGrabber
        │              │
        └──────┬───────┘
               ▼
          KWin Effect
               │
               ▼
      Full Delta Translation
               │
               ▼
         Viewport Clipping
               │
               ▼
          Primary Output
```

---

# 6. 核心原则

## 6.1 Real Geometry 永远先正确

布局 correctness 永远由：

```text
LayoutPlan
+
GeometryCommitter
```

保证。

动画不决定：

- Column 顺序；
- scrollOffset；
- Window output；
- focus；
- Presentation；
- parking ownership。

## 6.2 Paint Motion 只是视觉

动画可以暂时：

```text
Translation = +1260
```

但真实 geometry 已经在最终 slot。

这意味着：

```text
visual position
≠
real geometry
```

## 6.3 相邻副屏只允许被 clip，不允许成为 animation path

禁止：

```text
真实 Window geometry
进入 HDMI-A-1
然后再回来
```

必须是：

```text
real geometry 仍在 DP-1
+
paint translation
+
clip
```

---

# 7. Phase 14 分阶段实施

# Phase 14.0：冻结 alpha.37 Baseline

第一步不要改代码。

执行：

```bash
git tag cc-niri-alpha37-motion-baseline
```

至少保存：

```text
a6d590b
```

作为可靠回退点。

## 14.0 验证

运行：

```bash
node tools/check.js
```

本机：

```bash
node tools/check.js --native
```

确认：

```text
全部 PASS
```

人工验证：

```text
Meta+H/L
Dock 远距离点击
Wide
Floating
Fullscreen
Quick Tile
双屏
关闭窗口补位
```

全部行为正常。

---

# 8. Phase 14.1：ParkingAnimationGrabber

这一阶段只解决：

```text
CC parking
```

与：

```text
KDE minimize / unminimize effect
```

冲突。

不修改 full-delta。

# 9. 新模块

建议增加：

```text
src/effect/ParkingAnimationGrabber.js
```

职责非常单一：

```text
grab CC-owned parking animation
release CC-owned parking animation
```

# 10. ParkingAnimationGrabber API

建议：

```js
class ParkingAnimationGrabber {
    constructor(options) {
        this.effect = options.effect;
        this.debug = options.debug;
        this.grabbed = new Set();
    }

    grab(window) {
        ...
    }

    release(window) {
        ...
    }

    releaseAll() {
        ...
    }

    owns(window) {
        ...
    }
}
```

# 11. 使用 KWin Grab Roles

需要：

```text
Effect.WindowMinimizedGrabRole
Effect.WindowUnminimizedGrabRole
```

逻辑：

```js
grab(window) {
    const minimized = effect.grab(
        window,
        Effect.WindowMinimizedGrabRole,
        true
    );

    const unminimized = effect.grab(
        window,
        Effect.WindowUnminimizedGrabRole,
        true
    );

    ...
}
```

释放：

```js
effect.ungrab(
    window,
    Effect.WindowMinimizedGrabRole
);

effect.ungrab(
    window,
    Effect.WindowUnminimizedGrabRole
);
```

# 12. Grab 的所有权规则

只允许对：

```text
CC-owned parking
```

grab。

不能：

```text
任何 minimized window
```

都 grab。

否则：

```text
用户自己点最小化
```

也会失去 KDE 原生动画。

# 13. 建议新增显式 parking motion ownership

当前已有：

```text
scrollParkingMinimized
scrollParkedByScript
scrollVisuallyHidden
```

本阶段可以先复用。

但 Effect 必须能识别：

```text
这个 minimized/unminimized
是 CC 内部 parking 行为
```

推荐建立：

```text
ccNiriParkingOwned
```

或者 transaction metadata。

# 14. 推荐 Motion Metadata

在 Window 上维护临时 metadata：

```text
ccNiriMotionTransactionId
ccNiriMotionRole
ccNiriMotionType
ccNiriParkingOwned
```

例如：

```text
C:
ccNiriMotionRole = incoming
ccNiriParkingOwned = true
```

Effect 根据这些 metadata 决定：

```text
是否 grab
```

# 15. 14.1 正确执行顺序

Incoming Window：

```text
1. Script 确定 C 是 incoming
2. transaction metadata 写入 C
3. Effect grab minimize/unminimize
4. Script 恢复 visible
5. minimized = false
6. KDE 原生 unminimize effect 被 CC grab 屏蔽
7. CC MotionController 开始动画
8. Motion 完成
9. release grab
10. clear metadata
```

# 16. 14.1 测试

新增：

```text
test/parking-animation-grabber.test.js
```

至少测试：

```text
grab 两个 role
重复 grab idempotent
release 两个 role
releaseAll
普通非 CC window 不 grab
```

# 17. 人工测试

场景：

```text
A | B
C parked
```

按：

```text
Meta+L
```

要求：

```text
C 不再从 Dock 出来
```

同时：

```text
Floating Window
→ 用户点击 minimize
→ 用户 restore
```

要求：

```text
仍然使用 KDE 原生动画
```

# 18. Stop Condition A

如果：

```text
WindowMinimizedGrabRole
WindowUnminimizedGrabRole
```

在 KWin 6.7.5 上无法可靠阻止系统 restore animation，

停止继续打补丁。

进入 fallback：

```text
安装 CC Niri 时临时 disable Squash / Magic Lamp
卸载时恢复
```

但 fallback 必须独立 commit。

---

# 19. Phase 14.2：MotionTransaction 升级为 runtime-authoritative

当前 `MotionTransaction` 已存在。

但是当前 Effect 仍保留较多：

```text
geometry heuristic
pending delta inference
```

Phase 14.2 的目标：

> transaction 成为普通 scroll animation 的第一信息源。

# 20. Transaction 新增字段

建议补齐：

```js
{
    id,
    layoutEpoch,
    type,

    deltaX,

    viewport: {
        x,
        y,
        width,
        height
    },

    continuing: [],
    incoming: [],
    outgoing: []
}
```

# 21. Transaction Role

固定：

```text
CONTINUING
INCOMING
OUTGOING
STATIC
```

不要在多个地方使用自由字符串。

建议：

```js
const MotionRole = Object.freeze({
    CONTINUING: "continuing",
    INCOMING: "incoming",
    OUTGOING: "outgoing",
    STATIC: "static"
});
```

# 22. LayoutPlan → MotionTransaction

`LayoutEngine` 已经能够得到：

```text
oldPlacement
newPlacement
oldProjectedRect
newProjectedRect
```

因此 Motion role 应直接由 LayoutPlan 派生。

映射：

```text
visible → visible
= CONTINUING

parked → visible
= INCOMING

visible → parked
= OUTGOING

parked → parked
= STATIC
```

这样：

```text
MotionClassifier
```

逐步退化为：

```text
fallback
```

而不是主逻辑。

# 23. Transaction Metadata Commit 时机

建议：

```text
LayoutPlan compute
        ↓
build MotionTransaction
        ↓
annotate involved windows
        ↓
GeometryCommitter.commit(plan)
```

原因：

Effect 的：

```text
windowFrameGeometryChanged
```

发生时必须已经能够读取：

```text
transaction ID
role
delta
viewport
```

# 24. Transaction 生命周期

```text
BEGIN
↓
annotate
↓
geometry commit
↓
effect starts motion
↓
animation running
↓
animation complete
↓
clear window metadata
↓
transaction retired
```

# 25. Phase 14.2 测试

新增：

```text
test/motion-runtime-transaction.test.js
```

验证：

```text
A|B → B|C

A = outgoing
B = continuing
C = incoming
delta = 1260
viewport 正确
```

反方向：

```text
B|C → A|B

A = incoming
B = continuing
C = outgoing
delta = -1260
```

---

# 26. Phase 14.3：Viewport Clip POC

这一阶段先不要启用 full delta。

先只验证：

```text
能不能正确裁 primary safeRect
```

# 27. 首选路线：Scripted Effect Fragment Shader

新增：

```text
effect/contents/shaders/
├── viewport_clip.frag
└── viewport_clip_core.frag
```

并在：

```text
src/effect/ViewportClip.js
```

封装。

# 28. ViewportClip API

建议：

```js
class ViewportClip {
    constructor(options) {
        ...
    }

    available() {
        ...
    }

    begin(window, viewport) {
        ...
    }

    update(window, viewport) {
        ...
    }

    end(window) {
        ...
    }

    endAll() {
        ...
    }
}
```

# 29. 第一版 Shader 不做 discard

先做：

```text
debug tint
```

例如：

```text
viewport 内
→ 正常

viewport 外
→ 强红色
```

用来验证：

```text
shader coordinate
```

# 30. Mixed DPI 是硬门槛

当前环境：

```text
Primary:
2560×1440 logical
scale 1.5

Secondary:
2560×1440 logical
scale 1.0
```

因此必须验证：

```text
logical safeRect
```

与：

```text
fragment coordinate
```

能否稳定映射。

不能假设：

```text
1 logical px = 1 device px
```

# 31. Shader POC 验证矩阵

测试：

```text
左边界
右边界
上边界
下边界
```

尤其右边界：

```text
DP-1 | HDMI-A-1
```

必须观察：

```text
primary safeRect 外
完全进入 debug tint 区
```

不能：

```text
偏 1~5 px
```

也不能：

```text
scale 1.5 后边界错位
```

# 32. Shader PASS 条件

满足：

```text
主屏 1.5 scale
副屏 1.0 scale
```

情况下：

```text
四边准确
resize / scale change 后仍正确
screen order change 后仍正确
```

才允许继续 Shader 方案。

# 33. Stop Condition B

如果出现：

```text
需要 primaryScale * 常数
需要 HDMI 特判
需要 device offset magic number
需要按 output name 修坐标
```

立即停止 Shader。

不要堆补丁。

进入：

```text
C++ Viewport Clip Effect
```

# 34. C++ Clip Fallback

如果 Shader 失败，只实现一个极小 C++ KWin Effect。

目标：

```text
只裁 paint region
```

不处理：

- layout；
- transaction；
- focus；
- motion；
- Dock；
- parking。

# 35. C++ Effect 只负责

```text
Window + viewport logical rect
        ↓
RenderViewport
        ↓
device-space clip region
```

本质：

```text
effectiveDeviceRegion &= mappedViewport
```

# 36. 不允许 C++ Effect 演变成第二个窗口管理器

禁止：

```text
C++ Effect 修改 geometry
C++ Effect 修改 focus
C++ Effect 修改 Column state
```

它只是：

```text
Viewport Clip Backend
```

---

# 37. Phase 14.4：启用真正 Full-Delta Scroll

只有：

```text
Parking Grab
+
Viewport Clip
```

都验证通过后，

才进入这一阶段。

# 38. 删除 SAFE_RIGHT_EDGE workaround

删除：

```js
const SAFE_RIGHT_EDGE_SLIDE_X = 20;
```

同时删除对应测试。

普通 scrolling 不再使用：

```text
20 px edge reveal
```

# 39. 普通 Motion 统一规则

## Continuing

```text
Translation:
deltaX → 0

Scale:
1

Opacity:
1
```

## Incoming

```text
Translation:
deltaX → 0

Scale:
1

Opacity:
1
```

## Outgoing

```text
Translation:
deltaX → 0

Scale:
1

Opacity:
1
```

最终：

```text
A / B / C
```

就是同一个 strip 的三个组成部分。

# 40. Meta+L 示例

布局：

```text
A | B
```

按：

```text
Meta+L
```

目标：

```text
B | C
```

transaction：

```text
deltaX = +1260

A:
OUTGOING

B:
CONTINUING

C:
INCOMING
```

Paint：

```text
A:
+1260 → 0

B:
+1260 → 0

C:
+1260 → 0
```

由于真实 geometry 已经是新布局：

```text
A parked
B left
C right
```

paint transform 会重建旧 strip 的视觉连续性。

# 41. Meta+H 示例

反向：

```text
deltaX = -1260
```

所有参与窗口：

```text
-1260 → 0
```

必须完全对称。

# 42. Viewport Clip 此时正式开启

Incoming 即使 paint 到：

```text
2544
```

也只能在：

```text
primary viewport
```

内显示。

副屏：

```text
0 pixels leak
```

# 43. 普通 Scroll 移除辅助 Scale / Fade

删除：

```text
subtleIncomingScale
subtleIncomingOpacity
```

在普通 scrolling path 中的使用。

这些 token 可以：

- 删除；
- 或保留给其他 motion type。

但不能继续参与标准 H/L。

# 44. Wide 不受影响

Wide：

```text
50% → 72%
```

继续：

```text
Scale
+
Translation
```

不纳入普通 Scroll 纯 Translation 规则。

# 45. Close Refill

Close refill 建议也进入：

```text
MotionTransaction
```

如果当前没有完整 transaction role，可以暂时保留旧 path。

Phase 14 不要求同时重写。

但不得退化：

```text
从 Dock 恢复
```

# 46. Dock Stepwise Scroll

当前：

```text
1|2 → 2|3 → 3|4 → 4|5
```

保留。

但每个 step：

```text
完整 full-delta transaction
```

视觉会自然连续。

---

# 47. Phase 14.5：Retarget Polish

当前已有：

```text
distanceAwareDuration()
```

保留。

重点验证 full delta 后：

```text
L
80 ms
L
60 ms
H
```

是否仍保持：

```text
position continuity
```

# 48. Retarget 约束

不能因为：

```text
transaction ID 变化
```

就：

```text
snap
```

必须继续：

```text
sample current painted position
        ↓
retarget
```

# 49. 暂不改 spring

当前：

```text
OutCubic
```

保持。

只在：

```text
Viewport Clip
Full Delta
Parking Grab
```

全部稳定后再重新评估 spring。

---

# 50. 新模块建议

最终新增：

```text
src/effect/
├── ParkingAnimationGrabber.js
├── ViewportClip.js
└── MotionRuntime.js
```

其中 `MotionRuntime.js` 可选。

如果不需要，不为了目录漂亮强行增加。

# 51. Motion Runtime 组合建议

Effect 主流程最终应接近：

```js
const transaction = motionTransactions.current();

const role = transaction.roleFor(window);

parkingGrabber.prepare(window, role);

viewportClip.begin(window, transaction.viewport);

motion.start(window, {
    transaction,
    role,
    deltaX: transaction.deltaX
});
```

不要继续让 Effect 主体里存在大量：

```text
oldSlot
newSlot
oldParked
newParked
if/else
```

这些保留为 fallback。

# 52. MotionClassifier 的最终角色

当前：

```text
MotionClassifier
```

不需要删除。

但从：

```text
主逻辑
```

降低为：

```text
fallback
diagnostic
legacy path
```

优先级：

```text
Explicit Transaction
>
Classifier
```

# 53. ParkingManager 不承担 Effect Grab

不要把：

```text
effect.grab()
```

塞进 `ParkingManager`。

原因：

```text
ParkingManager
```

属于 KWin Script/layout runtime。

`effect.grab()` 属于：

```text
KWin Effect runtime
```

两者应该保持分层。

# 54. LayoutEngine 不知道 animation details

禁止 `LayoutEngine` 出现：

```text
animation duration
easing
shader
grab role
```

LayoutPlan 只提供：

```text
old/new placement
old/new projected rect
```

Motion layer消费这些信息。

---

# 55. Logging

新增统一日志：

```text
[cc-motion-tx]
[cc-parking-grab]
[cc-viewport]
```

# 56. 推荐日志

Transaction：

```text
[cc-motion-tx] BEGIN id=105 epoch=442 delta=1260
[cc-motion-tx] role=outgoing uuid=A
[cc-motion-tx] role=continuing uuid=B
[cc-motion-tx] role=incoming uuid=C
```

Parking：

```text
[cc-parking-grab] GRAB uuid=C
[cc-parking-grab] RELEASE uuid=C
```

Viewport：

```text
[cc-viewport] BEGIN uuid=C rect=24,50 2512x1320
[cc-viewport] END uuid=C
```

# 57. Debug 模式下才打印逐 transaction 信息

默认禁止：

```text
每 frame logging
```

避免：

```text
journal spam
```

---

# 58. 测试结构

新增：

```text
test/
├── parking-animation-grabber.test.js
├── motion-runtime-transaction.test.js
├── viewport-clip.test.js
└── full-delta-scroll.test.js
```

# 59. full-delta-scroll.test.js

至少验证：

```text
SAFE_RIGHT_EDGE_SLIDE_X
不再存在于 production path
```

同时：

```text
Incoming 使用 transaction.deltaX
Continuing 使用 transaction.deltaX
Outgoing 使用 transaction.deltaX
```

# 60. generated bundle 检查

`tools/build.js` 中加入新增模块：

```text
ParkingAnimationGrabber.js
ViewportClip.js
```

然后：

```bash
node tools/build.js
node tools/build.js --check
```

必须 PASS。

# 61. CI

现有：

```text
.github/workflows/regression.yml
```

继续使用。

Phase 14 不需要新 workflow。

只需要：

```text
新 tests 自动进入 tools/check.js
```

即可。

---

# 62. 人工验收矩阵

## A. 普通 H/L

执行：

```text
L L L H H L
```

要求：

```text
完整横向滚动
无 snap
无 Dock restore
无副屏 flash
```

## B. 7 Column

建立：

```text
1 2 3 4 5 6 7
```

从：

```text
1|2
```

连续滚到：

```text
6|7
```

要求：

```text
每一步完整 full-delta
```

## C. Dock Long Jump

点击：

```text
2 → 7
```

要求：

```text
逐 step 连续滚动
目标最后 focus
```

## D. Reverse Mid-flight

执行：

```text
L
80 ms
L
60 ms
H
```

要求：

```text
无视觉跳变
```

## E. User Minimize

Floating Window：

```text
Minimize
Restore
```

要求：

```text
KDE 原动画保留
```

## F. Managed Parking

Column 从 visible：

```text
→ parked
→ visible
```

要求：

```text
不触发 Dock restore
```

## G. Mixed DPI

环境：

```text
Primary 1.5
Secondary 1.0
```

执行：

```text
L × 10
H × 10
```

要求：

```text
副屏无任何 incoming pixel
clip 边界稳定
```

## H. Wide

执行：

```text
L
→
Wide
→
H
```

要求：

```text
scroll 与 wide 仍按原顺序
```

## I. Floating

```text
detach
drag
reattach
```

要求：

```text
不进入错误 transaction
```

## J. Fullscreen

```text
Managed
→ F11
→ Exit F11
```

要求：

```text
原 Column layout 正确恢复
```

---

# 63. 性能检查

必须关注：

```text
GPU usage
KWin CPU
plasmashell CPU
```

Viewport shader 不能明显提高：

```text
idle GPU
```

或：

```text
KWin CPU
```

# 64. Shader 使用范围

只给：

```text
当前 Motion Transaction involved windows
```

绑定 clip shader。

禁止：

```text
所有 desktop windows
```

长期套 shader。

# 65. Clip 生命周期

```text
transaction start
→ enable clip

motion complete
→ disable clip
```

避免长期 effect state。

# 66. Recovery

如果 Effect crash 或 script reload：

```text
ParkingManager
Recovery
```

仍然必须可以：

```text
恢复真实窗口
```

即：

> Viewport Clip 不能成为 recovery dependency。

# 67. Emergency Restore

`Meta+Ctrl+Alt+Shift+F12`

必须继续：

```text
恢复 parked window
```

即使：

```text
clip state
grab state
motion state
```

异常。

建议 Effect 的：

```text
releaseAll()
endAll()
cancelAll()
```

在 reload / stop path 统一调用。

---

# 68. Stop Condition C

如果 full-delta 后出现：

```text
window.output
从 DP-1 变 HDMI-A-1
```

说明你错误修改了：

```text
real geometry
```

立即停止。

正常 full-delta 只允许：

```text
paint translation
```

# 69. Stop Condition D

如果必须通过：

```text
Opacity = 0
```

来避免副屏显示，

说明 viewport clip 失败。

不能把：

```text
opacity workaround
```

当最终实现。

# 70. Stop Condition E

如果出现：

```text
minimized input surface
透明窗口点击
focus steal
```

必须优先解决 correctness。

动画可以暂时退回 edge reveal。

稳定性优先于视觉。

---

# 71. Commit 顺序

推荐严格拆 commit。

```text
chore: freeze alpha37 motion baseline

feat: add parking animation grabber
test: cover parking animation ownership

refactor: make motion transactions runtime authoritative
test: cover explicit scroll motion roles

feat: add viewport clip debug path
test: cover viewport clip lifecycle

feat: enable viewport clipping
test: cover mixed-dpi viewport boundaries

feat: use full-delta column scrolling
test: cover full-delta scroll transactions

refactor: remove safe edge scroll workaround

perf: preserve distance-aware full-delta retargeting

docs: document phase 14 motion runtime
```

# 72. 禁止巨型 Commit

禁止：

```text
feat: implement niri animation
```

一次改：

```text
grab
shader
full delta
retarget
parking
wide
```

全部。

必须逐阶段验证。

---

# 73. 完成标准

Phase 14 完成必须同时满足：

```text
1.
CC parked window 不再从 Dock restore

2.
用户自己的 minimize 动画不受影响

3.
MotionTransaction 是普通 scrolling 主语义来源

4.
Incoming / Continuing / Outgoing
共享 full delta

5.
SAFE_RIGHT_EDGE_SLIDE_X 从标准 scroll path 删除

6.
普通 scroll 不使用明显 scale/fade

7.
Primary viewport 外 pixel 不进入副屏

8.
1.5 / 1.0 mixed DPI 稳定

9.
L/L/H 快速 retarget 无 snap

10.
Wide / Floating / Fullscreen 无回归

11.
Emergency Restore 可用

12.
tools/check.js PASS

13.
tools/check.js --native PASS

14.
GitHub Regression PASS
```

---

# 74. 完成后的 Motion Language

最终：

| 动作 | Motion |
|---|---|
| H/L | Full Strip Translation |
| Dock Step | Full Strip Translation |
| Close Refill | Translation |
| Reorder | Translation |
| Wide | Translation + Scale |
| Floating Attach | 可选轻微过渡 |
| Focus only | 无动画 |
| User Minimize | KDE 原生 |
| CC Parking | CC 接管，不出现 Dock restore |

---

# 75. Phase 15 才考虑什么

只有 Phase 14 稳定以后，才考虑：

```text
critically damped spring
velocity continuity
touchpad gesture motion
更连续的 Dock long-distance trajectory
```

Phase 14 不负责这些。

---

# 76. 最终目标

Phase 14 的意义不是：

```text
把 easing 调漂亮
```

而是完成最后一层：

```text
Logical Strip
        │
        ▼
Motion Transaction
        │
        ▼
Full Paint Translation
        │
        ▼
Primary Viewport Clip
```

最终实现：

```text
Window 在逻辑横向空间中连续滚动
但不会因为视觉运动污染相邻物理显示器
```

这才是 CC Niri 从：

```text
KWin 上的滚动布局模拟
```

进一步走向：

```text
compositor-like scrolling viewport experience
```

的关键阶段。
