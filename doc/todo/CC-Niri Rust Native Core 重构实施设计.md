# CC-Niri Rust Native Core 重构实施设计

## 1. 文档目标

本文定义 CC-Niri Native 层从当前以 C++ 为主的实现，逐步重构为：

> **Rust Native Core + Thin C++ KWin Adapter**

的目标架构。

本次重构不追求“100% Rust”或彻底消灭 C++。KWin、Qt、KDE Effect API 本身以 C++ 为主要接口，因此保留少量 C++ 代码负责与 KWin compositor、Qt QObject、EffectWindow、Scene Item、绘制生命周期等平台 API 交互。

Rust 接管与 KWin API 无直接耦合的核心逻辑，包括：

- Spring 数学
- Viewport Motion
- Scroll Runtime
- Retarget 状态
- Projection
- Native Protocol
- Epoch / Session 管理
- Focus Ring 几何与状态
- 后续 Native 状态机
- 可独立测试的纯逻辑模块

本次重构的首要原则：

> **保持当前用户行为完全不变，在已有 C++ 实现和实机验收结果作为 Golden Baseline 的基础上逐模块替换。**

不允许以重构为理由同时修改滚动语义、动画风格、Focus Ring 样式、Workspace 行为或快捷键。

---

# 2. 当前架构基线

截至当前 main，CC-Niri 已形成以下主要模块。

## 2.1 KWin JS Control Plane

```text
src/kwin/
├── integration/
├── layout/
├── lifecycle/
├── model/
├── navigation/
├── policy/
├── presentation/
├── runtime/
├── stability/
├── visual/
└── workspace/
```

主要职责：

- Column model
- Window policy
- Layout planning
- Workspace transaction
- Presentation
- Dock integration
- Persistence
- Stability Supervisor
- Recovery
- Native protocol 发布

这部分本轮原则上不迁移到 Rust。

---

## 2.2 当前 Native 层

```text
native/
├── common/
├── viewport-clip/
└── focus-ring/
```

其中当前已包含：

```text
Spring
ViewportMotion
ScrollViewportRuntime
ViewportClipEffect
FocusRingEffect
FocusRingItem
FocusRingPaintFrame
FocusRingStrokeItem
```

Native 层已经承担：

- Viewport Spring
- H/L Scroll projection
- incoming / continuing / outgoing
- retarget
- reverse retarget
- viewport clipping
- Focus Ring paint-frame 同步
- Presentation transform
- HiDPI pixel alignment

因此当前正是建立稳定 Rust Core 边界的合适阶段。

---

# 3. 为什么现在进行 Rust 重构

## 3.1 项目规模仍然可控

当前 C++ Native 模块数量有限，并且核心算法职责已经基本明确。

如果继续增加：

- Multi-window Column
- Overview
- 手势滚动
- 多屏 Native Scroll
- 更复杂的 Presentation
- compositor animation
- 更多 scene state

以后迁移成本会显著增加。

因此本次重构应发生在继续增加大型 Native 功能之前。

---

## 3.2 当前 Native 逻辑天然适合 Rust

例如当前 Scroll Runtime 已经存在：

```text
session
workspace
output
epoch

columns
sourceFrames
visualTargets
roles

motion
frameOffset
cancelledEpoch
completed
```

以及：

```text
updateContext
arm
cancel
advance
projection
```

本质上已经是一个显式状态机。

Rust 可以更自然地表达：

```rust
enum WindowRole {
    Continuing,
    Incoming,
    Outgoing,
}
```

而不是在核心逻辑内部长期使用：

```text
"continuing"
"incoming"
"outgoing"
```

同样适用于：

```text
MotionState
ProtocolState
Epoch
SessionId
WorkspaceId
OutputId
WindowId
```

---

# 4. 重构目标

最终目标架构：

```text
                     CC-Niri
                        │
          ┌─────────────┴─────────────┐
          │                           │
     KWin JS Layer              Native Layer
                                      │
                           ┌──────────┴──────────┐
                           │                     │
                    C++ KWin Adapter          Rust Core
                           │                     │
                           │                Motion
                    Effect hooks             Spring
                    EffectWindow             Scroll
                    Scene Item               Projection
                    Qt / D-Bus               Protocol
                    KPlugin                  Geometry
                    Rendering                State Machines
```

