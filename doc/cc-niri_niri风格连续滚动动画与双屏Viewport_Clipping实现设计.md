# CC Niri：Niri 风格连续滚动动画与双屏 Viewport Clipping 实现设计

> 项目：`Cc-aw/cc-niri`  
> 目标：将当前“窗口从 Dock / 边缘弹入”的滚动动画，升级为类似 niri 的**连续横向空间滚动**。  
> 重点解决：主屏右侧存在副屏时，Incoming Window 的完整横向动画不能泄漏到副屏。  
> 当前环境重点：KWin / Plasma 6.7.x、Wayland、主副屏混合缩放（例如主屏 150%、副屏 100%）。  
> 原则：**真实布局立即正确，动画只负责 paint；动画不能成为 correctness 的依赖。**

---

# 1. 当前问题

当前 CC Niri 已经具备：

- 滚动 Column 模型；
- 单一 geometry writer；
- off-screen parking；
- minimized parking ownership；
- H/L navigation；
- Dock stepwise scrolling；
- MotionController；
- animation retarget；
- Focus Wide；
- 双屏 output ownership 保护。

但普通滚动动画仍然不像 niri。

当前主要表现：

```text
Meta+L
   ↓
旧窗口移动
   ↓
新窗口不是从右侧连续滚入
   ↓
而是从 Dock / 下方弹出
```

或者表现为：

```text
右侧只出现很短的 20 px motion
+
scale / fade
```

而不是：

```text
整个横向 Window Strip
连续向左移动一列
```

---

# 2. 根因一：Parking 使用了真正的 minimized

当前：

```js
function setColumnVisualVisibility(column, visible) {
    ...
    if (visible) {
        ...
        if (windowState.scrollParkingMinimized && window.minimized) {
            window.minimized = false;
        }
        ...
    }

    ...

    if (!window.minimized) {
        window.minimized = true;
        windowState.scrollParkingMinimized = true;
    }
}
```

因此当前离屏 Column 是：

```text
parking geometry
+
opacity = 0
+
minimized = true
```

当窗口重新进入 viewport：

```text
minimized = false
```

KWin 会认为：

> 用户正在恢复一个最小化窗口。

Plasma Task Manager 已经向 KWin 提供该窗口的：

```text
iconGeometry
```

KWin 的 Squash / Magic Lamp 类 minimize effect 会使用：

```text
Dock icon geometry
    ↓
Size
Translation
Opacity
    ↓
Window geometry
```

因此视觉结果就是：

```text
Dock
  ↓
窗口“飞出来”
```

这不是 CC Niri 自己的 Motion 在正确执行，而是：

```text
CC Niri Scroll Effect
+
KDE Unminimize Effect
```

同时作用于同一个 Window。

---

# 3. 根因二：当前主动放弃了 Full-Delta Incoming

当前 effect 中：

```js
const SAFE_RIGHT_EDGE_SLIDE_X = 20;
```

对于：

```text
parked → right slot
```

当前不是：

```text
Translation 1260 → 0
```

而是类似：

```text
Translation 20 → 0
Scale       0.94 → 1
Opacity     0.2  → 1
```

这是一个兼容 workaround。

原因是：

```text
Primary Monitor | Secondary Monitor
```

主屏右边直接就是副屏。

如果 Incoming Window 画面完整从：

```text
+1260 px
```

开始绘制，那么画面会出现在物理副屏区域。

当前代码为了避免：

```text
窗口从副屏滑进主屏
```

只允许它在主屏右边缘很小范围内出现。

结果虽然避免了副屏污染，但也失去了 niri 最重要的视觉特征：

> **窗口 Strip 的空间连续性。**

---

# 4. niri 风格动画真正需要解决的问题

真正要实现的不是：

```text
调 easing
调 duration
调 opacity
```

而是建立：

```text
Logical Strip Space
          ≠
Physical Output Space
```

概念：

