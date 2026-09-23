# CC Niri Phase 15：Wide Preference + Contextual Viewport Layout 实现设计

> 项目：`Cc-aw/cc-niri`\
> 基线：`3.0.0-alpha.38` / `883f778`\
> 当前能力：模块化架构、MotionTransaction、Full-Delta Scroll、Native Viewport Clip 已完成。\
> 本阶段目标：重新定义 Wide 的语义与交互，使其既保留 72% 居中独占视图，又能在普通双列视图中临时以 50% 展示，并让 Wide ↔ Pair 的动画真正连续、贴合、无闪现。\
> 核心原则：**Wide 是窗口的持久偏好，不是永久宽度；实际显示由当前 Viewport Mode 和 Focus Intent 决定。**

---

# 1. 目标交互

假设：

```text
1.persistentWide = true
2.persistentWide = false
```

Wide 独占时：

```text
                ┌────────────────────┐
                │       1 72%        │
                └────────────────────┘

左右都不显示其它窗口
```

按：

```text
Meta+L
```

进入普通双列：

```text
┌──────────────┐ 8px ┌──────────────┐
│      1       │     │      2       │
│     50%      │     │     50%      │
└──────────────┘     └──────────────┘

focus = 2
```

此时：

```text
1.persistentWide = true
```

仍然保留。

再按：

```text
Meta+H
```

因为是通过方向导航重新进入 1：

```text
PAIR
→
WIDE_FOCUS
```

最终：

```text
                ┌────────────────────┐
                │       1 72%        │
                └────────────────────┘
```

---

# 2. 鼠标点击行为

在：

```text
1(50) | 2(50)
focus = 2
```

鼠标点击 1：

```text
focus = 1
```

但布局保持：

```text
1(50) | 2(50)
```

绝不能自动：

```text
1 → 72% 居中
```

也就是说：

> **焦点变化本身不能触发 Wide。**

只有明确的方向导航进入：

```text
Meta+H
Meta+L
```

才允许自动进入 `WIDE_FOCUS`。

---

# 3. Dock / Alt+Tab 行为

Dock 点击 Wide 窗口：

```text
PAIR
focus = Wide Column
```

保持 Pair。

Alt+Tab 切到 Wide 窗口：

```text
PAIR
focus = Wide Column
```

也保持 Pair。

推荐统一规则：

```text
Pointer / Dock / Alt+Tab
→ focus only

Directional navigation
→ focus + optional Wide entry
```

---

# 4. Wide 的真实语义

保留：

```js
column.persistentWide
```

它表示：

```text
“当用户以明确的空间导航进入这个 Column 时，
它应该以 Wide 方式展示。”
```

它不表示：

```text
“这个 Column 当前实际宽度永远是 72%。”
```

---

# 5. 两个独立状态轴

以后必须明确区分：

## 5.1 Window Preference

```text
persistentWide = true / false
```

属于 Column。

## 5.2 Viewport Mode

```text
PAIR
WIDE_FOCUS
```

属于当前 viewport / layout 状态。

这两个状态不能混为一谈。

---

# 6. 推荐状态结构

建议：

```js
appState.viewport = {
    mode: "pair",
    wideColumnId: null
};
```

Wide 独占：

```js
appState.viewport = {
    mode: "wide-focus",
    wideColumnId: column.id
};
```

---

# 7. Presentation 语义应简化

当前：

```text
Presentation
├── NORMAL
├── WIDE
└── MAXIMIZED
```

建议逐步迁移成：

```text
Presentation
├── NORMAL
└── MAXIMIZED
```

而 Wide 转移到：

```text
Viewport Mode
```

因此：

```text
Safe Maximize
```

和：

```text
Wide Focus
```

不再属于同一个状态机。

---

# 8. Focus Intent

这是本阶段最重要的新概念之一。

建议定义：

```js
const FocusSource = Object.freeze({
    DIRECTIONAL: "directional",
    POINTER: "pointer",
    DOCK: "dock",
    ALT_TAB: "alt-tab",
    PROGRAMMATIC: "programmatic",
});
```

或者不做常量文件，只保证所有入口都明确传递 source。

---

# 9. `shouldEnterWide()`

建议：

```js
function shouldEnterWide(column, intent) {
    return Boolean(
        column &&
        column.persistentWide &&
        intent.source === FocusSource.DIRECTIONAL &&
        intent.changedFocus
    );
}
```

不能写：

```js
if (focusedColumn.persistentWide) {
    enterWide();
}
```