核心原则：

> C++ 负责“如何跟 KWin 对话”。

> Rust 负责“CC-Niri 应该做什么”。

---

# 5. 非目标

本次重构明确不包含：

- 将 KWin JS 层重写为 Rust
- 将 Workspace W0–W9 重写
- 修改 Pair / Wide 语义
- 修改快捷键
- 修改 Spring 参数
- 修改 Focus Ring 样式
- 实现 Multi-window Column
- 实现 Overview
- 实现 Gesture
- 实现副屏滚动 Column
- 更换 Dock / Plasmoid
- 重写 Bridge
- 为追求纯 Rust 而直接 bind 整套 KWin API

以上内容均必须独立立项。

---

# 6. 核心设计原则

## 6.1 Rust Core 禁止依赖 Qt 类型

Rust Core 内禁止出现：

```text
QString
QRect
QRectF
QPointF
QJsonObject
QObject
QHash
EffectWindow
KWin::*
```

Rust Core 使用自己的类型。

例如：

```rust
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
```

以及：

```rust
pub struct WindowId(String);

pub struct WorkspaceId(String);

pub struct OutputId(String);

pub struct Epoch(u64);
```

---

## 6.2 Qt / KWin 类型只能存在于 Adapter

例如：

```cpp
QRectF
```

必须在边界转换：

```text
QRectF
  ↓
CcNiriRectDto
  ↓
Rust Rect
```

反方向同理。

---

# 7. 建议目录结构

重构完成后的目录建议如下：

```text
native/
├── adapter/
│   ├── common/
│   │
│   ├── viewport-clip/
│   │   ├── ViewportClipEffect.cpp
│   │   ├── ViewportClipEffect.h
│   │   ├── RustScrollBridge.cpp
│   │   └── RustScrollBridge.h
│   │
│   └── focus-ring/
│       ├── FocusRingEffect.cpp
│       ├── FocusRingEffect.h
│       ├── FocusRingItem.cpp
│       ├── FocusRingItem.h
│       └── RustFocusRingBridge.cpp
│
├── rust/
│   ├── Cargo.toml
│   │
│   ├── cc-niri-core/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── geometry.rs
│   │       ├── ids.rs
│   │       └── error.rs
│   │
│   ├── cc-niri-motion/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── spring.rs
│   │       └── viewport_motion.rs
│   │
│   ├── cc-niri-scroll/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── runtime.rs
│   │       ├── projection.rs
│   │       └── role.rs
│   │
│   ├── cc-niri-focus-ring/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── geometry.rs
│   │       └── state.rs
│   │
│   └── cc-niri-ffi/
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs
│
└── CMakeLists.txt
```

第一阶段不强制立即拆多个 crate。

初期可以先：

```text
cc-niri-native-core
```

单 crate。

待边界稳定后再拆分。

---

# 8. Rust Core 基础类型

建议优先建立强类型基础设施。

## 8.1 Epoch

```rust
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
)]
pub struct Epoch(pub u64);
```

禁止核心逻辑继续大量使用裸 `qint64`。

---

## 8.2 WindowId

```rust
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct WindowId(String);
```

需要在 FFI 边界完成：

- UUID normalization
- invalid ID rejection
- zero UUID rejection

---

## 8.3 Rect

```rust
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
```

提供：

```text
intersects
translated
near
right
bottom
is_valid
```

几何误差统一定义，例如：

```rust
const GEOMETRY_EPSILON: f64 = 0.5;
```

不能在各模块散落：

```text
0.5
3
1.0
```

等 magic number。

---

# 9. Scroll Protocol 类型化

当前进入 Native 的 SCROLL JSON 应在 Rust FFI 边界立即解析成：

```rust
pub struct ScrollPlan {
    pub epoch: Epoch,

    pub old_scroll_offset_x: f64,
    pub new_scroll_offset_x: f64,

    pub viewport: Rect,

    pub entries: Vec<ScrollEntry>,
}
```