```text
Logical Strip

... | A | B | C | D | E | ...

          ┌──────────────┐
          │   Viewport   │
          └──────────────┘
```

用户看到的是 Viewport。

超出当前 monitor viewport 的部分：

```text
不绘制
```

而不是：

```text
流入相邻物理 monitor
```

---

# 5. 最终架构

目标架构：

```text
Keyboard / Dock
      │
      ▼
ScrollTransaction
      │
      ├───────────────┐
      ▼               ▼
Layout State       Motion Intent
      │               │
      ▼               ▼
Real Geometry     Paint Translation
      │               │
      └──────┬────────┘
             ▼
       KWin Compositor
             │
             ▼
      Viewport Clipping
             │
             ▼
      Primary Monitor
```

核心原则：

```text
真实 Window geometry
负责 correctness

Paint Translation
负责连续视觉

Viewport Clip
负责双屏隔离
```

---

# 6. 两套坐标必须彻底分离

## 6.1 Real Geometry Space

由 KWin Script 控制。

例如最终布局：

```text
Primary safeRect:
x = 24
width = 2512

Column width:
1252

Gap:
8
```

最终：

```text
Column B:
x = 24

Column C:
x = 1284
```

这些是真实 geometry。

它们始终属于：

```text
DP-1
```

不会为了动画把真实 geometry 移到 HDMI-A-1。

---

## 6.2 Visual / Paint Space

动画开始时：

```text
B:
visual translation = +1260

C:
visual translation = +1260
```

视觉上：

```text
B painted at 1284
C painted at 2544
```

随后：

```text
+1260
   ↓
0
```

于是整个 strip 看起来向左移动。

但是：

```text
C 的真实 geometry
仍然是 x = 1284
```

只是 paint transform 暂时把它画到右边。

---

# 7. 第一个必须完成的修复：接管 Minimize / Unminimize Effect

在做 viewport clipping 前，先解决：

```text
Dock restore animation
```

否则后面的滚动 animation 会继续和 KDE minimize effect 冲突。

---

# 8. KWin Grab Roles

KWin Scripted Effect 提供：

```text
WindowMinimizedGrabRole
WindowUnminimizedGrabRole
```

接口：

```cpp
grab(window, role, force)
ungrab(window, role)
```

CC Niri Effect 应在“内部 parking transition”期间主动 grab。

概念代码：

```js
function grabParkingAnimation(window) {
    effect.grab(
        window,
        Effect.WindowMinimizedGrabRole,
        true
    );

    effect.grab(
        window,
        Effect.WindowUnminimizedGrabRole,
        true
    );
}
```

结束：

```js
function releaseParkingAnimation(window) {
    effect.ungrab(
        window,
        Effect.WindowMinimizedGrabRole
    );

    effect.ungrab(
        window,
        Effect.WindowUnminimizedGrabRole
    );
}
```

---

# 9. Grab 的使用范围

绝对不能长期 grab 所有窗口。

只对：

```text
CC Niri owned parking
```

使用。

例如：

```text
用户自己点最小化
→ KDE 原生动画

CC Niri 把 Column park
→ CC Niri 接管
```

区分必须来自：

```text
windowState.scrollParkingMinimized
```

或更明确的：

```text
ccNiriParkingOwned
```

---

# 10. 建议增加 EffectWindow 标记

Script 侧在进入 CC parking 前：

```js
window.ccNiriParkingOwned = true;
```

或者通过当前已经可传递的自定义 window state / effect-visible property 方案实现。

Effect 侧只对：

```text
CC Niri managed transition
```

grab。

离开：

```text
window.ccNiriParkingOwned = false;
```

注意：

> 不要根据“这个窗口 minimized 了”判断是否属于 CC Niri。

必须有明确 ownership。

---

# 11. Phase A：先验证 Dock 动画根因

实现前先做一次快速诊断。

暂时卸载系统 minimize effect：

