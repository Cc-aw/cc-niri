# CC Niri：按当前 niri ViewOffset 模型重构 H/L 连续横向滚动 —— 实现设计

> **实施状态（2026-10-04）：** 用户指定的下一阶段目标 `viewoffset_spring`；Phase 1 纯 Spring / ViewportMotion、Phase 2 SCROLL plan 协议、Phase 3 原生 continuing、Phase 4 incoming 投影、Phase 5 outgoing 延迟停放与 Phase 6 旧普通 SCROLL 动画退出已实现；第三阶段已部署并完成一轮内屏验收；第四、第五阶段已配套部署并通过自动实机及本轮内屏人工验收：慢速 H/L 间距稳定且连续滑出、滚动中 J/K 清理正常、Wide J/K 状态保持；第六阶段尚未部署；快速连续 retarget、反向完整矩阵及 mixed DPI 尚待后续阶段，不表示所有交互验收完成。以共享 ViewOffset + Spring 驱动普通 Pair/Column 的 H/L 横向滚动；第一版不改 Wide 尺寸动画或 J/K Workspace 切换。
> 文档基线需与已完成 W0–W9 的当前 main 核对；原设计正文保留。阅读入口见 [文档索引](../README.md)；进度见 [Phase 1 记录](../../test/VIEWOFFSET_SPRING_PHASE1_RESULTS.md)、[Phase 2 记录](../../test/VIEWOFFSET_SPRING_PHASE2_RESULTS.md)、[Phase 3 记录](../../test/VIEWOFFSET_SPRING_PHASE3_RESULTS.md)、[内屏验收](../../test/VIEWOFFSET_SPRING_PHASE3_LIVE_RESULTS.md)、[Phase 4 记录](../../test/VIEWOFFSET_SPRING_PHASE4_RESULTS.md)。

> 项目：`Cc-aw/cc-niri`  
> 目标范围：普通 Pair/Column 模式下的 `Meta+H / Meta+L` 横向焦点移动  
> 设计基线：niri 当前 `main`（核对提交：`1f03391ea644c2a43597de7f637269e26d1e1b49`）  
> cc-niri 基线：当前 `main`（核对提交：`bde8a03f0e3dba977dd6575118e08ce65b38a6d6`）  
> 目标平台：KWin / Plasma 6.7.x、Wayland、主屏 150% + 副屏 100% 混合缩放  
> 文档定位：这是 **H/L 滚动运动模型重构**，不是全项目重构，也不是性能优化文档。

---

# 1. 目标

本次修改只解决一个问题：

> **让 cc-niri 的 H/L 从“每个窗口分别播放一次 Translation 动画”，改成和 niri 相同思路的“整个横向空间由一个共享 ViewOffset 驱动”。**

最终希望得到的视觉：

```text
Logical strip:

A | B | C | D | E

Viewport:
    ┌───────────┐
    │  B | C    │
    └───────────┘

连续按 L：

target offset
      1260
        ↓
      2520
        ↓
      3780

实际看到的是同一个 viewport 连续向右移动，
窗口只是随着同一个 viewport 位置被投影出来。
```

不是：

```text
B 动画一次
C 动画一次
D 动画一次
```

而是：

```text
只有一个 animatedScrollOffsetX
```

所有参与滚动的 Column 都由它决定最终的 paint position。

---

# 2. 非目标

第一版明确 **不同时修改**：

- Focus Wide 的尺寸变化动画；
- `Meta+Shift+H/L` Reorder；
- Dock 长距离点击的 step planner；
- Floating attach / detach；
- Fullscreen；
- Workspace 上下滚动；
- 新增触摸板手势；
- 整体替换 JavaScript；
- Rust 重写；
- KWin fork。

这些功能继续使用现有路径。

第一版只建立：

```text
Meta+H / Meta+L
        ↓
共享 ViewOffset
        ↓
Native Spring
        ↓
统一 paint translation
```

---

# 3. 当前 niri 的真实实现思路

## 3.1 niri 不是“每个窗口各自动画”

当前 niri 的 `ScrollingSpace` 内部拥有：

```rust
view_offset: ViewOffset
```

其状态是：

```rust
enum ViewOffset {
    Static(f64),
    Animation(Animation),
    Gesture(ViewGesture),
}
```

也就是说，横向滚动空间只有一个主要的视口偏移状态。

窗口/Column 的逻辑位置和当前屏幕显示位置是分离的。

核心关系：

```text
view_pos = active_column_x + view_offset.current()
```

而各 Column 的 render position 基本是：

```text
column_render_x
    =
column_logical_x
    -
view_pos
    +
column_local_render_offset
```

因此所有 Column 天然共享同一个滚动量。

---

## 3.2 niri H/L 的执行路径

当前 niri 普通左右焦点大致为：

```text
focus_left / focus_right
        ↓
activate_column(new_idx)
        ↓
compute_new_view_offset_for_column(...)
        ↓
animate_view_offset_with_config(...)
        ↓
ViewOffset::Animation(Animation)
```

重点：

```text
焦点变化只是改变 ViewOffset 的目标。
```

而不是分别为：

```text
old window
continuing window
incoming window
outgoing window
```

各创建一条独立横移动画。

---

## 3.3 niri 的 current / target 双状态

`ViewOffset` 提供两个很重要的概念：

```text
current()
target()
```

含义：

```text
current()
= 此刻真正用于绘制的 view offset

target()
= 当前动画最终应该到达的位置
```

这样布局计算可以基于：

```text
target
```

继续接受新的命令，

而绘制仍然使用：

```text
current
```

这正是连续 H/L 的核心。

---

## 3.4 niri 当前 H/L 使用 Spring

当前默认：

```text
horizontal-view-movement

damping-ratio = 1.0
stiffness     = 800
epsilon       = 0.0001
```

这是：

```text
critical damping
```

也就是临界阻尼。

特点：

- 快速；
- 无明显 overshoot；
- 没有“220 ms 固定播放一段”的明显时间边界；
- 不需要给用户感知一个固定 duration；
- 到达目标的时间由弹簧状态决定。

---

## 3.5 一个重要事实：当前 niri 并没有保留旧动画速度

当前 niri 在重新创建普通 ViewOffset 动画时使用：

```rust
Animation::new(
    clock,
    self.view_offset.current(),
    new_view_offset,
    0.,
    config,
)
```

也就是说：

```text
from = 当前视口位置
to   = 新目标
initial_velocity = 0
```