否则鼠标点击也会自动展开。

---

# 10. 状态转换表

| 当前 | 操作 | 目标 | 结果 |
|---|---|---|---|
| `WIDE_FOCUS(1)` | `Meta+L` | 2 | `PAIR`, focus=2 |
| `PAIR`, focus=2 | `Meta+H` | Wide 1 | `WIDE_FOCUS(1)` |
| `PAIR`, focus=2 | 鼠标点击 1 | 1 | `PAIR`, focus=1 |
| `PAIR`, focus=2 | Dock 点击 1 | 1 | `PAIR`, focus=1 |
| `PAIR`, focus=1 | `Meta+L` | 2 | `PAIR`, focus=2 |
| `PAIR`, focus=1 | `Meta+Z` | 1 | `WIDE_FOCUS(1)` |
| `WIDE_FOCUS(1)` | `Meta+Z` | 1 | 取消 Wide preference + 回 `PAIR` |
| `PAIR`, focus=1 | Alt+Tab 到 1 | 1 | `PAIR`, focus=1 |

---

# 11. `Meta+Z` 语义

## 11.1 Normal → Wide

当前焦点 Column：

```text
persistentWide = false
```

按：

```text
Meta+Z
```

变成：

```text
persistentWide = true
viewport.mode = WIDE_FOCUS
```

并进入 72% 居中。

## 11.2 Wide → Normal

如果当前：

```text
persistentWide = true
viewport.mode = WIDE_FOCUS
```

按：

```text
Meta+Z
```

则：

```text
persistentWide = false
viewport.mode = PAIR
```

回到普通 50/50。

---

# 12. PAIR 模式的布局规则

PAIR 中：

```text
所有 Column 一律按 50% projected width
```

即使：

```text
persistentWide = true
```

也一样。

例如：

```text
1(persistentWide=true)
2(normal)
```

PAIR 中仍然：

```text
1(50) | 2(50)
```

所以：

> persistentWide 不参与 Pair 几何计算。

---

# 13. WIDE_FOCUS 模式的布局规则

WIDE_FOCUS 中：

```text
target Wide Column = 72%
centered
```

其它 Column：

```text
steady state 不显示
```

即：

```text
parked / isolated hidden
```

最终：

```text
left blank | Wide 72% | right blank
```

---

# 14. 数值

主屏：

```text
safeWidth = 2512
gap = 8
```

Half：

```text
1252 px
```

Wide：

```text
round(2512 * 0.72)
= 1809 px
```

左右 gutter：

```text
(2512 - 1809) / 2
≈ 351 / 352 px
```

Wide real geometry：

```text
x = safeRect.x + 351
width = 1809
```

---

# 15. 当前动画为什么闪

当前 Wide 离开时：

```text
Wide Window
→ WIDE_EXIT

Neighbor
→ parked → visible
```

如果没有普通 scroll transaction：

```text
Neighbor
→ INCOMING_UNARMED
```

当前 `INCOMING_UNARMED`：

```text
20 px Translation
+
Scale
+
Opacity
```

视觉上就是：

```text
“窗口突然弹出来”
```

而不是贴着 Wide 一起运动。

本阶段必须让正常 Wide ↔ Pair 路径彻底绕过：

```text
INCOMING_UNARMED
```

---

# 16. Wide ↔ Pair 必须成为同一个 Motion Transaction

不能继续：

```text
Wide Window:
WIDE_EXIT animation

Neighbor:
INCOMING_UNARMED animation
```

必须变成：

```text
Transaction:
WIDE_TO_PAIR
```

包含：

```text
Wide Window
Neighbor
```

同一 transaction、同一 timeline。

---

# 17. Wide → Pair 的几何

初始 Wide：

```text
1:
x = 375
width = 1809
```

Pair 终点：

```text
1:
x = 24
width = 1252

2:
x = 1284
width = 1252
```

---

# 18. Neighbor 的虚拟起点

为了让 2 从第一帧就贴着 Wide：

Wide 右边：

```text
375 + 1809
= 2184
```

加 gap：

```text
2184 + 8
= 2192
```

因此：

```text
2.oldVisualX = 2192
```

虽然 2 当前真实 window 可能 parked。

---

# 19. Wide → Pair 中 2 的运动

最终：

```text
2.newX = 1284
```

所以：

```text
TranslationX:
2192 - 1284
= +908
→
0
```

这是完整空间移动。

---

# 20. Wide → Pair 中 1 的运动