```bash
qdbus6 org.kde.KWin /Effects \
  org.kde.kwin.Effects.unloadEffect squash
```

如果启用了 Magic Lamp，同样暂时卸载。

执行：

```text
L
L
H
L
```

观察：

```text
从 Dock 飞出
```

是否消失。

如果消失：

```text
根因确认
```

随后立即恢复原 Effect。

本步骤只用于验证，不是最终方案。

---

# 12. 第二个核心：ScrollTransaction

当前动画主要依赖：

```text
pendingDeltaX
```

并根据 geometryChanged 顺序猜：

```text
continuing
incoming
outgoing
```

为了实现真正 strip scrolling，需要升级成明确 transaction。

---

# 13. ScrollTransaction 数据结构

建议：

```js
{
    id: 105,
    epoch: 442,

    type: "SCROLL",

    direction: "left",
    deltaX: 1260,

    oldScrollOffsetX: 0,
    newScrollOffsetX: 1260,

    viewport: {
        x: 24,
        y: 50,
        width: 2512,
        height: 1320
    },

    continuing: [
        "uuid-B"
    ],

    incoming: [
        "uuid-C"
    ],

    outgoing: [
        "uuid-A"
    ]
}
```

---

# 14. 为什么必须加入 Transaction

当前：

```text
geometryChanged(B)
    ↓
ARM delta

geometryChanged(C)
    ↓
猜 incoming

geometryChanged(A)
    ↓
猜 outgoing
```

这种方式在：

```text
快速 L/L/H
Dock stepwise
Close refill
Wide
Reorder
```

交错时容易 race。

Transaction 后：

```text
A / B / C
明确属于 transaction 105
```

Effect 不再依赖事件顺序猜测。

---

# 15. 第一阶段 Transaction 可以不跨 D-Bus

最简单做法：

KWin Script 在 geometry commit 前给 involved window 设置临时属性：

```text
ccNiriMotionEpoch
ccNiriMotionType
ccNiriMotionDeltaX
ccNiriMotionRole
```

例如：

```text
B:
role = continuing

C:
role = incoming

A:
role = outgoing
```

Effect 收到：

```text
windowFrameGeometryChanged
```

后读取这些标记。

Animation complete 后清除。

这样比建立新的 IPC 更轻。

---

# 16. 推荐的 Motion Role

定义：

```text
CONTINUING
INCOMING
OUTGOING
STATIC
```

以后扩展：

```text
CLOSE_REFILL
REORDER
WIDE_ENTER
WIDE_EXIT
```

---

# 17. 第三个核心：真正的 Full-Delta Translation

当 Transaction 建立后，正常 Scroll 不再使用：

```text
SAFE_RIGHT_EDGE_SLIDE_X = 20
```

正常：

```text
deltaX = 1260
```

所有参与窗口共享同一个 spatial delta。

---

# 18. Meta+L 动画

例如：

```text
old viewport:
A | B

new viewport:
B | C
```

逻辑上：

```text
strip 向左移动 1260
```

视觉 animation：

```text
B continuing:
+1260 → 0

C incoming:
+1260 → 0

A outgoing:
+1260 → 0
```

重点：

> **所有 Window 使用一致的 Strip Velocity。**

不能：

```text
B 真滚动
C fade
A 突然消失
```

否则空间感会被破坏。

---

# 19. Meta+H 动画

完全对称：

```text
deltaX = -1260
```

所有参与 window：

```text
-1260 → 0
```

---

# 20. 普通 Scroll 禁止 Scale

正常 H/L：

```text
Translation:
YES

Scale:
NO

Opacity:
NO
```

即：

```text
scale = 1.0
opacity = 1.0
```

这非常重要。

普通 scrolling 的视觉语言是：

> 空间平移。

不是：

> 卡片进入。

---

# 21. 第四个核心：Viewport Clip

如果不 Clip：

```text
C visual x = 2544
```

就可能进入：