源码仍有：

```text
FIXME: also compute and use current velocity.
```

因此本项目第一版 **不要为了“比 niri 更高级”擅自增加速度继承**。

第一版应首先做到：

```text
共享 ViewOffset
+
Spring
+
从 current retarget
```

并把：

```text
initial_velocity = 0
```

作为与当前 niri 一致的 baseline。

后续如果要实验 velocity continuity，再单独 A/B。

---

# 4. cc-niri 其实已经有一半正确模型

当前：

```js
projectColumnRect(column, safeRect, scrollOffsetX)
```

本质是：

```text
x =
safeRect.x
+
column.logicalX
-
scrollOffsetX
```

这已经与 niri 的 ViewOffset 投影思路非常接近。

当前 cc-niri 已有：

```text
column.logicalX
column.pixelWidth
scrollOffsetX
safeRect
```

因此：

> **不需要重写布局模型。**

只需要把现在的：

```text
scrollOffsetX = 离散提交后的最终位置
```

扩展为：

```text
targetScrollOffsetX  —— JS 布局真值
animatedScrollOffsetX —— Native Effect 当前视觉位置
```

---

# 5. 本次架构的核心原则

以后普通 H/L 必须严格区分：

## Layout Target

由 JS 管理：

```text
scrollOffsetX
```

表示：

```text
最终布局应该在哪里。
```

它可以在用户按键后立即更新。

## Visual Current

由 Native Effect 管理：

```text
animatedScrollOffsetX
```

表示：

```text
这一帧 viewport 实际画在哪里。
```

它通过 Spring 向：

```text
targetScrollOffsetX
```

运动。

---

# 6. 最终公式

对于任意 Column：

```text
idealVisualX_i(t)
    =
safeRect.x
+
logicalX_i
-
animatedScrollOffsetX(t)
```

实际 KWin Window 已经有真实：

```text
frameGeometry.x
```

因此 Effect 只需要：

```text
translationX_i(t)
    =
idealVisualX_i(t)
-
frameGeometry.x
```

最终在：

```cpp
paintWindow(...)
```

中：

```text
data.translate(translationX_i, 0)
```

这条公式是整个实现的核心。

---

# 7. 为什么不能继续使用“所有窗口统一 deltaX → 0”

对于：

```text
continuing
incoming
```

如果它们真实 geometry 已经提交到 target slot，那么：

```text
translation =
targetScrollOffsetX
-
animatedScrollOffsetX
```

确实对所有窗口一样。

但：

```text
outgoing
```

通常已经被真实 geometry 移到 parking rect。

因此如果只用共享：

```text
deltaX
```

它会从 parking rect 上动画，而不是从它的逻辑 Strip 位置动画。

正确方法必须基于：

```text
logicalX
+
animatedScrollOffsetX
```

重新计算每个窗口这一帧应该画在哪里。

因此共享的是：

```text
Viewport offset
```

不是简单共享：

```text
Translation delta
```

---

# 8. 推荐的新模块边界

第一版不要重命名现有 native plugin，避免安装和 KWin 加载链同时变化。

继续保留：

```text
native/viewport-clip/
```

在其中增加：

```text
native/viewport-clip/
├── ViewportClipEffect.cpp
├── ViewportClipEffect.h
├── ViewportMotion.cpp
├── ViewportMotion.h
├── Spring.cpp
├── Spring.h
├── CMakeLists.txt
└── main.cpp
```

稳定后如果需要，再改名：

```text
cc-niri-scroll-effect
```

第一版不做目录重命名。

---

# 9. ViewportMotion 状态模型

建议：

```cpp
enum class ViewportMotionKind {
    Static,
    Animation,
};
```

第一版暂时不做 Gesture。

结构：

```cpp
struct ViewportMotionState {
    ViewportMotionKind kind;

    double current;
    double target;

    double from;
    double initialVelocity;

    std::chrono::nanoseconds startTime;

    SpringParams params;

    qint64 epoch;
};
```

其中：

```text
Static:
current == target

Animation:
current 由 Spring sample 得到
target 为当前最终目标
```

---

# 10. Spring 参数

第一版直接采用当前 niri baseline：

```cpp
struct SpringParams {
    double dampingRatio = 1.0;
    double stiffness = 800.0;
    double epsilon = 0.0001;
    double mass = 1.0;
};
```

推导：

```text
criticalDamping = 2 * sqrt(mass * stiffness)

damping =
dampingRatio * criticalDamping
```

对于默认：

```text
mass = 1
stiffness = 800
dampingRatio = 1
```

就是临界阻尼。

---

# 11. Spring 计算方式

不要第一版用简单 Euler integration：

```text
v += a*dt
x += v*dt
```

原因：

- 帧率变化会影响结果；
- 60 / 120 / 144 Hz 手感可能不同；
- frame time spike 后可能出现数值差异。

建议像 niri 一样使用：

```text
解析解 / time-based sample
```

输入：

```text
from
to
initialVelocity
elapsedTime
SpringParams
```

直接算：

```text
position(elapsedTime)
```

---

# 12. 临界阻尼解析式

定义：

```text
x0 = from - to
beta = damping / (2 * mass)
v0 = initialVelocity
```

临界阻尼时：

```text
position(t)
=
to
+
exp(-beta*t)
*
(
    x0
    +
    (beta*x0 + v0) * t
)
```

第一版：

```text
v0 = 0
```

---

# 13. Spring 完成条件

不要依赖固定：

```text
220 ms
```

完成条件使用：

```text
abs(current - target) <= epsilon
```

同时为了避免极端数值情况，增加最大时间保护：

```text
MAX_SPRING_TIME_MS = 3000
```

如果超过：

```text
current = target
kind = Static
```

这只是 fail-safe。

---

# 14. Native Effect 需要拥有统一的 monotonic clock

禁止：

```text
JS Date.now()
+
C++ QDateTime
```

共同决定动画进度。

普通 SCROLL 的视觉时钟只由 Native Effect 管理。

优先使用：

```text
KWin effect frame/presentation timing
```

或 KWin 6.7 Effect API 中可获得的单调 presentation time。

如果当前 KWin 6.7.5 头文件签名和 master 不一致：

> **以本机 `/usr/include` 中 KWin Effect API 为准，不允许为了编译猜函数签名。**

不要退化成 wall-clock。

---

# 15. JS 不再负责普通 H/L 的逐窗口动画