最终 geometry：

```text
x = 24
width = 1252
```

第一视觉帧要保持：

```text
x = 375
width = 1809
```

所以需要：

```text
TranslationX:
351 → 0
```

以及：

```text
ScaleX:
1809 / 1252
≈ 1.445
→
1
```

Anchor：

```text
LEFT
```

---

# 21. “贴着滚”的数学条件

动画任意时间：

```text
wide.visualRight(t) + gap
==
neighbor.visualLeft(t)
```

允许误差：

```text
< 1 px
```

这是本阶段最重要的视觉验收标准。

---

# 22. 为什么总位移是 908 px

从 Wide centered 到 Pair：

```text
左 gutter:
351 px

Pair 中目标移动:
557 px
```

合计：

```text
351 + 557
= 908 px
```

因此 Neighbor 的完整运动不是：

```text
20 px
```

也不是：

```text
557 px
```

而是：

```text
908 px
```

---

# 23. Pair → Wide 完全反向

PAIR：

```text
1:
x=24
w=1252

2:
x=1284
w=1252
```

进入 Wide：

```text
1:
x=375
w=1809

2 virtual:
x=2192
```

Window 2：

```text
Translation:
0 → +908
```

Window 1：

```text
x:
24 → 375

width:
1252 → 1809
```

---

# 24. Wide Isolation

你的目标要求：

```text
Wide steady state
两侧完全空
```

但 2 的 virtual position：

```text
x=2192
```

仍有一部分落在 safe viewport 内。

所以必须有：

```text
Wide Isolation
```

---

# 25. 第一版 Wide Isolation：Opacity

推荐第一版使用：

## Wide → Pair

Neighbor：

```text
Translation:
+908 → 0

Opacity:
0 → 1
```

## Pair → Wide

Neighbor：

```text
Translation:
0 → +908

Opacity:
1 → 0
```

最终 opacity=0 后：

```text
park/minimize
```

---

# 26. 不要给 Neighbor 加 Scale

当前：

```text
INCOMING_UNARMED
```

使用：

```text
Scale
Opacity
```

会产生“卡片弹出”感。

新 Wide Transition：

```text
Neighbor
=
Translation + Opacity
```

只允许 visibility fade。

---

# 27. 后续升级：Gutter Mask

模型稳定以后，可以把 Neighbor opacity 去掉。

用 Native Effect 做：

```text
Wide Isolation Mask
```

逻辑：

```text
Wide 左右 gutter 不绘制其它 Column
```

这样：

```text
Neighbor opacity = 1
```

只是被 mask 逐渐 reveal / hide。

这是后续 polish，不是第一版要求。

---

# 28. Virtual Visual Geometry

这是本阶段真正需要加入的数据概念。

Wide steady state 中：

```text
Neighbor real geometry
=
parking
```

但是它仍然必须有：

```text
virtualVisualRect
```

例如：

```js
{
    x: 2192,
    y: 50,
    width: 1252,
    height: 1320
}
```

动画不能因为 real geometry 在 parking area 就失去它在 strip 中的逻辑位置。

---

# 29. LayoutSnapshot

建议引入：

```js
LayoutSnapshot
```

包含：

```js
{
    viewportMode,

    entries: [
        {
            columnId,
            visualRect,
            realRect,
            placement
        }
    ]
}
```

---

# 30. PAIR Snapshot

例如：

```text
1:
visualRect = 24..1276
realRect = 24..1276
placement = visible

2:
visualRect = 1284..2536
realRect = 1284..2536
placement = visible
```

---

# 31. WIDE_FOCUS Snapshot

```text
1:
visualRect = 375..2184
realRect = 375..2184
placement = visible

2:
visualRect = 2192..3444
realRect = parking
placement = isolated-hidden
```

重点：

```text
visualRect ≠ realRect
```

对于 isolated neighbor 是正常的。

---

# 32. MotionTransaction 应升级

当前主要是：

```text
deltaX
continuing
incoming
outgoing
```

Wide Context Motion 更适合：

```js
{
    id,
    type,

    oldViewportMode,
    newViewportMode,

    entries: [
        {
            windowId,
            role,
            oldVisualRect,
            newVisualRect,
            oldOpacity,
            newOpacity
        }
    ]
}
```

---

# 33. 新 MotionType

建议：

```text
WIDE_TO_PAIR
PAIR_TO_WIDE
```

或者统一：

```text
VIEWPORT_LAYOUT_TRANSITION
```

