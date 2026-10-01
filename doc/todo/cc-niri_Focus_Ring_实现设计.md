# cc-niri Focus Ring 实现设计

> **实施状态（2026-10-01）：** 用户指定的下一阶段目标 `focus_ring`，尚未实现。新的主屏原生 Focus Ring；逻辑层确定当前受管窗口归属，native 渲染层随实际视觉变换绘制。独立于历史 Phase 9.5 已撤除的 Focus Ring。
> 文档基线需与已完成 W0–W9 的当前 main 核对；原设计正文保留。阅读入口见 [文档索引](../README.md)。

> 目标：为 cc-niri 实现类似 niri 的“当前窗口光圈 / Focus Ring”，用于在无常驻 Dock 的工作流中明确当前输入焦点。  
> 设计原则：**逻辑层只决定谁拥有光圈，渲染层决定光圈这一帧画在哪里。**  
> 适用项目：`Cc-aw/cc-niri`  
> 参考实现：`niri-wm/niri` Focus Ring、KWin AnimationEffect、cc-niri 当前 MotionController / native viewport-clip 架构。

---

## 1. 背景

cc-niri 当前已经具备：

- 横向 scrolling column 布局；
- `Meta+H / L` 焦点移动；
- 动画与 retarget；
- Presentation / Wide / Maximize；
- native `viewport-clip` KWin Effect；
- `MotionController` / `MotionSampler`；
- `workspace.windowActivated` 生命周期；
- 多屏与 parking 机制。

随着 Dock 的重要性降低，用户需要一个始终可靠的视觉反馈：

```text
当前输入焦点在哪里？
```

Focus Ring 的职责就是：

```text
当前 active managed window
→ 绘制一个 2px 左右的外部光圈
```

它不是窗口装饰系统，也不是布局边框。

---

# 2. 目标

第一阶段目标：

```text
active
AND
cc-niri managed
AND
main screen
AND
visible
AND
!native fullscreen
→ 显示 Focus Ring
```

Focus Ring 必须：

- 不改变 `frameGeometry`；
- 不改变 Column 宽度；
- 不参与 layout；
- 不拦截输入；
- 不创建 Wayland overlay window；
- 不通过 QML 单独追踪窗口；
- 不每帧通过 DBus / JS 更新位置；
- 与 scrolling animation 完全同步；
- 与 scale animation 完全同步；
- 支持快速连续 `Meta+H/L` retarget；
- native fullscreen 时立即隐藏；
- 不破坏现有 viewport clipping；
- 不影响 parking ownership；
- 不引入 polling。

---

# 3. 非目标

V1 不实现：

- glow；
- blur；
- 呼吸动画；
- 彩虹渐变；
- 多层 shadow；
- inactive ring；
- urgent ring；
- dialog ring；
- 副屏 ring；
- floating ring；
- 普通 Wayland overlay；
- scene 全屏重绘式方案。

第一阶段只做：

```text
2px solid active ring
```

先保证：

```text
稳定
同步
轻量
正确
```

之后再升级视觉。

---

# 4. niri 的核心设计

参考：

```text
niri:
src/layout/focus_ring.rs
src/layout/tile.rs
src/layout/scrolling.rs
src/layout/floating.rs
```

niri 的 Focus Ring 核心不是“一个悬浮窗口”。

它是 Tile 渲染体系的一部分：

```text
Tile
├── Window
├── Border
├── FocusRing
└── Shadow
```

## 4.1 Active ownership

在 scrolling layout 中：

```text
active tile
→ focus_ring = true
```

其他 tile：

```text
focus_ring = false
```

Floating layout 同样只给 active tile 绘制。

因此 Focus Ring 的 ownership 本质上属于：

```text
focus state
```

而不是：

```text
window decoration state
```

---

## 4.2 Focus Ring 使用 Visual Geometry

niri 的 ring 不是读取静态 logical geometry 后独立追踪。

它与 Tile 使用同一套：

```text
tile position
+
render offset
+
animated tile size
```

所以：

```text
Window ─┐
        ├─ shared visual transform
Ring ───┘
```

这样可以自然支持：

- scrolling；
- resize；
- workspace movement；
- fullscreen transition；
- scale；
- retarget。