当前 Scripted Effect 中普通 Scroll 会：

```text
geometryChanged
↓
识别 continuing/incoming/outgoing
↓
MotionController.start(...)
↓
animate(Effect.Translation)
```

新架构中：

## 普通 `MotionType.SCROLL`

必须 bypass：

```text
MotionController.start()
KWin animate(Translation)
distanceAwareDuration()
OutCubic
```

也就是说：

```text
普通 H/L：
Native ViewportMotion 唯一负责横向 motion
```

---

# 16. 旧 MotionController 仍然保留

不要删除整个：

```text
src/effect/MotionController.js
```

它继续服务：

- Wide；
- Close refill；
- Reorder；
- 其它非纯 viewport 变换；
- fallback。

只对：

```text
MotionType.SCROLL
```

建立新的 native path。

这样回归风险最小。

---

# 17. SCROLL Plan 应成为显式协议

当前 `LayoutEngine` 已经生成：

```js
scrollTransaction = {
    id,
    epoch,
    type: "SCROLL",
    direction,
    deltaX,
    oldScrollOffsetX,
    newScrollOffsetX,
    viewport,
    continuing,
    incoming,
    outgoing,
}
```

不要浪费这份信息。

现在需要扩展为 Native Effect 可直接消费的：

```text
ViewportScrollPlan
```

---

# 18. 推荐 SCROLL Motion Plan Schema

```json
{
  "protocol": 2,
  "sessionId": "...",
  "type": "SCROLL",
  "epoch": 108,
  "issuedAt": 123456789,

  "oldScrollOffsetX": 0.0,
  "newScrollOffsetX": 1260.0,

  "viewport": {
    "x": 24.0,
    "y": 50.0,
    "width": 2512.0,
    "height": 1320.0
  },

  "entries": [
    {
      "windowId": "uuid-A",
      "columnId": 1,
      "logicalX": 0.0,
      "pixelWidth": 1252.0,
      "oldPlacement": "visible",
      "newPlacement": "parked"
    },
    {
      "windowId": "uuid-B",
      "columnId": 2,
      "logicalX": 1260.0,
      "pixelWidth": 1252.0,
      "oldPlacement": "visible",
      "newPlacement": "visible"
    },
    {
      "windowId": "uuid-C",
      "columnId": 3,
      "logicalX": 2520.0,
      "pixelWidth": 1252.0,
      "oldPlacement": "parked",
      "newPlacement": "visible"
    }
  ]
}
```

第一版普通 H/L 的 entries 通常：

```text
2~3 个
```

不要硬编码一定 3 个，因为：

- Strip 边缘可能只有 2 个；
- 以后列宽变化后可能不同。

---

# 19. 协议传输：复用现有 Bridge

当前已经存在：

```text
DockGateway.publishMotionPlan()
    ↓
ScrollDockBridge::PublishMotionPlan()
    ↓
MotionPlanChanged
    ↓
native ViewportClipEffect
```

这条链已经被 Wide 使用并验证。

因此第一版不要再建立第二套 IPC。

建议：

```text
扩展 PublishMotionPlan
```

允许：

```text
WIDE_TO_PAIR
PAIR_TO_WIDE
SCROLL
```

而不是新增：

```text
PublishScrollMotionPlan
```

---

# 20. Protocol Version

由于 `PublishMotionPlan()` 当前 schema：

```text
只允许 Wide
entries.size() == 2
```

这次属于真实协议扩展。

建议：

```text
motion plan protocol -> 2
```

但普通 Dock State protocol 可以继续：

```text
1
```

两者不要强绑。

---

# 21. LayoutEngine 修改

文件：

```text
src/kwin/layout/LayoutEngine.js
```

当前已经计算：

```text
oldProjectedRect
newProjectedRect
oldPlacement
newPlacement
transitionRole
```

新增：

```js
scrollTransaction.entries
```

每项至少：

```js
{
    windowId,
    columnId,
    logicalX: column.logicalX,
    pixelWidth: column.pixelWidth,
    oldPlacement,
    newPlacement,
}
```

不要把：

```text
parkingRect.x
```

当成视觉逻辑信息传给 Native。

Native 视觉计算只信：

```text
logicalX
safeRect
animatedScrollOffsetX
```

---

# 22. 为什么 cc-niri 不需要照抄 niri 的 offset_delta 修正

niri 的：

```text
view_offset
```

是相对于：

```text
active column
```

定义的。

所以 active column 改变时，它要先：

```text
view_offset.offset(old_col_x - new_col_x)
```

保证 visual position 不跳。

而 cc-niri 当前：

```text
scrollOffsetX
```

是整个 Strip 的绝对 logical offset。

投影：

```text
safeRect.x + logicalX - scrollOffsetX
```

和 focused column 无关。

因此：

> **cc-niri 不应该照抄 niri 的 active-column offset compensation。**

否则反而会重复补偿。

本项目应借鉴的是：

```text
共享 ViewOffset 状态机
current / target
Spring
统一投影
```

不是逐行复制 niri 的坐标定义。

---

# 23. H/L 新执行顺序

以：

```text
A | B
Meta+L
→
B | C
```

为例。

新流程：

```text
1. focus target = C

2. JS 计算
   oldScrollOffsetX
   newScrollOffsetX

3. LayoutEngine 生成 SCROLL plan

4. 在真实 geometry commit 前
   PublishMotionPlan(SCROLL)

5. Native Effect：
   - 解析 plan
   - 找到 EffectWindow
   - 确认 epoch
   - 如果已有 ViewportMotion：
       from = current()
     否则：
       from = oldScrollOffsetX
   - target = newScrollOffsetX
   - initialVelocity = 0
   - 创建 Spring

6. JS commit 最终真实 geometry

7. Incoming Window 提前变为可绘制状态

8. Outgoing Window 暂缓最终 hidden/minimized

9. Native paintWindow：
   visualX =
     safeRect.x + logicalX - animatedOffset

   translationX =
     visualX - frameGeometry.x

10. Viewport clip 同时应用

11. Spring 完成

12. Native 通知：
    SCROLL COMPLETE epoch=N

13. JS finalizer：
    - 真正 park outgoing
    - 清理 pending ownership
    - 清除 motion metadata
```

---

# 24. 必须改变 Parking 的提交时机

这是本功能最关键的工程点之一。

当前：

```text
GeometryCommitter.commit()
```

遇到：

```text
placement == parked
```