第一版更推荐显式：

```text
WIDE_TO_PAIR
PAIR_TO_WIDE
```

方便调试。

---

# 34. Effect 不再猜 Wide

正常 Wide Transition path 不应该再依赖：

```text
isFocusWide()
presentationTransition()
visibleSlot()
isColumnSize()
```

这些可以留作：

```text
legacy fallback
diagnostic
```

主逻辑应该直接消费 MotionTransaction。

---

# 35. `INCOMING_UNARMED` 的新定位

保留给：

```text
Close refill
unexpected recovery
legacy fallback
```

但以下正常路径绝不能出现：

```text
WIDE_FOCUS → PAIR
PAIR → WIDE_FOCUS
```

如果日志出现：

```text
INCOMING_UNARMED
```

说明 transition plan 没建立成功。

---

# 36. `focusRelativeColumn()` 重构

方向导航时：

```text
oldColumn
targetColumn
intent = DIRECTIONAL
```

逻辑：

```text
if current viewport = WIDE_FOCUS:
    leave Wide
    focus target
    enter PAIR

else if target.persistentWide:
    focus target
    enter WIDE_FOCUS

else:
    normal PAIR navigation
```

---

# 37. 方向导航伪代码

```js
function focusRelativeColumn(delta) {
    const target = neighbor(delta);

    if (!target) return;

    const intent = {
        source: FocusSource.DIRECTIONAL,
        direction: delta,
        changedFocus: true,
    };

    if (viewport.mode === "wide-focus") {
        transitionWideToPair(target, intent);
        return;
    }

    if (shouldEnterWide(target, intent)) {
        transitionPairToWide(target, intent);
        return;
    }

    focusPairTarget(target, intent);
}
```

---

# 38. 鼠标激活

当前 windowActivated path 必须变成：

```text
focus only
```

如果当前是 PAIR：

```text
保持 PAIR
```

不能：

```text
target.persistentWide
→ 自动 Wide
```

---

# 39. Dock 点击

建议：

```text
focus only
+
ensure target visible in PAIR
```

即使 target.persistentWide：

```text
也不进入 WIDE_FOCUS
```

---

# 40. Alt+Tab

推荐和 Pointer / Dock 一样：

```text
focus only
PAIR 保持
```

这是最可预测的规则。

---

# 41. WIDE_FOCUS 时鼠标点其它 Window

正常情况下其它窗口不可见，所以不存在直接点邻居。

如果有特殊 transient/floating：

```text
不要因为 focus 暂时跑到 dialog 就立即退出 Wide
```

这部分后续 WindowPolicy 再处理。

第一版只处理 managed Column focus。

---

# 42. PresentationController 迁移

逐步移除：

```text
PRESENTATION_WIDE
wideRect()
selectPersistent Wide
```

但不要第一步就删。

先让新：

```text
ViewportMode
```

接管 Wide runtime。

等所有入口迁移完成再删除旧逻辑。

---

# 43. WideTransition 迁移

当前：

```text
scrolling
awaitingStep
settled
expanding
animating
```

新模型不再需要：

```text
“先到 pair，再额外按一次键进入 Wide”
```

方向导航目标是 persistentWide 时：

```text
直接 PAIR_TO_WIDE
```

---

# 44. 最终可删除

Phase 完成后：

```text
WIDE_REVEAL_PHASE_SCROLLING
WIDE_REVEAL_PHASE_AWAITING_STEP
WIDE_REVEAL_PHASE_SETTLED
WIDE_REVEAL_PHASE_EXPANDING
WIDE_REVEAL_PHASE_ANIMATING

WIDE_PAIR_HOLD_MS
WIDE_GEOMETRY_RETRY_MS
WIDE_GEOMETRY_MAX_ATTEMPTS

beginStepIfPending()
armStep()
schedule()
settle()
complete()
```

大部分都可以退休。

---

# 45. Geometry ACK

Wide resize 本身仍然是：

```text
1252 ↔ 1809
```

Wayland client 可能异步接受 geometry。

因此：

```text
geometry ACK
```

这个机制仍然可能有价值。

但它只应该负责：

```text
确认 target real geometry 已到位
```

不能再负责：

```text
导航状态
pair hold
二次输入
```

---

# 46. 推荐新的 Resize ACK

只保留简单：

```text
request geometry
↓
wait ACK
↓
start/finalize visual transition
```

如果当前 paint animation 可以在 commit 后直接正确工作，则进一步简化。