其中：

```rust
pub struct ScrollEntry {
    pub window_id: WindowId,
    pub logical_x: f64,
    pub pixel_width: f64,

    pub old_placement: Placement,
    pub new_placement: Placement,
}
```

以及：

```rust
pub enum Placement {
    Visible,
    Parked,
}
```

禁止 Rust Core 内重新解析：

```text
"visible"
"parked"
```

字符串。

---

# 10. WindowRole

直接定义：

```rust
pub enum WindowRole {
    Continuing,
    Incoming,
    Outgoing,
}
```

转换规则：

```text
Visible → Visible
    = Continuing

Parked → Visible
    = Incoming

Visible → Parked
    = Outgoing
```

不合法组合必须在 protocol validation 阶段处理。

---

# 11. Spring

现有：

```text
Spring.cpp
Spring.h
```

应作为首个迁移对象。

建议：

```rust
pub struct Spring {
    stiffness: f64,
    damping: f64,
    mass: f64,
}
```

保持当前数学公式、参数和完成条件完全一致。

第一阶段必须做到：

```text
C++ Spring output == Rust Spring output
```

在相同：

```text
start
target
velocity
timestamp
```

输入下，输出误差必须满足明确 epsilon。

---

# 12. ViewportMotion

目标：

```rust
pub struct ViewportMotion {
    spring: Spring,

    epoch: Option<Epoch>,

    start: f64,
    current: f64,
    target: f64,

    velocity: f64,

    started_at: TimePoint,
}
```

可以进一步内部显式化状态：

```rust
pub enum MotionState {
    Idle,

    Active {
        epoch: Epoch,
        target: f64,
    },

    Completed {
        epoch: Epoch,
        target: f64,
    },
}
```

但第一轮迁移不应为了“Rust 风格”主动改变现有行为。

优先保持当前 C++ semantics。

---

# 13. ScrollViewportRuntime

这是本轮重构最重要的核心模块。

目标：

```rust
pub struct ScrollViewportRuntime {
    context: Option<RuntimeContext>,

    motion: ViewportMotion,

    viewport: Rect,

    columns: HashMap<WindowId, Rect>,
    source_frames: HashMap<WindowId, Rect>,
    visual_targets: HashMap<WindowId, Rect>,
    roles: HashMap<WindowId, WindowRole>,

    frame_offset: f64,

    cancelled_epoch: Option<Epoch>,
    completed: bool,
}
```

保留现有行为：

```text
update_context()
arm()
cancel()
advance()
projection()
status()
clear()
```

---

# 14. Retarget 语义必须原样保留

当前关键行为：

> 新 motion 必须从最后实际绘制的 frame offset 接管。

禁止退化成：

```text
old logical offset
    ↓
new target
```

必须保持：

```text
last painted offset
       ↓
 new target
```

例如：

```rust
self.motion.start(
    self.frame_offset,
    target,
    epoch,
    now,
);
```

必须支持现有已验收序列：

```text
L → L
L → H
L → H → L
H → L → H → L
```

以及快速连续输入。

---

# 15. Incoming / Continuing / Outgoing

Rust Runtime 必须保持当前三类窗口共享同一：

```text
ViewportMotion
frame_offset
```

禁止恢复成：

```text
Window A 独立动画
Window B 独立动画
Window C 独立动画
```

最终模型：

```text
               Shared ViewOffset
                     │
             ViewportMotion
                     │
          ┌──────────┼──────────┐
          │          │          │
     Continuing   Incoming   Outgoing
```

这是当前滚动连续性的核心 invariant。

---

# 16. Outgoing 生命周期

必须保持当前行为：

> motion 完成后，Outgoing 仍由 Native 持有在 viewport 外，直到 JS 正式 park 并 disarm。

禁止 motion 一结束就立即：

```text
clear()
```

否则会重新引入：

- disappearance
- one-frame flash
- parking race
- geometry jump

---

# 17. Projection

建议 Rust API：

```rust
pub fn projection(
    &self,
    window_id: &WindowId,
    physical_geometry: Rect,
) -> Option<ScrollProjection>;
```

返回：