会立刻：

```text
commit parking geometry
set visibility false
opacity = 0
minimized = true
```

如果在 Spring 开始前 outgoing 已被：

```text
minimized
```

Native Effect 就无法像 niri 那样持续把它画到 viewport 边缘。

因此普通 SCROLL 时：

## Outgoing

不能立即最终 hide。

改为：

```text
pendingPark
```

---

# 25. Pending Park 状态

建议在 WindowState 增加：

```text
scrollPendingParkEpoch
```

例如：

```js
windowState.scrollPendingParkEpoch = plan.epoch;
```

含义：

```text
逻辑上它已经是 parked
但视觉生命周期暂未完成
```

在 spring 完成之前：

```text
window 仍可 paint
```

完成以后：

```text
ParkingManager.setVisibility(false)
```

---

# 26. Incoming 的处理

Incoming：

```text
oldPlacement = parked
newPlacement = visible
```

必须在动画第一帧之前：

```text
真实 geometry -> 最终 target slot
取消 CC-owned minimized
恢复正常 opacity
```

但因为 Native Effect 会根据：

```text
logicalX - animatedOffset
```

把它画到 viewport 外，

所以用户不会看到它瞬间出现在 target slot。

同时现有：

```text
native viewport clip
```

负责禁止它泄漏到右侧副屏。

---

# 27. Outgoing 的真实 geometry 策略

第一版推荐：

## 动画期间保持 old real geometry

不要立刻移动到 parking rect。

理由：

- 最稳定；
- input / KWin surface 状态简单；
- Native translation 只需小范围补偿；
- spring 结束再一次性 parking。

流程：

```text
outgoing:
old visible real geometry
        ↓
native visual follows ViewOffset
        ↓
完全离开 viewport
        ↓
spring complete
        ↓
commit parking rect
        ↓
opacity 0 / minimized
```

这样最接近 niri：

```text
Column 在 render world 中离开视口，
而不是先被传送到 parking world 再视觉补偿。
```

---

# 28. GeometryCommitter 新规则

普通 SCROLL 时：

```text
continuing:
commit target geometry

incoming:
commit target geometry
unhide before motion

outgoing:
DEFER parking geometry
DEFER hide/minimize

static parked:
保持原逻辑
```

建议：

```js
commitScrollMotionPlan(plan)
```

和普通：

```js
commit(plan)
```

不要继续在一个超长 if/else 中堆特殊判断。

---

# 29. 推荐新增 ScrollCommitCoordinator

文件：

```text
src/kwin/layout/ScrollCommitCoordinator.js
```

职责仅限：

```text
准备 Native motion
↓
执行 SCROLL 特殊 commit order
↓
登记 pending park
↓
完成时 finalize
```

接口建议：

```js
class ScrollCommitCoordinator {
    prepare(plan);
    commit(plan);
    finalize(epoch);
    cancel(epoch, reason);
}
```

不要让：

```text
GeometryCommitter
```

知道 Spring 数学。

---

# 30. Native Effect 内部结构

建议：

```cpp
class ViewportMotion
{
public:
    void start(double from, double to, qint64 epoch);
    void retarget(double to, qint64 epoch);

    double current(TimePoint now) const;
    double target() const;

    bool isActive(TimePoint now) const;
    bool isDone(TimePoint now) const;

    void snap(double x);
};
```

以及：

```cpp
struct ScrollEntry
{
    EffectWindow *window;
    QString windowId;

    qint64 columnId;

    double logicalX;
    double pixelWidth;

    QString oldPlacement;
    QString newPlacement;
};
```

Effect：

```cpp
class CcNiriViewportClipEffect : public Effect
{
    ViewportMotion m_viewportMotion;
    std::vector<ScrollEntry> m_scrollEntries;

    RectF m_scrollViewport;
    qint64 m_scrollEpoch = -1;
};
```

---

# 31. Retarget 行为必须匹配 niri

用户快速：

```text
L
L
L
```

旧：

```text
from = oldOffset
to   = firstTarget
```

第二次 L 到来时：

```text
from =
currentSpringPosition(now)

to =
secondTarget

initialVelocity =
0
```

第三次同理。

禁止：

```text
等上一段结束再执行
```

禁止：

```text
从上一段 target 开始
```

必须：

```text
from = CURRENT
```

---

# 32. 快速反向 H/L

例如：

```text
L
60 ms
H
```

H 到来：

```text
from =
当前 Spring position

to =
新的左侧 target

v0 =
0
```

会得到当前 niri 类似的：

```text
位置连续
但重新以新 Spring 接管
```

第一版不追求速度一阶连续。

验收重点是：

```text
无 snap
无旧 transaction completion 覆盖新 transaction
```

---

# 33. Epoch 规则

每一次逻辑 H/L：

```text
epoch++
```

Native 只接受：

```text
epoch > currentEpoch
```

相同 epoch：

```text
允许重复 plan 幂等
```

旧 epoch：

```text
直接丢弃
```

完成事件：

```text
SCROLL_COMPLETE(epoch)
```

JS 只 finalize：

```text
当前仍登记为 pending 的同一 epoch
```

旧动画完成不能 park 新事务正在使用的窗口。

---

# 34. Native 每帧 repaint

只要：

```text
m_viewportMotion.active
```

Effect 必须持续申请下一帧 repaint。

不能依赖：

```text
点击
截图
其它窗口 damage
```

才能继续刷新。

建议在 Effect 的 per-frame hook 中：

```text
if motion active:
    effects->addRepaintFull()
```

第一版可以先 full repaint 保证正确。

后续再优化：

```text
只 repaint primary viewport
```

不要第一版同时优化 damage。

---

# 35. paintWindow 逻辑

伪代码：

```cpp
void paintWindow(..., EffectWindow *window, ..., WindowPaintData &data)
{
    auto *entry = findScrollEntry(window);

    if (!entry || !m_viewportMotion.isActive(now)) {
        paintWithExistingClip(...);
        return;
    }

    const double animatedOffset = m_viewportMotion.current(now);

    const double visualX =
        m_scrollViewport.x()
        + entry->logicalX
        - animatedOffset;

    const double realX =
        window->frameGeometry().x();

    const double tx =
        visualX - realX;

    data.translate(tx, 0);

    Region clipped = deviceRegion;
    clipped &= mapViewportToDevice(...);

    effects->paintWindow(
        renderTarget,
        viewport,
        window,
        mask,
        clipped,
        data
    );
}
```