---

# 47. Partial View 不作为 steady Wide

注意：

本目标不是：

```text
Wide 1 永远 72%
然后 Focus 2 时显示 1 partial
```

而是：

```text
PAIR 中 1 临时就是 50%
```

所以：

```text
1 | 2
```

时两者完全一致：

```text
50% + 50%
```

这是和“Variable Width Strip”方案最大的区别。

---

# 48. Pair 中无需 Partial Geometry

因此 Pair 仍然可以继续：

```text
两个 full visible Column
```

这对稳定性非常有利。

不需要引入：

```text
steady partial-left window
```

也不需要处理 partial input region。

---

# 49. 这是本方案的重要优势

相比“Wide 永远 72%”：

当前方案：

```text
PAIR
=
始终两个完整 50%
```

所以：

- 不会有 partial input；
- 不会跨 output；
- 不需要 steady persistent clip；
- 不需要改变现有 pair parking 规则；
- Native Clip 只继续服务 motion。

这非常适合你当前架构。

---

# 50. Native Viewport Clip 的作用

Wide ↔ Pair transition 过程中：

Neighbor 的 virtual position 可能：

```text
2192...
```

甚至跨越 viewport 边界。

Native Clip 继续负责：

```text
动画期间
禁止 paint 泄漏到副屏
```

steady state 仍然保持：

```text
PAIR full-visible
WIDE only target visible
```

---

# 51. Parking 顺序

## Wide → Pair

不能先：

```text
unpark neighbor
↓
再决定动画起点
```

应该：

```text
build transition snapshot
↓
记录 neighbor oldVisualRect
↓
commit pair real geometry
↓
unpark / unminimize
↓
Effect 从 oldVisualRect 开始绘制
```

---

# 52. Pair → Wide

不能：

```text
先 park neighbor
↓
再动画
```

否则 Neighbor 会瞬间消失。

正确：

```text
build transaction
↓
commit Wide target geometry
↓
Neighbor 保持可 paint
↓
两者一起运动
↓
Neighbor opacity → 0
↓
动画完成
↓
再 park/minimize Neighbor
```

---

# 53. Deferred Parking Ownership

建议 transaction 自己记录：

```js
{
    type: "PAIR_TO_WIDE",
    parkAfterComplete: [neighborWindowId]
}
```

不要新增散乱全局 flag。

---

# 54. 不建议靠固定 220ms 后 park

优先：

```text
animation completion
```

如果 Scripted Effect 无法可靠回调 Script，再使用：

```text
transaction token + guarded deferred finalize
```

但不要重新恢复复杂 Wide FSM。

---

# 55. Test：鼠标不进入 Wide

初始：

```text
PAIR
focus=2
1.persistentWide=true
```

事件：

```text
mouse activate 1
```

断言：

```text
viewport.mode == PAIR
focus == 1
1 geometry == 50%
2 geometry == 50%
```

---

# 56. Test：Directional Entry

初始：

```text
PAIR
focus=2
1.persistentWide=true
```

事件：

```text
Meta+H
```

断言：

```text
viewport.mode == WIDE_FOCUS
focus == 1
1 geometry == 72% centered
2 eventually parked
```

---

# 57. Test：Wide Exit

初始：

```text
WIDE_FOCUS(1)
```

事件：

```text
Meta+L
```

断言：

```text
PAIR
focus=2
1=50%
2=50%
```

并且：

```text
MotionType == WIDE_TO_PAIR
```

---

# 58. Test：无 INCOMING_UNARMED

Wide 正常进入/退出路径中必须确认：

```text
INCOMING_UNARMED
```

不出现。

---

# 59. Test：贴边连续性

Wide → Pair 任意 t：

```text
abs(
    wideRight(t)
    + innerGap
    - neighborLeft(t)
) < 1
```

---

# 60. Test：Pair → Wide

同样：

```text
abs(
    wideRight(t)
    + innerGap
    - neighborLeft(t)
) < 1
```

在 Neighbor 被 isolation fade 隐藏前持续成立。

---

# 61. Test：Dock

PAIR 中 Dock 点击 Wide：

```text
focus changes
viewport stays PAIR
```

---

# 62. Test：Alt+Tab

PAIR 中 Alt+Tab 到 Wide：

```text
focus changes
viewport stays PAIR
```

---

# 63. Test：Meta+Z

Normal：

```text
persistentWide=false
```

按 Z：

```text
persistentWide=true
viewport=WIDE_FOCUS
```