cc-niri 应复制这一思想，而不是复制 Rust 代码。

---

# 5. cc-niri 当前可复用基础

当前项目已有：

```text
src/effect/MotionController.js
src/effect/MotionSampler.js

native/viewport-clip/
├── ViewportClipEffect.cpp
└── ViewportClipEffect.h
```

`MotionController` 当前已经维护：

```text
translation
scale
opacity
duration
curve
retarget
```

`MotionSampler.visualRectFor()` 已能在 JS 侧得到 visual rect。

但是 Focus Ring **不应该每帧调用这个结果传入 native**。

原因：

- 会产生两套 animation clock；
- JS 与 compositor 存在 timing 偏差；
- retarget 边界容易出现 1 frame 错位；
- 每帧 `setData()` 没必要；
- 未来 motion channel 增多后维护复杂。

---

# 6. 核心架构

最终结构：

```text
                         CC-NIRI
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
      Logical World                       Visual World
          │                                   │
   ColumnStore                             KWin Effect
   LayoutEngine                               │
   ViewportState                              │
   Presentation                               │
          │                                   │
          ├── MotionController ───────────────┤
          │               WindowPaintData     │
          │                                   │
          └── FocusRingController             │
                    │                         │
                    │ ownership               │
                    ▼                         ▼
                role 1005              FocusRingEffect
                                              │
                                      visual transform
                                              │
                                              ▼
                                       GPU Focus Ring
```

原则：

```text
JS:
谁有 Focus Ring？

Native:
这一帧 Ring 应该画在哪里？
```

二者职责不能混合。

---

# 7. 建议新增模块

## 7.1 JavaScript

新增：

```text
src/kwin/visual/
└── FocusRingController.js
```

职责：

```text
active window ownership
eligibility
setData / clearData
```

不负责：

```text
geometry
animation
scale
translation
OpenGL
```

---

## 7.2 Native Effect

新增：

```text
native/focus-ring/
├── FocusRingEffect.cpp
├── FocusRingEffect.h
├── CMakeLists.txt
└── metadata.json
```

职责：

```text
读取 FocusRingDataRole
读取 WindowPaintData
计算当前 visual rect
绘制 ring
damage / repaint
fullscreen suppression
```

---

# 8. Data Role

现有：

```text
1001 ViewportClipDataRole
1002 CapabilityDataRole
1003 MotionPlanDataRole
1004 MotionCompleteDataRole
```

新增：

```text
1005 FocusRingDataRole
```

定义：

```cpp
static constexpr int FocusRingDataRole = 1005;
```

JS：

```js
const CC_NIRI_FOCUS_RING_ROLE = 1005;
```

V1 marker 可以非常简单：

```js
window.setData(CC_NIRI_FOCUS_RING_ROLE, true);
```

清除：

```js
window.setData(CC_NIRI_FOCUS_RING_ROLE, null);
```

不要传：

```text
x
y
width
height
translation
scale
progress
```

这些都由 native compositor 自己得到。

---

# 9. FocusRingController

建议：

```js
class FocusRingController {
    constructor(options) {
        this.current = null;
        this.isEligible = options.isEligible;
        this.role = options.role;
    }

    mark(window, enabled) {
        if (!window || typeof window.setData !== "function") return;

        window.setData(
            this.role,
            enabled ? true : null
        );
    }

    activate(window) {
        if (this.current === window) {
            if (window && !this.isEligible(window)) {
                this.mark(window, false);
                this.current = null;
            }
            return;
        }

        if (this.current) {
            this.mark(this.current, false);
        }

        this.current = null;

        if (!window || !this.isEligible(window)) {
            return;
        }

        this.mark(window, true);
        this.current = window;
    }

    refresh() {
        const window = this.current;

        if (!window) return;

        if (!this.isEligible(window)) {
            this.mark(window, false);
            this.current = null;
        }
    }

    clear() {
        if (this.current) {
            this.mark(this.current, false);
        }

        this.current = null;
    }
}
```

---

# 10. Eligibility

V1 推荐：