---

# 36. Clip 与 Motion 必须在同一个坐标真值下

当前 native clip 已经使用：

```cpp
viewport.mapToDeviceCoordinates(logicalClip)
```

这个方向继续保留。

新 Scroll Motion 的 viewport 必须继续使用：

```text
logical safeRect
```

不要：

```text
手动 * 1.5
```

不要：

```text
根据 DP-1 写死
```

不要：

```text
根据 HDMI-A-1 origin 做补偿
```

---

# 37. 混合 DPI

niri 的思路是：

- logical geometry 可保留 fractional；
- view offset 本身可以是 fractional；
- render 阶段再谨慎对齐 physical pixel；
- 不通过提前把整个 layout 量化成整数解决。

cc-niri 第一版也应：

```text
animatedScrollOffsetX 使用 double
```

不要每帧：

```text
round(animatedScrollOffsetX)
```

否则会产生：

```text
1 logical px 级阶梯滚动
```

---

# 38. Pixel Alignment 策略

第一版：

```text
Spring state：
double logical coordinate

translation：
qreal / double

clip：
RenderViewport logical -> device
```

如果实测 150% scale 下出现：

```text
边缘轻微发虚
1 physical px 抖动
```

再增加一个独立实验：

```text
renderPositionDevice =
round(renderPositionLogical * outputScale)

renderPositionLogicalAligned =
renderPositionDevice / outputScale
```

但不要把这一逻辑放进 Spring state。

Spring state 永远保持：

```text
连续 double
```

对齐只发生在：

```text
最终 paint projection
```

---

# 39. Focus 时机

和 niri 一样：

```text
逻辑 active column
```

应在命令执行时立即改变，

不等待动画结束。

即：

```text
Meta+L
↓
focus state = next column
↓
target view offset 改变
↓
视觉继续滚动
```

不能：

```text
滚完以后才 focus
```

否则：

- 键盘输入会落在旧窗口；
- 连续 H/L 的目标计算不自然；
- 快速操作会排队。

---

# 40. 输入命中与真实 geometry

这是 KWin plugin 与 niri compositor 最大的结构差异。

niri 自己就是 compositor：

```text
render geometry
input geometry
layout geometry
```

可以统一控制。

cc-niri 是 KWin 上层，因此：

```text
视觉位置
```

与：

```text
真实 frameGeometry
```

可能暂时不同。

第一版必须遵循：

```text
键盘焦点立即正确
鼠标点击动画中的窗口不作为强保证
```

如果要求动画中精确 pointer hit-test 映射，就需要更深 KWin integration。

本次不要扩大范围。

但是必须保证：

```text
动画结束后 real geometry 完全正确。
```

---

# 41. 用户点击动画中窗口

第一版建议行为：

如果 Native Scroll active：

```text
pointer focus change
```

触发：

```text
snap/cancel current ViewportMotion
↓
使用当前 target layout
↓
执行现有 pointer activation path
```

不要试图第一版实现：

```text
对 paint-transformed window 做 pointer coordinate inverse mapping
```

这属于以后更底层的 compositor integration。

---

# 42. Window close / new window during motion

## Close

如果参与 SCROLL 的窗口关闭：

```text
Native 删除该 ScrollEntry
```

JS：

```text
重新 relayout
```

新的 epoch 覆盖旧 motion。

## New Window

普通新窗口 adoption：

```text
不要强行加入正在执行的旧 epoch
```

它按现有 adoption 流程进入布局，

产生新的 layout 后：

```text
如果 scroll target 改变
→ 新 epoch
```

否则等当前滚动完成。

---

# 43. Output / Scale 变化

如果 motion active 时：

```text
output geometry changed
scale changed
primary output changed
```

第一版：

```text
立即 snap 到 target
清除 native scroll state
执行完整 relayout
```

不要尝试跨 output configuration change 保留 Spring。

稳定性优先。

---

# 44. Wide / Presentation 冲突

如果：

```text
SCROLL active
```

期间进入：

```text
PAIR_TO_WIDE
WIDE_TO_PAIR
MAXIMIZE
FLOATING
FULLSCREEN
```

规则：

```text
先结束/取消 SCROLL viewport motion
```

推荐：

```text
snap animatedOffset -> current targetScrollOffsetX
finalize pending park
清理 SCROLL entries
然后执行原 Wide/Presentation transition
```

第一版禁止：

```text
Viewport Spring
+
Wide Scale
```

同时修改同一窗口的 X。

---

# 45. Scripted MotionController 的修改

文件：

```text
src/effect/MotionController.js
effect/contents/code/main.js
```

普通 scroll 识别到：

```text
MotionType.SCROLL
```

时：

```text
return / ignore
```

条件必须是：

```text
native scroll motion capability available
```

如果 native capability 不可用：

```text
继续现有旧动画 path
```

这样保留 fallback。

---

# 46. 新 Capability Role

当前：

```text
1002
```

表示：

```text
native viewport clip available
```

建议新增：

```text
1005 = NativeScrollMotionCapabilityRole
```

含义：

```text
当前 native plugin
支持：
- SCROLL plan
- ViewOffset Spring
- viewport clip
- completion
```

JS 只有检测到：

```text
role 1005 == true
```

才禁用旧 SCROLL AnimationEffect。

---

# 47. Fallback 必须保留

Native motion 不可用时：

```text
保持现状：
MotionController
+
OutCubic
+
现有 viewport clip / safe fallback
```

不能因为 native plugin 没加载导致：

```text
H/L 没动画
```

更不能导致：

```text
窗口 parking 错乱
```

---

# 48. Bridge 修改

## ScrollDockBridge.h

`PublishMotionPlan` 不新增 API 名称。

只扩展 schema。

## ScrollDockBridge.cpp

当前：

```text
type 只允许：
WIDE_TO_PAIR
PAIR_TO_WIDE

entries.size() == 2
```

改为：

```text
Wide：
entries.size() == 2

SCROLL：
entries.size() >= 1
且包含：
logicalX
pixelWidth
oldPlacement
newPlacement
```

SCROLL 还必须验证：

```text
oldScrollOffsetX
newScrollOffsetX
viewport
```

---

# 49. Motion completion

Native SCROLL 完成后需要通知 JS：

```text
ReportScrollMotionComplete
```

这里有两个选择。

## 推荐

扩展现有：

```text
ReportMotionComplete
```

支持：