```text
HDMI-A-1
```

因此必须加入：

```text
Primary Viewport Clip
```

---

# 22. Clip 目标

假设：

```text
safeRect:

left   = 24
top    = 50
right  = 2536
bottom = 1370
```

只允许：

```text
painted pixel ∈ safeRect
```

其它：

```text
discard
```

因此：

```text
C 在 +1260 translation 起点

大部分画面在 viewport 右侧
        ↓
被 Clip
        ↓
只随着运动逐渐进入 primary viewport
```

---

# 23. 关键：不要使用普通 Window Geometry Clip 代替 Screen Viewport

KWin 有：

```text
Effect.Clip
```

但其 AnimationEffect 实现主要根据：

```text
window expandedGeometry
+
relative ratio
+
anchor
```

产生 clip rect。

我们的需求是：

```text
固定 screen-space safeRect
```

不是：

```text
裁掉 window 本身 20%
```

因此不要直接假定：

```text
Effect.Clip
```

能完美解决双屏 viewport。

它可以作为实验项，但不应作为唯一设计前提。

---

# 24. Viewport Clip 两条实现路线

## 路线 A：Scripted Effect Fragment Shader

优点：

- 不引入新的 C++ Effect；
- 可以快速 POC；
- 与当前 JS MotionController 集成简单。

KWin ScriptedEffect 支持：

```text
addFragmentShader()
setUniform()
Effect.Shader
Effect.ShaderUniform
```

Shader 文件放：

```text
effect/contents/shaders/
```

需要根据 KWin 要求提供兼容版本，例如：

```text
viewport_clip.frag
viewport_clip_core.frag
```

---

# 25. Shader POC

逻辑：

```glsl
pixelScreenPosition
        ↓
if outside primary viewport
        discard
else
        draw texture
```

概念：

```glsl
if (screenX < viewportLeft ||
    screenX >= viewportRight ||
    screenY < viewportTop ||
    screenY >= viewportBottom) {
    discard;
}
```

然后正常：

```text
texture(sampler, texcoord0)
```

---

# 26. Shader 最大风险：混合 DPI

你的环境存在：

```text
主屏 150%
副屏 100%
```

这里必须非常谨慎。

KWin 中：

```text
Logical Coordinate
```

与：

```text
Render Target Device Coordinate
```

不是同一个空间。

例如：

```text
logical x = 24
```

不能直接假定：

```text
gl_FragCoord.x = 24
```

尤其不同 output scale 时。

因此 Shader POC 必须首先验证：

```text
gl_FragCoord
```

到底是：

```text
output-local device pixel
```

还是能够稳定映射的 compositor coordinate。

---

# 27. Shader POC 验证要求

先不要做真正 discard。

先做调试 Shader：

```text
safeRect 内：
正常

safeRect 外：
明显 tint
```

例如 debug 模式：

```text
inside  → 原颜色
outside → 红色
```

实际观察：

```text
主屏 150%
副屏 100%
```

情况下边界是否准确。

必须测试：

```text
left
right
top
bottom
```

四条边。

---

# 28. 如果 Shader 在混合 DPI 下可靠

继续使用 Scripted Effect。

最终：

```text
MotionController
+
ViewportClipShader
```

即可。

---

# 29. 如果 Shader 在混合 DPI 下不可靠

不要继续堆坐标补丁。

直接停止 Shader 方案。

将：

```text
Viewport Clipping
```

独立升级为一个非常小的：

```text
C++ KWin Effect
```

注意：

> 不是重写 CC Niri。

只把：

```text
paint clipping
```

移入 C++。

---

# 30. C++ Clip Effect 的职责

只做：

```text
CC-managed Motion Transaction
        ↓
获取当前 RenderView / RenderViewport
        ↓
把 primary safeRect
映射到该 output device space
        ↓
限制 Window paint region
```

其它仍保持：