```js
function isFocusRingEligible(window) {
    if (!window) return false;

    if (!window.normalWindow) return false;

    if (window.fullScreen) return false;

    if (!isMainScreenWindow(window)) return false;

    const column = columnForWindow(window);
    if (!column) return false;

    const state = stateFor(window);

    if (state.floating) return false;

    if (isWindowHidden(window)) return false;

    return true;
}
```

最终语义：

```text
Dialog               ×
KRunner               ×
Desktop               ×
Panel                 ×
Parked                ×
副屏                   ×
native fullscreen     ×
floating              ×   V1

主屏 managed active   ✓
```

---

# 11. Active Window Hook

当前：

```text
RuntimeLifecycle.js
→ workspace.windowActivated
→ onWindowActivatedForScrollLayout()
```

现有 `onWindowActivatedForScrollLayout()` 存在：

```js
if (layoutTransaction.isActive()) {
    return;
}
```

因此：

**Focus Ring ownership 不能放在这个函数的 suppress 之后。**

推荐：

```text
workspace.windowActivated
          │
          ├── FocusRingController.activate(window)
          │
          └── onWindowActivatedForScrollLayout(window)
                        │
                        └── layout transaction 可 suppress
```

原因：

```text
focus feedback
```

必须忠实反映 KWin 当前实际 active window。

而：

```text
layout transition
```

可以因为 transaction 而暂时 suppress。

二者不是同一状态机。

---

# 12. RuntimeLifecycle 修改

建议不要把 Focus Ring 逻辑硬塞进现有 layout controller。

新增统一 handler：

```js
function onWindowActivated(window) {
    focusRingController.activate(window);
    onWindowActivatedForScrollLayout(window);
}
```

Runtime：

```js
new RuntimeLifecycle({
    ...
    onWindowActivated,
    ...
});
```

避免：

```text
FocusRing
→ 依赖 scrolling transaction 是否允许处理 activation
```

---

# 13. Native FocusRingEffect

核心类：

```cpp
class CcNiriFocusRingEffect : public Effect
{
    Q_OBJECT

public:
    CcNiriFocusRingEffect();
    ~CcNiriFocusRingEffect() override;

    bool isActive() const override;
    bool blocksDirectScanout() const override;
    int requestedEffectChainPosition() const override;

    bool paintWindow(
        const RenderTarget &renderTarget,
        const RenderViewport &viewport,
        EffectWindow *window,
        int mask,
        const Region &deviceRegion,
        WindowPaintData &data
    ) override;

private:
    bool shouldDraw(EffectWindow *window) const;

    RectF visualRect(
        EffectWindow *window,
        const WindowPaintData &data
    ) const;

    void drawRing(
        const RenderTarget &renderTarget,
        const RenderViewport &viewport,
        const RectF &rect
    );

private:
    static constexpr int FocusRingDataRole = 1005;

    QSet<EffectWindow *> m_markedWindows;
};
```

---

# 14. 为什么必须读取 WindowPaintData

KWin `AnimationEffect` 在动画时会直接修改：

```text
WindowPaintData
```

Translation：

```cpp
data += QPointF(tx, ty);
```

Scale：

```cpp
data.translate(anchorCompensation);
data.setXScale(...);
data.setYScale(...);
```

因此 native FocusRingEffect 看到的：

```text
WindowPaintData
```

已经包含：

```text
当前 compositor frame 的真实 visual transform
```

所以 Focus Ring 不需要：

```text
重新实现 MotionSampler
重新计算 easing
自己同步 animation timer
自己处理 retarget
```

---

# 15. Visual Rect

V1 当前 cc-niri motion channel：

```text
Translation
Scale
Opacity
```

因此：

```cpp
RectF CcNiriFocusRingEffect::visualRect(
    EffectWindow *window,
    const WindowPaintData &data
) const
{
    const RectF frame = window->frameGeometry();

    return RectF(
        frame.x() + data.xTranslation(),
        frame.y() + data.yTranslation(),
        frame.width() * data.xScale(),
        frame.height() * data.yScale()
    );
}
```

注意：

KWin Scale animation 的：

```text
center
left
right
top
bottom
```

anchor compensation 已经写入 `WindowPaintData.translation`。

所以 native 不要再次做 anchor 修正。

否则会：

```text
double compensation
```

---

# 16. 重要约束：不要只使用 frameGeometry