```text
type = SCROLL
```

由 Bridge 生成：

```text
finalize-scroll-motion
```

command。

这样继续复用当前 Wide completion 机制。

---

# 50. 新 command

Bridge 生成：

```json
{
  "protocol": 1,
  "commandId": "...",
  "sessionId": "...",
  "baseGeneration": 123,
  "type": "finalize-scroll-motion",
  "epoch": 108,
  "motionCompleted": true
}
```

DockGateway handlers 增加：

```text
finalize-scroll-motion
```

它调用：

```js
scrollCommitCoordinator.finalize(epoch)
```

---

# 51. Cancel completion

如果 SCROLL 被：

- 新 SCROLL 覆盖；
- Wide 打断；
- output change；
- emergency restore；

旧 epoch：

```text
不发送 finalize
```

或者发送：

```text
cancelled = true
```

但 JS 不能把 cancelled 当 completed。

最简单：

```text
旧 epoch 静默失效
```

由新 epoch 的 finalize 处理最新 pending 状态。

---

# 52. 滚动时参与窗口集合

第一版只针对普通相邻 H/L。

参与窗口可取：

```text
oldPlacement == visible
OR
newPlacement == visible
```

即：

```text
continuing
incoming
outgoing
```

不要把所有 parked Column 都交给 Native。

这样：

```text
通常 2~3 个 EffectWindow
```

足够。

---

# 53. 为什么这就是 niri 的视觉关键

对于参与窗口，Native 每一帧只使用：

```text
logicalX
animatedScrollOffsetX
```

因此：

```text
B - A 的视觉距离
=
logicalX_B - logicalX_A
```

始终固定。

不会出现：

```text
B 已经减速
C 还在跑
```

也不会出现：

```text
incoming 220 ms
continuing 110 ms
```

因为根本没有：

```text
per-window horizontal progress
```

---

# 54. 普通 SCROLL 禁止 Scale / Opacity

Native SCROLL：

```text
Translation only
```

保持：

```text
opacity = 1
scale = 1
```

不使用：

```text
subtleIncomingScale
subtleIncomingOpacity
```

这些可以继续留给：

```text
CLOSE_REFILL
Wide
其它 presentation motion
```

---

# 55. Dock Long Jump

本次不改 Dock planner。

如果 Dock 点击：

```text
2 → 7
```

仍保持现有：

```text
2|3
→
3|4
→
4|5
→
5|6
→
6|7
```

但每一步普通 Scroll 都走：

```text
Native ViewOffset Spring retarget
```

因为后一个 step 到达时：

```text
from = current()
to = next target
```

所以视觉上会比现在更接近：

```text
一段连续 strip 滚动
```

后续可以再移除固定 140 ms step cadence。

不是本次范围。

---

# 56. 第一版禁止加入 velocity inheritance

即使 Native Spring 已经可以很容易保存：

```text
velocity
```

第一版仍固定：

```text
initialVelocity = 0
```

原因：

1. 和当前 niri 主线一致；
2. 更容易对比手感；
3. 减少反向时 overshoot / oscillation 风险；
4. 先验证共享 ViewOffset 是否已经解决主要质感问题。

后续实验可以增加配置：

```text
PreserveVelocity = false/true
```

默认 false。

---

# 57. 配置项

第一版可以不暴露 UI。

Native 内置：

```text
dampingRatio = 1.0
stiffness = 800
epsilon = 0.0001
```

等功能稳定后再增加 KCM / config：

```text
ScrollSpringDampingRatio
ScrollSpringStiffness
ScrollSpringEpsilon
```

不要第一版把调参数和架构修改混在一起。

---

# 58. Debug Log

Native：

```text
[VIEW_OFFSET] PLAN
[VIEW_OFFSET] RETARGET
[VIEW_OFFSET] FRAME
[VIEW_OFFSET] COMPLETE
[VIEW_OFFSET] CANCEL
```

示例：

```text
[VIEW_OFFSET] PLAN epoch=108 from=0 target=1260 entries=3
[VIEW_OFFSET] RETARGET epoch=109 current=412.6 target=2520 v0=0
[VIEW_OFFSET] COMPLETE epoch=109 target=2520
```

FRAME 日志：

```text
默认关闭
```

否则高刷新率会刷爆 journal。

---

# 59. JS Log

```text
[SCROLL_COMMIT] PREPARE
[SCROLL_COMMIT] INCOMING_VISIBLE
[SCROLL_COMMIT] DEFER_PARK
[SCROLL_COMMIT] FINALIZE
[SCROLL_COMMIT] CANCEL
```

例如：

```text
[SCROLL_COMMIT] PREPARE epoch=108 old=0 new=1260
[SCROLL_COMMIT] DEFER_PARK epoch=108 column=1
[SCROLL_COMMIT] INCOMING_VISIBLE epoch=108 column=3
[SCROLL_COMMIT] FINALIZE epoch=108 parked=1
```

---

# 60. Phase 0：冻结 Baseline

先：

```bash
git switch -c feature/native-view-offset-scroll
```

记录：

- 当前 main SHA；
- 当前所有 test；
- 原 H/L 视频；
- `journalctl` 当前滚动日志；
- 主屏 / 副屏 geometry、scale；
- native viewport clip capability 正常。

禁止直接在：

```text
main
```

上做大改。

---

# 61. Phase 1：只实现纯 Spring 单元

新增：

```text
native/viewport-clip/Spring.*
native/viewport-clip/ViewportMotion.*
```

暂时不接 KWin Window。

测试：

```text
0 → 1260
1260 → 0
current 400 → 2520
current 800 → 0
```

要求：

```text
无 NaN
临界阻尼不明显 overshoot
最终收敛
60/120/144 Hz sample 结果只由 elapsed time 决定
```

---

# 62. Phase 2：Bridge 支持 SCROLL Plan

修改：

```text
DockGateway
ScrollDockBridge
LayoutEngine
```

Native 只打印 plan：

```text
暂时不移动窗口
```

验收：

```text
每次 H/L：
epoch 正确
old/new offset 正确
entries 正确
logicalX 正确
```

---

# 63. Phase 3：Native ViewOffset 驱动 continuing

先只让：

```text
oldPlacement=visible
newPlacement=visible
```

的 continuing 窗口跟随 ViewOffset。

Incoming/outgoing 暂时使用旧视觉。

目的：

```text
验证 shared ViewOffset 数学
验证 Spring
验证 retarget
```