```rust
pub struct ScrollProjection {
    pub translation_x: f64,
    pub viewport: Rect,
}
```

C++ Adapter 负责：

```text
Rust ScrollProjection
        ↓
KWin paint data
        ↓
RenderViewport / transform
```

Rust 不接触 `EffectWindow`。

---

# 18. C++ ViewportClip Adapter

最终 C++ 代码应该逐步收缩成类似：

```cpp
void ViewportClipEffect::paintWindow(
    KWin::EffectWindow *window,
    int mask,
    QRegion region,
    KWin::WindowPaintData &data)
{
    const auto projection =
        rustRuntime.projection(
            windowId(window),
            toRustRect(window->frameGeometry()));

    if (projection) {
        applyProjection(data, *projection);
        applyViewportClip(*projection);
    }

    effects->paintWindow(
        window,
        mask,
        region,
        data);
}
```

C++ 不再决定：

```text
continuing
incoming
outgoing
retarget
epoch acceptance
spring position
```

---

# 19. Focus Ring 重构边界

Focus Ring 不应第一阶段完全 Rust 化。

## Rust 负责

```text
focus ring state
geometry calculations
presentation transform data
retarget-related state
clip geometry
corner math
pixel alignment math
```

---

## C++ 保留

```text
KWin::Effect
Scene Item
OutlinedBorderItem
Stroke Item
renderer
damage
paint hook
KWin focus owner observation
EffectWindow
RenderTarget
RenderViewport
```

原因：

这些模块高度依赖 KWin scene graph 和 Qt/KDE C++ API。

---

# 20. Focus Ring 单 Owner 原则

必须保留当前设计：

```text
JS:
    只发布 eligibility

Native KWin:
    决定真实 owner
```

Rust Core 不应重新建立：

```text
activeColumn
focusedColumn
layoutFocus
```

等第二套 focus authority。

Rust 只消费 Adapter 提供的：

```text
owner/window paint context
```

---

# 21. FFI 设计

推荐优先采用：

```text
cxx
```

或 C-compatible ABI。

是否采用 `CXX-Qt` 应根据实际 Qt 对象交互需求决定。

本项目 Rust Core 本身不应该依赖大量 Qt QObject，因此不能因为使用 CXX-Qt 而把整个 Rust Core 设计成 Qt 风格。

---

# 22. FFI DTO

推荐定义最小 DTO，例如：

```rust
struct FfiRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
```

以及：

```rust
struct ProjectionResult {
    active: bool,
    translation_x: f64,
    viewport: FfiRect,
}
```

复杂 JSON Protocol 初期可以继续由 Rust 使用 serde 解析。

Adapter 可以传入：

```text
UTF-8 JSON string
```

Rust：

```text
serde_json
    ↓
Validated ScrollPlan
```

这样第一阶段无需重新设计 Script → Native protocol。

---

# 23. Panic 规则

Rust 跨 FFI 边界绝对禁止 panic 泄漏。

FFI public entry 必须：

```text
Result
```

或转换成明确 error status。

所有 Rust panic 必须：

```text
abort before crossing FFI
```

或通过 `catch_unwind` 明确隔离。

不能让 Rust unwind 穿过 C++ frame。

---

# 24. Error 模型

建议：

```rust
pub enum NativeError {
    InvalidProtocol,
    InvalidEpoch,
    InvalidGeometry,
    ContextMismatch,
    UnknownWindow,
    SequenceRejected,
    InternalInvariant,
}
```

C++ 层决定：

```text
log
fallback
disable native path
```

Rust 不直接调用 KDE logging API。

---

# 25. Logging

Rust Core 推荐使用：

```text
tracing
```

但初期不要引入复杂 subscriber。

可以通过 FFI callback：

```text
Rust
 ↓
LogEvent
 ↓
C++
 ↓
qCDebug / qCWarning
```

确保现有 journal 排查方式仍然可用。

---

# 26. 构建系统

保持顶层：

```text
CMake
```

作为 KDE/KWin Native plugin 的最终构建入口。

CMake 负责调用 Cargo，例如：