错误：

```cpp
RectF rect = window->frameGeometry();
```

例如 Meta+L：

```text
logical geometry
已经移动到目标 slot

visual window
仍处于动画中间位置
```

结果：

```text
Ring 先跳到目标位置
Window 再滑过去
```

这是不可接受的。

正确：

```text
frameGeometry
+
current WindowPaintData transform
```

---

# 17. Effect Chain

当前：

```cpp
CcNiriViewportClipEffect::requestedEffectChainPosition()
{
    return 95;
}
```

Focus Ring 推荐：

```cpp
int CcNiriFocusRingEffect::requestedEffectChainPosition() const
{
    return 96;
}
```

逻辑：

```text
Scripted AnimationEffect
        ↓
translation / scale
        ↓
ViewportClipEffect      95
        ↓
FocusRingEffect         96
        ↓
Scene renderer
```

目标：

FocusRingEffect 获取：

```text
已经经过 Motion Animation 的 WindowPaintData
```

---

# 18. Ring 绘制顺序

推荐：

```cpp
bool CcNiriFocusRingEffect::paintWindow(...)
{
    if (shouldDraw(window)) {
        const RectF rect = visualRect(window, data);
        drawRing(renderTarget, viewport, rect);
    }

    return effects->paintWindow(
        renderTarget,
        viewport,
        window,
        mask,
        deviceRegion,
        data
    );
}
```

也就是：

```text
Ring
↓
Window
```

这样内部 edge 会被窗口覆盖：

```text
     Focus Ring
   ╔══════════════╗
   ║ ┌──────────┐ ║
   ║ │  Window  │ ║
   ║ └──────────┘ ║
   ╚══════════════╝
```

不要：

```text
Window
↓
Ring
```

否则 ring 可能压住窗口内容。

---

# 19. V1 Ring Geometry

推荐：

```text
width = 2 logical px
```

Ring rect：

```text
window visual rect
expanded by 2px
```

例如：

```cpp
constexpr qreal RingWidth = 2.0;

RectF outer(
    rect.x() - RingWidth,
    rect.y() - RingWidth,
    rect.width() + RingWidth * 2,
    rect.height() + RingWidth * 2
);
```

然后画：

```text
top
bottom
left
right
```

四个 filled rectangle。

---

# 20. 不建议 GL_LINE_LOOP

虽然 KWin 某些 Effect 使用：

```text
GL_LINE_LOOP
```

但 Focus Ring 推荐四个 solid quad。

原因：

- HiDPI 更稳定；
- fractional scale 更稳定；
- line width 驱动差异更少；
- damage rect 更简单；
- 后续 corner / gradient 更容易升级；
- 2 logical px → device pixel 映射可控。

---

# 21. HiDPI

当前工作环境可能包含：

```text
4K @ 150%
2K @ 100%
```

因此 Ring width 必须定义为：

```text
logical px
```

绘制前：

```text
logical geometry
→ RenderViewport
→ physical coordinates
```

例如：

```text
2 logical px × 1.5 scale
→ 3 physical px
```

不要硬编码：

```text
2 physical px
```

否则双屏粗细会不同。

---

# 22. V1 Color

建议：

```text
width   = 2 logical px
color   = #7FC8FF
alpha   = 1.0
radius  = 0
gradient = off
glow     = off
```

目的：

```text
明显
干净
不抢内容
```

颜色后续可以配置。

---

# 23. Fullscreen

Native：

```cpp
bool CcNiriFocusRingEffect::shouldDraw(
    EffectWindow *window
) const
{
    if (!window) return false;

    if (window->isFullScreen()) {
        return false;
    }

    return window->data(FocusRingDataRole).toBool();
}
```

必须做到：

```text
native fullscreen
→ Focus Ring hidden
```

---

# 24. Direct Scanout

建议：

```cpp
bool CcNiriFocusRingEffect::isActive() const
{
    for (EffectWindow *window : m_markedWindows) {
        if (window && !window->isFullScreen()) {
            return true;
        }
    }

    return false;
}
```

```cpp
bool CcNiriFocusRingEffect::blocksDirectScanout() const
{
    return isActive();
}
```

重点：

```text
Fullscreen 时 Effect 应完全不 active
```