验收：

```text
连续 L/L/L
continuing window 不 snap
```

---

# 64. Phase 4：Incoming Native Projection

加入：

```text
parked → visible
```

顺序：

```text
unhide
commit target geometry
native projection
viewport clip
```

关闭 Scripted Effect 对 SCROLL incoming 的：

```text
scale / opacity / translation
```

验收：

```text
Incoming 真正从 strip 右侧连续进入
副屏零泄漏
```

---

# 65. Phase 5：Outgoing Deferred Park

加入：

```text
visible → pendingPark
```

Native 继续画 outgoing。

Spring complete：

```text
finalize-scroll-motion
↓
commit parking rect
↓
hide/minimize
```

验收：

```text
A | B → B | C

A 连续滑出 viewport，
而不是提前消失。
```

---

# 66. Phase 6：关闭旧 SCROLL MotionController

只有：

```text
NativeScrollMotionCapabilityRole == true
```

时，

普通 SCROLL 完全不再调用：

```text
animate(Effect.Translation)
```

此时旧路径仅 fallback。

---

# 67. Phase 7：连续 Retarget

测试：

```text
L
40ms
L
40ms
L
```

要求：

```text
第二次：
from = 第一段 current

第三次：
from = 第二段 current
```

没有：

```text
queue
snap
wait completion
```

---

# 68. Phase 8：反向

测试：

```text
L
60ms
H
```

要求：

```text
位置连续
target 正确
旧 epoch 不 finalize
```

当前 niri baseline：

```text
new v0 = 0
```

照此实现。

---

# 69. Phase 9：Mixed DPI / 双屏

必须测试：

```text
DP-1 150%
HDMI-A-1 100%
```

至少：

```text
L × 20
H × 20
L/L/H/L 快速输入
```

检查：

- 副屏无 primary window pixel；
- clip 不偏；
- 没有 1~2 px 泄漏；
- primary 右边缘进入正常；
- 无突然模糊/抖动。

---

# 70. Unit Test 清单

新增：

```text
test/view-offset-model.test.js
```

JS 纯逻辑测试：

### Test A

```text
Projection:
safe.x + logicalX - animatedOffset
```

### Test B

```text
participant =
old visible || new visible
```

### Test C

```text
outgoing 被标记 pendingPark
```

### Test D

```text
旧 epoch finalize 被拒绝
```

### Test E

```text
SCROLL Native capability unavailable
→ old path
```

---

# 71. Native Test 清单

如果当前项目没有 native test harness，可先写独立 C++ test 或纯 math executable。

必须验证：

```text
Spring:
critical damping
finish
retarget
reverse
epsilon
max duration
```

尤其：

```text
from == to
```

不能出现：

```text
NaN
```

---

# 72. Integration Test

## 场景 1

```text
1 | 2
L
→
2 | 3
```

必须看到：

```text
1、2、3
属于同一个空间运动
```

## 场景 2

```text
2 | 3
H
→
1 | 2
```

完全对称。

## 场景 3

```text
L L L L
```

没有：

```text
四次明显启动/停止边界
```

虽然每次会 retarget Spring，
视觉上仍应表现为同一个 ViewOffset。

## 场景 4

```text
L L H
```

没有 snap。

## 场景 5

第一列 / 最后一列：

```text
H/L no-op
```

不能启动空 Spring。

---

# 73. Wide 回归

以下必须全部保持：

```text
Pair → Wide
Wide → Pair
off-screen Wide navigation
Meta+Z
Maximize in Safe Area
```

进入 Wide 前：

```text
SCROLL 必须 snap/finalize/cancel 清干净
```

不能让 native ViewOffset 还处于 active。

---

# 74. Parking 回归

必须测试：

- Emergency Restore；
- KWin Script reload；
- 登录已有窗口 adoption；
- Electron 慢 mapping；
- 关闭 focused outgoing；
- 点击 secondary output；
- managed → floating；
- floating → managed。

任何情况下：

```text
pendingPark
```

不能永久残留。

---

# 75. Crash / Fail-safe 规则

Native plugin unload：

```text
JS 检测 capability 丢失
↓
立即使用 old scroll path
```

Native motion active 时 crash / reload：

```text
真实 geometry 必须仍然可恢复
```

因此：

> **Native ViewOffset 只能决定 visual motion，不能成为布局 correctness 唯一来源。**

---

# 76. Emergency Restore 必须清理

Emergency Restore 增加：

```text
clear pending scroll epoch
finalize/cancel pendingPark
restore opacity
restore minimized ownership
clear native motion plan
```

目标：

```text
无论动画执行到哪里，
Emergency Restore 一次就能把桌面恢复可用。
```

---

# 77. 不要做的事情

禁止：

```text
把 H/L 的 OutCubic 从 220 改成 180
然后宣称完成 niri-style。
```

禁止：

```text
给每个 Window 单独做 Spring。
```

那只是：

```text
per-window spring
```

仍然不是共享 ViewOffset。

禁止：

```text
每个窗口自己保存 progress。
```

普通 SCROLL 应只有：

```text
一个 progress / 一个 offset。
```

禁止：

```text
用 Timer 每 16 ms 从 JS 改 frameGeometry。
```

禁止：

```text
在 JS 做逐帧 Spring。
```

禁止：

```text
真实 geometry 穿过副屏。
```

禁止：

```text
动画过程中修改 output ownership。
```

---

# 78. 第一版完成标准

只有同时满足以下条件，才算完成：

```text
1. H/L 普通 Scroll 不再依赖 per-window Translation animation。

2. Native 只有一个 animatedScrollOffsetX。

3. 所有参与 Column 的 visual position 都由：
   safeX + logicalX - animatedScrollOffsetX
   推导。

4. Spring 参数默认：
   dampingRatio=1
   stiffness=800
   epsilon=0.0001。

5. Retarget：
   from=current()
   to=new target
   initialVelocity=0。

6. 快速 L/L/L 无 snap。

7. 快速 L/H 无 snap。

8. Incoming 从逻辑 Strip 进入，不使用 scale/fade。

9. Outgoing 连续滑出后才 park。

10. 相邻副屏无像素泄漏。

11. 150% + 100% mixed DPI 正常。

12. Wide / Floating / Fullscreen / Emergency Restore 无回归。

13. Native plugin 不可用时旧动画 fallback 正常。
```

---

# 79. 第二阶段可选增强：Velocity Continuity