```text
CMake
  │
  ├── Cargo build Rust Core
  │
  ├── generate / locate static library
  │
  └── link KWin Adapter
```

不能要求用户：

```text
先 cargo build
再 cmake
```

安装脚本仍应：

```bash
./install.sh
```

一次完成。

---

# 27. Cargo Workspace

建议：

```toml
[workspace]
resolver = "2"

members = [
    "cc-niri-core",
    "cc-niri-native",
    "cc-niri-ffi",
]
```

第一阶段允许只有：

```text
cc-niri-native
cc-niri-ffi
```

避免过早 crate 化。

---

# 28. Debug / Release

Native 开发构建：

```text
Debug CMake
    +
Cargo dev profile
```

Release：

```text
Release CMake
    +
Cargo release
```

禁止出现：

```text
CMake Release
+
Rust debug
```

导致性能和 ABI 测试失真。

---

# 29. Sanitizer 与 Rust

现有 C++ Native 检查继续保留。

Rust 增加：

```bash
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

条件允许时加入：

```text
Miri
```

用于纯 Core 模块。

但 Miri 不运行 KWin FFI。

---

# 30. Phase R0 — Rust 基础设施

目标：

> Rust 能进入当前 Native 构建体系，但不改变任何生产行为。

完成：

```text
native/rust/
Cargo workspace
FFI smoke test
CMake → Cargo
CI cargo test
cargo clippy
cargo fmt --check
```

实现一个最简单函数：

```rust
pub fn rust_core_version() -> &'static str
```

C++ test 能成功调用。

---

## R0 验收

必须通过：

```text
node tools/check.js --native
cargo test
cargo clippy
cargo fmt --check
```

以及：

```text
Viewport Clip
Focus Ring
Bridge
Plasmoid
```

现有构建全部不退化。

生产路径仍 100% 使用旧 C++。

---

# 31. Phase R1 — Spring 迁移

迁移：

```text
Spring.cpp
Spring.h
```

到：

```text
rust/.../spring.rs
```

C++ Spring 保留作为 reference implementation。

增加 differential test：

```text
C++ Spring
      │
same input
      │
Rust Spring
```

测试：

- 正向
- 反向
- zero distance
- fractional coordinate
- overshoot
- 高频 retarget
- completion
- large dt
- small dt

误差阈值必须固定。

---

## R1 生产切换

增加：

```text
CC_NIRI_USE_RUST_SPRING
```

开发 feature flag。

默认：

```text
false
```

完成测试后切：

```text
true
```

观察稳定一段后删除旧 C++。

---

# 32. Phase R2 — ViewportMotion 迁移

迁移：

```text
ViewportMotion.cpp
ViewportMotion.h
```

Rust 接管：

```text
epoch
start
target
current
velocity
finish
isDone
retarget
```

重点覆盖：

```text
L L
L H
L L H
H L H L
```

---

# 33. Phase R3 — ScrollViewportRuntime 迁移

迁移：

```text
ScrollViewportRuntime.cpp
ScrollViewportRuntime.h
```

这是最高风险阶段。

必须逐项对照现有行为：

```text
context authority
session switching
workspace switching
output switching
epoch ordering
cancelled epoch
duplicate plan
conflicting plan
incoming
continuing
outgoing
source frame
visual target
retarget
parking
completion
projection
```

---

## R3 differential harness

强烈要求保留 C++ reference runtime。

测试流程：

```text
同一个 Scroll Plan
       │
 ┌─────┴─────┐
 ▼           ▼
C++         Rust
 │           │
 ▼           ▼
state       state
projection  projection
```

逐帧比较。

至少覆盖：

```text
100+ synthetic sequences
```

建议加入固定随机种子 property/fuzz style test。

---

# 34. Phase R4 — Rust Scroll 上生产

此阶段：

```text
ViewportClipEffect
```

保持 C++。

仅将：

```text
runtime.arm()
runtime.advance()
runtime.projection()
```

转发到 Rust。

生产结构：

```text
KWin Effect
    │
    ▼
C++ Adapter
    │
    ▼
Rust Scroll Runtime
```

---

# 35. R4 实机验收

至少重新执行：

```text
慢速 H
慢速 L