再次 Z：

```text
persistentWide=false
viewport=PAIR
```

---

# 64. Test：Maximize

Wide preference 窗口：

```text
persistentWide=true
```

进入 Safe Maximize 后恢复：

```text
persistentWide
```

仍保留。

建议保存：

```text
prePresentationViewportMode
```

恢复进入 maximize 前的 viewport mode。

---

# 65. Test：Fullscreen

F11 不清除：

```text
persistentWide
```

退出 fullscreen 恢复之前 viewport mode。

---

# 66. 推荐实施阶段

## Phase A：引入 ViewportMode

新增：

```text
PAIR
WIDE_FOCUS
```

先不改动画。

## Phase B：FocusIntent

区分：

```text
Meta H/L
Mouse activation
Dock
Alt+Tab
```

入口 source。

## Phase C：改 Wide Runtime

让：

```text
PAIR:
Wide preference window 仍显示 50%

WIDE_FOCUS:
72% centered
```

## Phase D：移除 Wide 双步骤导航

删除：

```text
awaitingStep
```

实现：

```text
2 --Meta+H--> Wide 1
```

一次完成。

## Phase E：LayoutSnapshot / Virtual Visual Rect

记录：

```text
Wide Window old/new visual
Neighbor old/new virtual visual
```

## Phase F：WIDE_TO_PAIR Motion

实现：

```text
Wide resize + translate
Neighbor full translation + fade-in
```

## Phase G：PAIR_TO_WIDE Motion

反向实现：

```text
Wide expand + translate
Neighbor full translation + fade-out
```

## Phase H：Deferred park after motion

确保 Neighbor 动画结束前不被 parking。

## Phase I：鼠标/Dock/Alt+Tab 行为回归

确保它们：

```text
focus only
```

## Phase J：清理旧 Presentation Wide / WideTransition FSM

最后再删除旧路径。

---

# 67. 推荐 Commit 顺序

```text
chore: freeze alpha38 wide-motion baseline

feat: add pair and wide-focus viewport modes
test: cover viewport mode transitions

refactor: distinguish directional and pointer focus intents
test: keep pointer focus in pair layout

refactor: make persistent wide a preference instead of active geometry
test: show wide-preferred columns as half width in pair mode

feat: enter wide focus only on directional navigation
test: cover meta-h meta-l wide entry

feat: add wide-pair layout snapshots
test: preserve virtual neighbor geometry

feat: animate wide to pair as one motion transaction
test: keep wide and neighbor spatially attached

feat: animate pair to wide as one motion transaction
test: defer neighbor parking until motion completion

refactor: remove two-step wide navigation state
refactor: remove legacy presentation-wide runtime
test: reject incoming-unarmed on normal wide navigation

docs: document contextual wide viewport behavior
```

---

# 68. 禁止事项

禁止：

```text
鼠标 focus Wide
→ 自动展开
```

禁止：

```text
PAIR 中 Wide preference 仍保持 72%
```

禁止：

```text
Neighbor 继续使用 20px INCOMING_UNARMED
```

禁止：

```text
Pair → Wide
先 park neighbor 再动画
```

禁止：

```text
用 Scale 让 Neighbor 弹出
```

---

# 69. 最终模型

```text
Column Preference:
persistentWide = true/false

        +

Viewport Mode:
PAIR
WIDE_FOCUS

        +

Focus Intent:
DIRECTIONAL
POINTER
DOCK
ALT_TAB
```

三者共同决定行为。

---

# 70. 最终用户体验

用户设置：

```text
1 = Wide preferred
```

之后：

### 独占

```text
        [ 1 72% ]
```

### Meta+L

```text
[ 1 50% ] | [ 2 50% ]
```

### 鼠标点 1

```text
[ 1 50% ] | [ 2 50% ]
focus=1
```

不改变布局。

### 再切到 2，然后 Meta+H

```text
        [ 1 72% ]
```

自动恢复 Wide。

---

# 71. 最终设计原则

Wide 不再表示：

```text
“这个窗口永远应该是 72%”
```

而表示：

```text
“这个窗口在明确的空间导航进入时，
应该获得一个 72% 居中的专注视图。”
```

而 Pair 模式始终保持：

```text
50% | 50%
```

因此既保留：

```text
Wide 的专注体验
```

又保留：

```text
Pair 的稳定性、鼠标自由度和空间连续动画
```

这是当前 CC Niri 最适合的 Wide 交互模型。