第一版稳定后，才能实验：

```text
currentVelocity()
```

retarget：

```text
from = current()
to = new target
v0 = currentVelocity()
```

这会比当前 niri 主线更进一步。

但必须作为：

```text
独立 feature flag
```

进行 A/B。

因为：

- 快速反向时可能产生更强惯性；
- 参数需要重新调；
- 不能把“速度连续”与“共享 ViewOffset”混成一个改动。

---

# 80. 第二阶段可选增强：真实 Gesture

未来如果增加触摸板横向连续滚动，

可以把：

```text
ViewportMotion
```

升级为和 niri 类似：

```text
Static
Animation
Gesture
```

Gesture 直接更新：

```text
current
```

手指抬起：

```text
Gesture
→
Spring target
```

这也是本次设计坚持 ViewOffset state machine，而不是写死 H/L 动画的重要原因。

---

# 81. 推荐最终代码布局

```text
src/
├── kwin/
│   ├── layout/
│   │   ├── LayoutEngine.js
│   │   ├── GeometryCommitter.js
│   │   └── ScrollCommitCoordinator.js   # 新增
│   │
│   ├── integration/
│   │   └── DockGateway.js
│   │
│   └── ...
│
├── effect/
│   ├── MotionController.js              # 保留，SCROLL native 时 bypass
│   ├── MotionTokens.js
│   └── ...
│
native/
└── viewport-clip/
    ├── ViewportClipEffect.cpp
    ├── ViewportClipEffect.h
    ├── ViewportMotion.cpp               # 新增
    ├── ViewportMotion.h                 # 新增
    ├── Spring.cpp                       # 新增
    ├── Spring.h                         # 新增
    ├── CMakeLists.txt
    └── main.cpp

bridge/
└── src/
    ├── ScrollDockBridge.cpp
    └── ScrollDockBridge.h

test/
├── view-offset-model.test.js            # 新增
├── layout-plan.test.js
├── native-viewport-clip.test.js
└── ...
```

---

# 82. 推荐 Codex 实施顺序

必须按以下顺序提交，禁止一个 commit 全改完。

## Commit 1

```text
feat(native): add niri-style spring math and viewport motion state
```

只增加纯 Native 数学。

## Commit 2

```text
feat(protocol): publish SCROLL motion plans with logical column positions
```

只打通 plan，不改变视觉。

## Commit 3

```text
feat(native): render continuing columns from shared viewport offset
```

只处理 continuing。

## Commit 4

```text
feat(scroll): route incoming columns through native viewport motion
```

加入 incoming。

## Commit 5

```text
feat(scroll): defer outgoing parking until viewport motion completes
```

加入 outgoing pending park。

## Commit 6

```text
refactor(effect): bypass scripted per-window motion for native SCROLL
```

关闭旧普通 SCROLL 动画。

## Commit 7

```text
test(scroll): cover retarget reverse mixed-dpi and fallback invariants
```

补完整 regression。

---

# 83. Codex 约束

实现过程中必须遵守：

```text
不要把新代码继续堆入 generated main.js。
```

源码只改：

```text
src/*
native/*
bridge/*
```

然后：

```bash
node tools/build.js
```

生成：

```text
package/contents/code/main.js
effect/contents/code/main.js
```

---

# 84. 不允许 Codex 顺手重构的模块

本任务不得顺便：

- 改 WindowPolicy；
- 改 Dock UI；
- 改 Focus Ring；
- 改 Reorder；
- 改 Workspace；
- 改 Floating 规则；
- 改 Wide preference；
- 改窗口宽度逻辑；
- 大规模 rename；
- 删旧 fallback。

目标就是：

```text
H/L viewport motion
```

范围必须严格。

---

# 85. 与旧实现文档的关系

仓库现有：

```text
cc-niri_niri风格连续滚动动画与双屏Viewport_Clipping实现设计.md
```

其中很多基础工作已经完成：

- native viewport clip；
- mixed-DPI RenderViewport 映射；
- MotionTransaction；
- minimize grab；
- full-delta 验证。

因此新文档不是重做这些。

旧文档中以下思路现在应被替换：

```text
“第一版先 OutCubic”
“Spring 最后再做”
“每个窗口 full-delta Translation”
```

新的主架构改为：

```text
共享 ViewOffset
+
Native Spring
+
每帧由 logicalX 投影
```

---

# 86. 最终架构图

```text
                    Meta+H / Meta+L
                           │
                           ▼
                   Focus / Layout Logic
                           │
               targetScrollOffsetX
                           │
                           ▼
                    Scroll Motion Plan
                           │
                           ▼
                    Existing D-Bus Bridge
                           │
                           ▼
              ┌─────────────────────────┐
              │ Native Viewport Motion  │
              │                         │
              │ currentOffsetX          │
              │ targetOffsetX           │
              │ Spring                  │
              │ epoch                   │
              └───────────┬─────────────┘
                          │
                   one value / frame
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
       Column A         Column B         Column C
     logicalX=0      logicalX=1260    logicalX=2520
          │               │               │
          └───────────────┼───────────────┘
                          ▼
       visualX = safeX + logicalX - currentOffsetX
                          │
                          ▼
                 WindowPaintData.translate
                          │
                          ▼
               Native Viewport Clipping
                          │
                          ▼
                     KWin Scene
```

---

# 87. 核心设计原则总结

这次不要再把问题理解成：

```text
“怎么让 Window A/B/C 的动画更平滑”
```

正确问题是：

```text
“怎么让整个横向空间只有一个运动状态”
```

niri 的手感核心不是 Rust，也不是某个神奇 easing。

真正值得复制的是：

```text
1. Column 保持逻辑位置。

2. Viewport 拥有 current / target。

3. H/L 只改变 target。

4. 所有 Column 由同一个 current ViewOffset 投影。

5. ViewOffset 使用临界阻尼 Spring。

6. 新输入从 current position retarget。

7. 动画和最终 layout state 分离。
```

cc-niri 现有：

```text
logicalX
scrollOffsetX
LayoutEngine
native viewport clip
Bridge
```

已经提供了实现这一模型需要的大部分基础。

因此本次不是“底层重写”，而是：

> **把已经存在的绝对 scrollOffset 进一步升级为 niri 式的 `target offset + native animated current offset`。**

完成后，普通 H/L 才真正从：

```text
多个窗口动画
```

升级为：

```text
一个滚动空间在移动。
```