L L L

L L H

H L H L

滚动中 J

滚动中 K

Pair → Wide

Wide → Pair

窗口关闭

Focus Ring 跟随

Fullscreen

mixed DPI
```

检查：

```text
无 snap
无 ghost
无 gap 变化
无 opacity residue
无 stale outgoing
无 wrong output
无 native fallback
无 INVARIANT_FAIL
无 FAIL_SAFE
```

---

# 36. Phase R5 — Focus Ring Core

迁移：

```text
Focus Ring geometry
corner math
presentation geometry
pixel alignment math
retarget supporting state
```

保留：

```text
FocusRingEffect
FocusRingItem
paint hooks
scene item
renderer
damage
```

在 C++。

---

# 37. Focus Ring 验收

重新执行现有 Phase 1–6 覆盖。

特别关注：

```text
静态 Ring
H/L 跟随
连续 retarget
反向 retarget
Pair/Wide
Presentation
HiDPI
viewport edge
corner
owner switch
workspace switch
close
fullscreen
```

---

# 38. Phase R6 — 统一 Native Protocol

当前 Rust Core 稳定后，再考虑统一：

```text
ScrollPlan
Motion Context
Focus Ring Context
Status
Epoch
Session
WindowId
WorkspaceId
OutputId
```

此阶段之前不应主动修改 JS protocol schema。

避免：

> 语言迁移 + 协议迁移同时发生。

---

# 39. Phase R7 — 删除 Legacy C++ Core

只有以下条件全部满足后才能删除旧算法：

```text
Rust 已成为生产默认
完整 native CI 通过
实机 acceptance 通过
至少经过稳定日常使用
无新增 crash
无新增 fallback
无 animation regression
```

删除：

```text
Spring.cpp
ViewportMotion.cpp
ScrollViewportRuntime.cpp
```

但保留 C++ Adapter。

---

# 40. 最终 C++ 范围

理想情况下 Native C++ 最终只包含：

```text
KPluginFactory

KWin::Effect subclasses

EffectWindow interaction

Scene Item

Renderer integration

Qt/KDE signal glue

QRectF ↔ Rust Rect

QString ↔ Rust String

D-Bus/KWin endpoint registration
```

所有 CC-Niri runtime policy 都不应继续扩散到 Adapter。

---

# 41. Strict Adapter Rule

以后 Code Review 中：

如果一个 C++ 文件出现：

```text
Spring equation
retarget decision
epoch ownership
window role state machine
scroll protocol validation
focus ring geometry policy
```

原则上视为架构回退。

应迁入 Rust Core。

---

# 42. Strict Rust Rule

反过来，如果 Rust Core 开始出现：

```text
QObject
EffectWindow
QPainter
RenderViewport
KWin namespace
KPlugin
QML
```

也视为边界破坏。

---

# 43. Feature Flag

重构期建议提供：

```text
RUST_SPRING
RUST_VIEWPORT_MOTION
RUST_SCROLL_RUNTIME
RUST_RING_CORE
```

但仅用于迁移和验证。

最终不应长期维护两套实现。

最终状态只能是：

```text
Rust Production
```

旧 C++ 实现删除。

---

# 44. 回滚策略

每个 Phase 必须是独立 commit / PR。

例如：

```text
refactor(rust): add cargo native workspace

refactor(rust): port spring core

refactor(rust): port viewport motion

refactor(rust): add scroll runtime differential tests

refactor(rust): enable rust scroll runtime