不要为了隐藏的 Ring 永久阻止 direct scanout。

---

# 25. Marked Window 生命周期

构造：

```cpp
for (EffectWindow *window : effects->stackingOrder()) {
    updateWindowMarker(window);
}
```

监听：

```text
windowAdded
windowClosed
windowDataChanged
```

Data Role：

```text
1005
```

当：

```text
role=true
```

加入：

```text
m_markedWindows
```

否则移除。

---

# 26. Repaint

Focus ownership 变化时：

```cpp
effects->addRepaint(oldRingRect);
effects->addRepaint(newRingRect);
```

V1 如果实现复杂度较高，可以暂时：

```cpp
effects->addRepaintFull();
```

仅作为 POC。

但 production 应改成：

```text
localized damage
```

因为 Focus Ring 本身面积很小。

---

# 27. 动画期间 Repaint

窗口 scrolling animation 本身会触发 KWin animation repaint。

因此不要新增：

```text
永久 timer
每帧 addRepaintFull
```

Focus Ring 应依附现有 window animation damage。

如果测试发现 ring 外扩的 2px 没被 animation damage 完整覆盖：

```text
window animation layer repaint
+
ring expanded damage
```

只扩展局部 damage。

不要全屏持续刷新。

---

# 28. Viewport Clipping

当前 cc-niri 有：

```text
native/viewport-clip
```

Focus Ring 必须遵守：

```text
visible viewport
```

尤其是：

```text
PAIR_TO_WIDE
WIDE_TO_PAIR
scroll transition
```

V1 推荐：

```text
先验证普通 scrolling
再验证 viewport transition
```

必要时：

```text
ringDeviceRegion
&=
current viewport clip
```

不要让 ring 出现在被 viewport clip 隐藏的区域。

---

# 29. Parking

Parked window：

```text
FocusRingDataRole
必须被清除
```

并且 Native 仍应有防御：

```text
如果 window 不可见
→ 不绘制
```

Focus Ring 不得改变：

```text
parking rect
parking ownership
parking state
```

---

# 30. Presentation

支持：

```text
NORMAL
WIDE
MAXIMIZED
```

Focus Ring 不需要知道 presentation mode。

原因：

```text
presentation
→ 改 geometry / motion transform
→ KWin WindowPaintData
→ Focus Ring 自动跟随
```

这正是本架构的优势。

因此：

```text
FocusRingEffect
```

不要读取：

```text
PresentationController
ViewportState
scrollOffsetX
column width mode
```

---

# 31. MotionController 不需要改算法

保留：

```text
src/effect/MotionController.js
src/effect/MotionSampler.js
```

它们继续负责：

```text
animation
retarget
motion state
visual prediction
testing
incoming snapshot
```

Focus Ring 只消费 compositor 最终结果。

不要：

```text
MotionController
→ 每帧 publish ring geometry
```

---

# 32. 多工作区兼容

未来 cc-niri 上下 Workspace 加入后：

```text
Focus Ring ownership
仍然只绑定当前 active window
```

Workspace transition 时 native 仍读取：

```text
WindowPaintData
```

因此理论上可以自然跟随 Y translation。

以后无需再重构 Focus Ring。

---

# 33. Floating 扩展

V1：

```text
floating = no ring
```

后续如要支持 floating：

只需要修改：

```text
FocusRingController eligibility
```

Native renderer 无需修改。

这说明：

```text
ownership policy
```

与：

```text
render implementation
```

已经成功解耦。

---

# 34. Dialog

V1：

```text
dialog = no ring
```

未来可选择：

```text
focused dialog
→ ring dialog
```

同样只需修改 ownership。

---

# 35. 配置

V1 可以暂时 hardcode。

Production 推荐：

```text
FocusRingConfig
├── enabled
├── width
├── color
└── opacity
```

不要第一阶段加入：

```text
gradient
glow
animation
corner radius
```

---

# 36. 文件结构建议

最终：