```text
KWin Script：
布局

JS Effect：
MotionController / animation

Bridge：
Dock

C++ Clip Effect：
viewport paint clipping
```

这样风险和代码量都很小。

---

# 31. 为什么 C++ Clip 是可靠 fallback

C++ Effect 可以直接接触：

```text
RenderView
RenderViewport
deviceRegion
WindowPaintData
```

KWin 内部本身就是通过：

```text
viewport.mapToDeviceCoordinatesAligned(...)
```

把 logical rect 转为 device clip。

这正是混合 DPI 环境最可靠的实现位置。

---

# 32. 推荐决策

实施时：

```text
先 Scripted Shader POC
        │
        ├── mixed DPI PASS
        │      ↓
        │   保持 JS Effect
        │
        └── mixed DPI FAIL
               ↓
          C++ Clip Effect
```

禁止为了坚持“纯 JS”去制造大量：

```text
scale compensation
output offset compensation
magic number
```

---

# 33. Incoming Window 的正确顺序

当前容易发生：

```text
unminimize
↓
KDE animation
↓
real geometry
↓
CC motion
```

新流程必须变成：

```text
1. 创建 ScrollTransaction

2. Effect 对 Incoming Window
   grab minimize/unminimize roles

3. Script commit Incoming real geometry
   到最终 primary slot

4. Incoming 保持 CC parking ownership

5. Effect 设置完整：
   Translation = deltaX

6. Viewport Clip 生效

7. Window 允许被 CC Effect paint

8. Translation:
   deltaX → 0

9. Motion complete

10. 清除 parking hidden state

11. release minimize/unminimize grab

12. 清除 transaction metadata
```

---

# 34. 关于 minimized 的处理策略

不建议第一步就删除 minimized parking。

因为当前 minimized 解决了一个非常实际的问题：

```text
opacity=0 的 offscreen window
仍可能留下 input surface
```

所以第一版保持：

```text
minimized parking
```

但 CC Effect 必须：

```text
接管它的视觉
```

---

# 35. 如果 minimized window 无法被稳定 paint

这是一个明确的 Stop Condition。

如果 KWin 6.7.5 中：

```text
grab role
+
animation
```

仍然无法让 CC Effect 对 minimized incoming window 做稳定 paint，

不要继续 hack。

Phase B 改为：

```text
parking 不再 minimized
```

但必须先提供新的 input isolation。

可能选项：

```text
窗口放在完全不可交互区域
+
KWin effect visual clone
```

或者后续：

```text
OffscreenEffect / snapshot
```

第一版不建议走这么复杂。

优先验证 KWin 现有 minimized animation infrastructure 是否已经足够。

---

# 36. MotionController 改造

当前 MotionController 很有价值，应保留：

```text
sample()
visualSnapshot()
cancel()
start()
retarget
epoch
```

新增：

```js
startTransaction(window, transaction, role)
```

而不是 Effect 自己猜。

---

# 37. MotionState 建议新增

```js
{
    epoch,
    transactionId,

    type,
    role,

    startTime,
    duration,

    translation,

    viewport,

    animationIds
}
```

---

# 38. Retarget

快速：

```text
L
L
H
L
```

必须继续：

```text
从当前 painted position
重新计算 translation
```

禁止：

```text
cancel
↓
snap to real geometry
↓
restart
```

---

# 39. 下一阶段：Duration 根据剩余距离变化

基础正确后，可以加入：

```text
remaining distance
        ↓
duration
```

建议：

```text
100% distance:
220 ms

75%:
190 ms

50%:
160 ms

25%:
120 ms

minimum:
90~110 ms
```

这样连续输入不会：

```text
每按一次都重新完整播放 220 ms
```

---

# 40. 暂时不要第一版做 Spring

第一版先：

```text
OutCubic / current smooth decel
```

原因：

当前真正影响观感的是：

```text
空间模型
+
Dock unminimize
+
viewport clipping
```

而不是 easing。

正确优先级：