refactor(rust): port focus ring geometry
```

禁止一次提交整个 Native rewrite。

---

# 45. Git 分支建议

建议建立：

```text
refactor/rust-native-core
```

R0–R2 可以在该分支持续开发。

R3 开始建议继续拆：

```text
refactor/rust-scroll-runtime
refactor/rust-focus-ring
```

每阶段完成并稳定后再合并 main。

---

# 46. 不允许的重构方式

禁止：

```text
删掉当前 native/
然后从零重写
```

禁止：

```text
先让 Rust 版本功能跑起来
以后再补测试
```

禁止：

```text
Rust 顺便重做 Spring 参数
```

禁止：

```text
Rust 顺便重新设计 Scroll protocol
```

禁止：

```text
Rust 顺便重做 Focus Ring
```

禁止：

```text
直接 bind 整套 KWin private C++ API
```

禁止：

```text
为了 pure Rust 牺牲 KWin API 稳定性
```

---

# 47. 测试体系

最终至少形成四级门禁。

## Level 1 — Rust Unit Tests

```text
geometry
spring
motion
protocol
projection
runtime
retarget
```

---

## Level 2 — Differential Tests

```text
C++ Golden
vs
Rust
```

直到 Legacy C++ 删除。

---

## Level 3 — Native Integration Tests

继续使用当前 KWin/Qt C++ test infrastructure。

验证：

```text
FFI
adapter
render integration
focus ring
viewport clip
```

---

## Level 4 — Live Acceptance

真实：

```text
KWin Wayland
mixed DPI
真实窗口
真实输入
真实工作区
```

自动测试不能取代这一层。

---

# 48. 性能要求

Rust 重构不得让每帧发生：

```text
JSON parse
heap-heavy object recreation
unbounded allocation
global mutex contention
Qt ↔ Rust string conversion
```

尤其：

```text
paintWindow()
```

热路径必须避免重复构造复杂结构。

Scroll Plan 可以在：

```text
arm
```

时解析一次。

之后：

```text
advance
projection
```

应使用已类型化的内部状态。

---

# 49. Ownership 原则

Rust 不拥有：

```text
EffectWindow*
QObject*
Scene Item*
```

Rust 只拥有：

```text
WindowId
Rect
Motion state
protocol state
geometry state
```

因此即使 KWin Window 被销毁，Rust 不可能持有悬空 QObject 指针。

这也是本次迁移最值得利用的安全收益之一。

---

# 50. Threading

第一阶段保持：

> Rust Core 与 KWin Adapter 在 compositor 当前调用线程同步执行。

禁止因为 Rust 重构就引入：

```text
Tokio
async runtime
background thread
channel
worker pool
```

当前 Motion/Projection 不需要并发。

避免给 compositor 绘制路径增加新的并发复杂度。

---

# 51. Dependency 原则

Rust Core 初期依赖尽量保持最少。

允许：

```text
serde
serde_json
cxx
thiserror
```

可选：

```text
tracing
```

不建议一开始引入大型 async/runtime/framework。

---

# 52. MSRV

建议在项目中明确：

```text
Minimum Supported Rust Version
```

并在 CI 固定。

不要默认依赖开发机最新 nightly。

生产默认使用：

```text
stable Rust
```

除非以后存在明确需求。

---

# 53. CI 修改

当前 GitHub Actions 增加：

```text
rust-fmt
rust-clippy
rust-test
native-build
js-regression
```

最终门禁：

```text
JS tests
+
Rust tests
+
Rust lint
+
Native C++/Rust build
+
Bridge tests
+
Plasmoid build
```

---

# 54. install.sh

保持：

```bash
./install.sh
```

用户体验不变。

安装器负责检查：

```text
cargo
rustc
cmake
ninja
kwin-devel
Qt
```

开发模式缺少 Rust toolchain 时必须给出明确错误。

不能构建到一半才失败。

---

# 55. uninstall.sh

Rust 重构不得改变卸载语义。

仍然必须：

```text
restore parked windows
unload effect
remove native plugin
restore incompatible effect state
```

Rust 不直接参与系统卸载生命周期。

---

# 56. Crash Boundary

如果 Rust Core 返回：

```text
InternalInvariant
```

Adapter 不能继续使用可能损坏的 Native state。

建议：

```text
Rust error
    ↓
Native adapter logs
    ↓
disable native motion for current transaction
    ↓
existing safe fallback
```

严重情况由现有 JS：

```text
StabilitySupervisor
```

负责最终恢复。

---

# 57. 与 StabilitySupervisor 的关系

Rust Core 不复制：

```text
InvariantChecker
SELF_HEAL
FAIL_SAFE
Recovery
```

这些继续由 KWin JS Control Plane 负责。

Rust 只保证自己的内部 invariant。

形成：

```text
Rust internal correctness
        +