```text
cc-niri/
├── src/
│   ├── effect/
│   │   ├── MotionController.js
│   │   └── MotionSampler.js
│   │
│   └── kwin/
│       ├── layout/
│       ├── navigation/
│       ├── presentation/
│       ├── runtime/
│       └── visual/
│           └── FocusRingController.js
│
├── native/
│   ├── viewport-clip/
│   └── focus-ring/
│       ├── FocusRingEffect.cpp
│       ├── FocusRingEffect.h
│       ├── CMakeLists.txt
│       └── metadata.json
│
└── test/
    ├── focus-ring-controller.test.js
    └── ...
```

不要：

```text
FocusRing
→ 再塞回 main.js
```

generated bundle 可以生成进：

```text
package/contents/code/main.js
effect/contents/code/main.js
```

但源代码必须模块化。

---

# 37. 开发阶段

## Phase 1 — Static Native POC

只实现：

```text
一个普通 active main-screen managed window
→ 2px ring
```

要求：

- 静态窗口；
- 不改 geometry；
- 不挡 input；
- fullscreen 隐藏；
- 无 crash；
- 无持续 repaint；
- 无 journal spam。

暂时不处理：

```text
scroll transform
```

---

## Phase 2 — Ownership

新增：

```text
FocusRingController.js
```

连接：

```text
workspace.windowActivated
```

验证：

```text
Firefox active
→ Firefox ring

Terminal active
→ Firefox ring clear
→ Terminal ring
```

重点：

```text
layoutTransaction.isActive()
```

不得阻止 Ring ownership 更新。

---

## Phase 3 — Visual Transform

Native：

```text
frameGeometry
+
WindowPaintData translation
+
WindowPaintData scale
```

验证：

```text
Meta+L
Meta+H
```

Ring 必须与窗口一起移动。

不允许：

```text
ring 提前跳目标位
ring 延后一帧
ring 单独 easing
```

---

## Phase 4 — Retarget

测试：

```text
L
L
H
L
H
H
```

快速连续输入。

要求：

```text
Ring
永远附着当前 compositor visual window
```

不能：

```text
闪烁
跳动
丢失
残留
```

---

## Phase 5 — Presentation

测试：

```text
NORMAL → WIDE
WIDE → NORMAL
NORMAL → MAX
MAX → NORMAL
```

Ring：

```text
自动跟随 geometry / animation
```

FocusRingEffect 不允许添加 Presentation 特殊 case。

---

## Phase 6 — HiDPI / Multi-output

测试：

```text
4K @ 150%
2K @ 100%
```

检查：

```text
Ring 逻辑宽度一致
physical pixel 对齐
无模糊边
无半像素抖动
```

V1 仅主屏显示 ring。

---

# 38. 测试矩阵

| 场景 | 期望 |
|---|---|
| 静态 active managed window | Ring 显示 |
| inactive managed window | 无 Ring |
| Meta+H | Ring 与窗口同步 |
| Meta+L | Ring 与窗口同步 |
| 连续 H/L | 无跳变 |
| retarget | 无延迟 |
| NORMAL → WIDE | 同步 |
| WIDE → NORMAL | 同步 |
| NORMAL → MAX | 同步 |
| native fullscreen | Ring 隐藏 |
| fullscreen exit | Ring 恢复 |
| dialog active | V1 无 Ring |
| floating active | V1 无 Ring |
| parked window | 无 Ring |
| 副屏 window | V1 无 Ring |
| 150% scale | 宽度正确 |
| 100% scale | 宽度正确 |
| viewport clipping | 不越界 |
| window close | 无残留 |
| KWin reload | 无 crash |

---

# 39. Regression

必须跑现有：

```text
layout
motion
parking
presentation
floating
viewport clip
runtime lifecycle
stability
```

相关测试。

重点检查：

```text
Parking ownership
Motion transaction
PAIR_TO_WIDE
WIDE_TO_PAIR
Dock synchronization
Presentation state
Fullscreen
Multi-output
```

Focus Ring 不允许影响这些逻辑。

---

# 40. 性能要求

Focus Ring Effect：

```text
无 polling
无常驻 timer
无每帧 DBus
无每帧 JS geometry publish
无 full-screen offscreen composition
无 overlay surface
```

正常静态桌面：

```text
只有 focus change 时触发 ring damage
```

动画时：

```text
复用窗口已有 animation repaint
```

---

# 41. Fail-safe