```text
Viewport
>
Full-delta
>
Motion continuity
>
Duration retarget
>
Spring
```

---

# 41. Focus Wide 不走同一规则

普通 Scroll：

```text
Translation only
```

Wide：

```text
Scale
+
Translation
```

因为 Wide 是真正：

```text
50% width
→
72% width
```

它属于 size transition。

不要为了统一动画而让 H/L 也使用 scale。

---

# 42. Dock Stepwise Scroll

当前：

```text
1|2
→
2|3
→
3|4
→
4|5
```

可以暂时保留。

但每一个 step 应成为完整：

```text
ScrollTransaction
```

例如：

```text
TX 101
1|2 → 2|3

TX 102
2|3 → 3|4

TX 103
3|4 → 4|5
```

MotionController retarget 后，视觉会自然连接。

---

# 43. 后续可以去掉人工 140 ms 节拍感

当前：

```text
DOCK_SCROLL_STEP_MS = 140
```

长期可以从：

```text
timer-driven
```

变成：

```text
motion progress / completion driven
```

但是本功能第一版不要同时改。

先保持 current Dock planner。

---

# 44. 推荐文件修改

当前优先修改：

```text
package/contents/code/main.js
effect/contents/code/main.js
effect/contents/shaders/*
test/*
install.sh
```

---

# 45. Script 侧建议新增模块/函数

如果模块化重构已经开始，建议：

```text
src/kwin/motion/
├── MotionTransaction.js
└── MotionMetadata.js
```

否则第一版可以先在当前 `main.js` 中加入：

```text
createMotionTransaction()
annotateMotionWindow()
clearMotionMetadata()
```

随后再抽模块。

---

# 46. Effect 侧建议新增

```text
MotionTransactionReader
ParkingAnimationGrabber
ViewportClipController
```

最终：

```text
effect/
├── MotionController.js
├── MotionTransaction.js
├── ParkingAnimationGrabber.js
└── ViewportClip.js
```

---

# 47. Shader 文件

如果 Scripted Effect POC 成功：

```text
effect/contents/shaders/
├── viewport_clip.frag
└── viewport_clip_core.frag
```

不要把 Shader 字符串直接塞进 JS。

---

# 48. Install Compatibility

`install.sh` 当前已经处理：

```text
Geometry Change
```

冲突。

Minimize effect 策略：

## 首选

```text
不永久关闭 Squash / Magic Lamp
```

通过：

```text
WindowMinimizedGrabRole
WindowUnminimizedGrabRole
```

只接管 CC-managed transitions。

---

# 49. Fallback

如果 KWin 6.7.5 GrabRole 实测不可靠：

安装时记录：

```text
SquashWasEnabled
MagicLampWasEnabled
```

然后临时 disable。

卸载时恢复。

但必须作为：

```text
compatibility fallback
```

不能作为主架构。

---

# 50. 实施阶段

---

# Phase 0：Baseline

执行：

```text
当前 main 打 tag
所有 test PASS
记录当前动画视频
记录当前两个 monitor geometry / scale
```

测试应用：

```text
Kitty
VSCode
Zen
ChatGPT
WeChat
```

---

# Phase 1：消灭 Dock Restore Animation

只实现：

```text
ParkingAnimationGrabber
```

不改 full-delta。

目标：

```text
parked → visible
```

时：

```text
不再从 Dock 飞出
```

但允许当前 20 px workaround 暂时保留。

验收：

```text
系统手动 minimize：
仍有 KDE 原动画

CC Niri navigation：
没有 Dock restore animation
```

---

# Phase 2：明确 MotionTransaction

新增：

```text
id
epoch
deltaX
role
viewport
```

Effect 优先读 transaction。

现有：

```text
geometry heuristic
pendingDeltaX
```

作为 fallback。

验收：

```text
L
L
H
H
Dock click
Close refill
```

transaction ID 和 role 正确。

---