JS global WM correctness
```

两层防线。

---

# 58. 重构期间文档规则

每个阶段创建：

```text
test/RUST_NATIVE_R0_RESULTS.md
test/RUST_NATIVE_R1_RESULTS.md
...
```

记录：

```text
修改范围
测试结果
性能变化
实机验收
已知问题
回滚方式
```

最终完成后将本文移动：

```text
doc/todo/
    ↓
doc/done/
```

---

# 59. Definition of Done

Rust Native Core 重构完成必须满足：

- [ ] Rust Cargo workspace 已集成 CMake
- [ ] Spring 已迁 Rust
- [ ] ViewportMotion 已迁 Rust
- [ ] ScrollViewportRuntime 已迁 Rust
- [ ] C++ Viewport adapter 只保留 KWin 交互
- [ ] Focus Ring 可迁核心逻辑已迁 Rust
- [ ] Qt 类型不进入 Rust Core
- [ ] EffectWindow 指针不进入 Rust Core
- [ ] Rust panic 不跨 FFI
- [ ] Rust Core 不使用 async runtime
- [ ] JS Scroll protocol 行为不变
- [ ] H/L 行为不变
- [ ] Spring 参数不变
- [ ] Retarget 行为不变
- [ ] incoming / continuing / outgoing 行为不变
- [ ] Pair/Wide 行为不变
- [ ] Focus Ring 视觉不变
- [ ] Workspace W0–W9 行为不变
- [ ] Rust unit tests 全通过
- [ ] differential tests 全通过
- [ ] `cargo clippy` 无 warning
- [ ] `cargo fmt --check` 通过
- [ ] `node tools/check.js --native` 通过
- [ ] Native C++/Rust 混合构建通过
- [ ] 当前 V3 smoke test 通过
- [ ] Rust Scroll 实机验收通过
- [ ] Focus Ring 实机验收通过
- [ ] mixed-DPI 验收通过
- [ ] 无新增 `INVARIANT_FAIL`
- [ ] 无新增 `FAIL_SAFE`
- [ ] 无新增 compositor crash
- [ ] Legacy C++ runtime 已删除

---

# 60. 推荐实施顺序

最终建议严格按：

```text
R0
Rust build / FFI 基础
        ↓
R1
Spring
        ↓
R2
ViewportMotion
        ↓
R3
ScrollViewportRuntime
        ↓
R4
Rust Scroll production
        ↓
R5
Focus Ring Core
        ↓
R6
Protocol 类型统一
        ↓
R7
删除 Legacy C++
```

禁止跳过 R1/R2 直接重写 Scroll Runtime。

---

# 61. 最终目标

重构完成后，CC-Niri Native 应形成清晰的三层模型：

```text
┌─────────────────────────────────────┐
│            KWin / Qt                │
│                                     │
│  EffectWindow / Scene / Paint API   │
└─────────────────┬───────────────────┘
                  │
             C++ Adapter
                  │
         stable narrow boundary
                  │
┌─────────────────▼───────────────────┐
│             Rust Core               │
│                                     │
│ Spring                              │
│ ViewportMotion                      │
│ ScrollViewportRuntime               │
│ Projection                          │
│ Geometry                            │
│ Protocol                            │
│ Focus Ring Core                     │
│ Native State Machines               │
└─────────────────────────────────────┘
```

C++ 成为平台适配层，而不是 CC-Niri 核心实现语言。

Rust 成为后续 Native 新功能的默认实现语言。

---

# 62. 后续开发规则

本重构完成后：

## 新增纯算法或状态机

默认：

```text
Rust
```

例如：

- gesture physics
- overview animation state
- multi-column native runtime
- animation scheduler
- additional projection logic

## 新增 KWin / Qt 接口

使用：

```text
C++ Adapter
```

例如：

- 新 Effect
- 新 Scene Item
- KWin paint hook
- EffectWindow lifecycle
- Qt/KDE integration

由此长期维持：

> **Rust owns CC-Niri logic.**

> **C++ owns KWin integration.**

这应成为 CC-Niri Native 层新的架构约束。