如果 FocusRing native Effect 未加载：

```text
cc-niri layout 仍正常工作
```

如果 FocusRing Role 不存在：

```text
只是没有 Ring
```

不得：

```text
阻塞 scrolling
阻塞 activation
阻塞 presentation
```

Focus Ring 必须是：

```text
pure visual enhancement
```

---

# 42. 日志

建议仅保留状态变化日志：

```text
[FOCUS_RING] READY
[FOCUS_RING] ARM <uuid>
[FOCUS_RING] CLEAR <uuid>
```

不要每帧打印：

```text
visualRect
translation
scale
paintWindow
```

否则 journal 会严重污染。

Debug build 可以提供可选 verbose。

---

# 43. 推荐实现顺序

严格按照：

```text
1. native FocusRingEffect skeleton
2. static 2px ring POC
3. fullscreen suppression
4. JS FocusRingController
5. activation ownership
6. WindowPaintData translation
7. WindowPaintData scale
8. retarget testing
9. Presentation testing
10. viewport clip testing
11. HiDPI testing
12. localized damage
13. regression
```

不要一开始同时实现：

```text
round corner
gradient
glow
config UI
floating support
dialog support
```

---

# 44. Definition of Done

- [ ] 只有 active main-screen managed window 有 Ring。
- [ ] Ring 不改变 `frameGeometry`。
- [ ] Ring 不改变 Column layout。
- [ ] Ring 不拦截 input。
- [ ] Ring 无 overlay window。
- [ ] Ring 无 polling。
- [ ] Ring 无每帧 DBus。
- [ ] Ring 使用 native KWin Effect。
- [ ] Ring 直接消费 `WindowPaintData`。
- [ ] Meta+H/L 时 Ring 与窗口同步。
- [ ] retarget 时 Ring 不跳变。
- [ ] scale animation 时 Ring 尺寸同步。
- [ ] NORMAL/WIDE/MAX 均正确。
- [ ] native fullscreen 隐藏。
- [ ] fullscreen exit 正确恢复。
- [ ] 150% / 100% 双屏宽度正确。
- [ ] Parking ownership 无回归。
- [ ] viewport clipping 无回归。
- [ ] KWin 无 crash。
- [ ] journal 无持续错误。
- [ ] static 状态无持续全屏 repaint。
- [ ] Focus Ring native Effect 失败时 cc-niri 主功能仍可用。

---

# 45. Codex 实现要求

实现时必须遵守：

```text
不要把新功能继续堆到 main.js。
```

源码：

```text
src/kwin/visual/FocusRingController.js
native/focus-ring/*
```

然后再通过当前生成机制进入 bundle。

不要：

```text
复制 MotionController
复制 ColumnStore
复制 LayoutEngine
复制 Presentation 状态
```

Focus Ring 的 JS 逻辑只能负责：

```text
ownership
```

Native 逻辑只能负责：

```text
render
```

---

# 46. 最终交互模型

当 cc-niri 不再依赖常驻 Dock 后：

```text
Meta+H / L
→ 左右切换窗口

Meta+J / K
→ 上下切换 Workspace

Launcher
→ 启动应用

Focus Ring
→ 当前输入焦点反馈
```

视觉：

```text
┌────────────────────────────────────────────┐
│                                            │
│       ╔══════════════════════╗             │
│       ║ ┌──────────────────┐ ║             │
│       ║ │                  │ ║             │
│       ║ │  Active Window   │ ║             │
│       ║ │                  │ ║             │
│       ║ └──────────────────┘ ║             │
│       ╚══════════════════════╝             │
│                                            │
└────────────────────────────────────────────┘
```

Focus Ring 的最终定位：

> **不是装饰，而是 cc-niri 无 Dock 工作流里的核心焦点反馈机制。**

---

# 47. 核心原则总结

整个实现只需要记住三句话：

```text
Layout 决定谁 active。
KWin 决定窗口这一帧在哪里。
Focus Ring 跟 KWin 的最终 visual transform 走。
```

不要建立第二套 visual state。

不要让 JS 每帧追踪窗口。

不要让 Focus Ring 进入 layout state machine。

这样实现后，它才能像 niri 一样自然地成为窗口本身视觉系统的一部分。