# Phase 3：Viewport Clip POC

先不恢复 full delta。

只做：

```text
shader debug tint
```

确认：

```text
Primary safeRect
```

四边在：

```text
150% primary
+
100% secondary
```

都完全准确。

---

# Phase 4A：Shader PASS

如果 shader 坐标正确：

```text
启用 discard
```

然后进入 Full Delta。

---

# Phase 4B：Shader FAIL

停止 shader。

建立小型：

```text
cc-niri-viewport-clip
C++ KWin Effect
```

只做 device-space paint region clip。

其它所有架构不变。

---

# Phase 5：Full-Delta Scroll

删除 normal scroll 的：

```text
SAFE_RIGHT_EDGE_SLIDE_X = 20
```

普通 Scroll：

```text
translation = full delta
scale = 1
opacity = 1
```

验收：

```text
整个 Strip 连续滚动
副屏完全不出现 window pixels
```

---

# Phase 6：Retarget Polish

加入：

```text
distance-aware duration
```

继续保持 position continuity。

---

# Phase 7：Motion Polish

最后才尝试：

```text
critically damped spring
```

或者继续优化 cubic。

---

# 51. 必须添加的测试

## Test 1：No Dock Restore

条件：

```text
C parked + minimized by CC
```

操作：

```text
L
```

要求：

```text
系统 unminimize visual 不触发
CC scroll motion 触发
```

---

## Test 2：User Minimize 保持原生

普通 Floating Window：

```text
用户点击 minimize
```

要求：

```text
KDE Squash / Magic Lamp
仍正常
```

---

## Test 3：Primary Right Edge Clip

主屏右侧紧邻副屏。

Incoming：

```text
deltaX = +1260
```

要求：

```text
副屏像素变化 = 0
```

---

## Test 4：Reverse Clip

```text
Meta+H
```

Left incoming：

```text
deltaX = -1260
```

要求：

```text
左边 viewport 外不可见
```

---

## Test 5：Mixed DPI

必须：

```text
Primary scale = 1.5
Secondary scale = 1.0
```

测试：

```text
L × 5
H × 5
```

要求：

```text
clip edge 不偏移
不漏 1~2 px
不切掉 primary 内合法内容
```

---

# 52. Test 6：Fast Retarget

执行：

```text
L
80 ms
L
60 ms
H
50 ms
L
```

要求：

```text
visual position continuous
无 snap
无副屏 flash
```

---

# 53. Test 7：Dock Long Jump

例如：

```text
2 → 7
```

要求：

```text
每一步是连续 horizontal motion
目标只最后 focus
无 Dock restore
无副屏 flash
```

---

# 54. Test 8：Close Refill

```text
A | B
关闭 A
```

要求：

```text
replacement spatially enters
不从 Dock 出来
```

---

# 55. Test 9：Wide

```text
B | C
→
C 72%
```

要求：

```text
scroll 完成
↓
Wide transition
```

不能：

```text
两个 animation 混在一起
```

---

# 56. Test 10：Floating

```text
Managed
→
Floating
→
Managed
```

要求：

```text
不触发错误 parking animation
不从 Dock 飞出
```

---

# 57. Debug Logging

新增：

```text
[MOTION_TX]
[PARK_GRAB]
[VIEWPORT_CLIP]
```

示例：

```text
[MOTION_TX] BEGIN id=105 type=SCROLL delta=1260
[MOTION_TX] ROLE uuid=B continuing
[MOTION_TX] ROLE uuid=C incoming
[MOTION_TX] ROLE uuid=A outgoing

[PARK_GRAB] grab uuid=C minimize=true unminimize=true

[VIEWPORT_CLIP] viewport=24,50 2512x1320

[MOTION_TX] COMPLETE id=105

[PARK_GRAB] release uuid=C
```

---

# 58. Stop Conditions

遇到以下情况必须停止当前方案，不继续打补丁。

## Stop A

GrabRole 无法阻止 KDE restore effect：

```text
停止
→
进入 compatibility fallback
```

---

## Stop B

Script shader 在 mixed DPI 下边界不稳定：

```text
停止
→
C++ Clip Effect
```

---

## Stop C

Full-delta translation 造成真实 Output ownership change：

这意味着：

```text
错误地修改了 real geometry
```

必须回查：

```text
Paint Translation
与
Real Geometry
```

是否混淆。

---

## Stop D

为了实现 Clip 开始加入：

```text
primaryScale * magicNumber
secondaryOrigin compensation
special case HDMI-A-1
```

立即停止。

这说明 shader coordinate model 不可靠。

改 C++ clip。

---

# 59. 禁止事项

禁止：

```text
为了滚动动画
把真实 Window geometry 移到副屏再移回来
```

禁止：

```text
靠 opacity=0 穿过副屏
```

因为 compositor 仍可能产生：

```text
input / ownership / damage
```

问题。

禁止：

```text
为了隐藏 Incoming
继续把 opacity 降到 0.2
```

作为主动画。

禁止：

```text
用固定 sleep
保证 animation 已完成
```

正确性必须来自：

```text
transaction
geometry ACK
animation state
```

---

# 60. 完成标准

该功能真正完成的标准不是：

```text
“看起来更平滑”
```

而是满足以下全部条件：

```text
1. CC-managed parked Window
   不再从 Dock restore

2. H/L 是 full-column horizontal movement

3. Incoming / Continuing / Outgoing
   拥有一致 spatial velocity

4. 普通 Scroll 不使用明显 Scale / Fade

5. 副屏完全看不到 Primary scrolling pixels

6. 150% + 100% mixed DPI 正常

7. 快速连续输入可以 retarget

8. User normal minimize behavior 不受影响

9. Wide / Floating / Fullscreen
   行为不回归

10. Emergency Restore 仍然可靠
```

---

# 61. 最终视觉目标

现在：

```text
A | B
    ↓
A/B 移动
    ↓
C 从 Dock 或边缘出现
```

最终：

```text
Logical strip:

A | B | C | D
      ↓

████████████████████████████
 Primary Monitor Viewport
████████████████████████████

t0:
A | B

t1:
 A | B | C

t2:
   B | C

t3:
B | C
```

但任何时刻：

```text
Secondary Monitor
```

都不会看到：

```text
C 的越界 pixel
```

---

# 62. 最终 Motion Language

| 操作 | 动画 |
|---|---|
| `Meta+H/L` | Full Translation |
| Dock scrolling | Continuous Translation |
| Close refill | Translation |
| Reorder | Translation |
| Wide | Translation + Scale |
| Floating attach | 可选小幅 Translation/Scale |
| 普通 Focus | 无动画 |
| User Minimize | KDE 原生 |
| CC Internal Parking | CC Effect 接管 |

---

# 63. 实现优先级

最终实施顺序固定为：

```text
P0
消灭 Dock unminimize animation

P0
建立 MotionTransaction

P0
验证 Viewport Clip

P0
实现 Full-Delta Translation

P1
Mixed-DPI robustness

P1
Retarget duration

P2
Spring / motion tuning
```

不要反过来。

---

# 64. 最终原则

要得到 niri 那种精致感，核心不是：

```text
更复杂的动画
```

而是：

```text
正确的空间模型
```

CC Niri 后续动画设计必须遵循：

```text
Logical Strip
    │
    ▼
Real Layout State
    │
    ▼
Final Real Geometry

同时：

Motion Transaction
    │
    ▼
Paint Translation
    │
    ▼
Viewport Clip
```

最终：

> **Window 在逻辑 Strip 中连续移动，但永远不会因为视觉动画污染相邻物理 Monitor。**

这是从目前的：

```text
parking + fake edge reveal
```

升级到真正：

```text
compositor-style scrolling viewport
```

的关键一步。
