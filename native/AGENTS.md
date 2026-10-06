# Native 开发约束

本目录同时遵守根 `AGENTS.md`。

## Core / Adapter

- Rust 使用自身的 ID、Rect、状态和错误类型，不依赖 Qt/KWin，不拥有平台对象指针。
- C++ 只承担平台适配职责；R0 中既有 C++ 核心保留，迁移各模块前必须先建立差分测试。
- FFI 使用窄 DTO / C ABI，明确内存所有权和生命周期；可失败入口返回明确错误，panic 不得跨越 C++ frame。保持 dev / release 的 `panic=abort`。
- compositor 当前线程同步执行，不因重构引入 async runtime、后台线程或全局锁。
- 热路径不得新增每帧 JSON 解析、复杂对象重建或重复字符串转换。
- retarget 从最后绘制的 offset 接管；Incoming / Continuing / Outgoing 共用 motion；完成后保留 Outgoing 直到 JS park / disarm。
- Focus Ring 真实 owner 由 Native KWin 决定，JS 只发布 eligibility；Rust 消费 Adapter 提供的 paint context。
- 独立 WorkspaceMotion 的有限曲线、gesture 边界 / wrap、连续 retarget 与投影由 Rust 负责。WorkspaceSlideAdapter 只持有 KWin output / window 可见性引用、转发 presentation timestamp 和绘制；不拥有工作区选择或焦点。优化选项默认关闭，不与 KDE Slide 同时运行，也不改既有 Scroll / Wide / Ring 参数。修改时执行 Rust 单测、workspace-motion-rust-contract、完整 Native 门禁和主屏 J/K / 反向 / Wide 中途切换实机复验。

## 构建与测试

复用 `native/CMakeLists.txt`、两个独立插件入口以及 `native/rust/CMakeLists.txt`；任何新 C++ 入口都要在 `project()` 前选择 `/usr/bin/g++`，之后检查 GNU 16.x。

Spring 迁移开关 `CC_NIRI_USE_RUST_SPRING` 与 Motion 开关 `CC_NIRI_USE_RUST_VIEWPORT_MOTION` 均默认 OFF。Rust Motion 内部使用 Rust Spring，Spring 开关仅选择保留的 C++ Motion 的 Spring；四种组合均合法。涉及 Spring / Motion backend 改动时，必须验证 OFF/OFF 的完整门禁，以及 ON/OFF、OFF/ON、ON/ON 三种独立 Native CTest；Focus Ring visual-transform / retarget 组合测试须跟随相同开关。纯 Core CTest 始终执行 Spring / Motion C++–Rust 差分、C++ Motion 的两种 Spring backend 及 Rust Motion 原有契约测试，不依赖开关值。默认 ON、部署和 Legacy 删除须单独推进并记录实机结果。

R4 `CC_NIRI_USE_RUST_SCROLL_RUNTIME` 默认 OFF，选择生产 Viewport Clip Effect 的 runtime，并使 scroll / Focus Ring visual-transform / retarget 组合测试跟随同一 backend。R3 `CC_NIRI_TEST_RUST_SCROLL_RUNTIME` 默认 OFF，仍可只覆盖测试选择 Rust。修改 Rust Scroll、typed DTO、Qt 转换层或生产接入时，必须验证所有生产开关 OFF 的完整门禁、生产 Scroll ON 且测试覆盖 OFF 的独立 Native CTest（Spring / Motion 分别 OFF/OFF 与 ON/ON），以及保留的 R3 测试覆盖 ON 路径；Debug / Release CTest 始终执行 C++ reference 对 Rust 的 Scroll 差分与原有契约。Rust Core 不依赖 Qt；差分 harness 与转换层需要 Qt6 Core（不需要 KWin）。不得将 authority、epoch、角色、投影或几何校验写回转换层；只能转换 Qt 值、探测平台矩形相等能力与管理 FFI 生命周期。

R5 `CC_NIRI_USE_RUST_FOCUS_RING_CORE` 默认 OFF，选择纯数值快照、geometry / corner / stroke / pixel alignment / clip padding。两个插件入口共享此开关；Scene Item、弱引用 attachment、renderer、damage 提交、KWin 唯一 owner 与 JS eligibility 保留在 C++ / JS，协议统一留给 R6。修改 Ring Core / FFI / 转换层时，必须验证全部 OFF 完整门禁、仅 Ring ON 的独立 Native CTest、Spring / Motion / Scroll / Ring 全 ON 且 R3 测试覆盖 OFF 的组合，以及 Scroll ON / Ring OFF 的回归。既有 Ring Phase 1–6 测试须跟随同一 backend；Debug / Release 纯 Core CTest 始终包含 C++–Rust Ring 数值差分，且实机重新验收。不得在 Rust 建立独立动画或 layout focus 状态。

R6 `CC_NIRI_USE_RUST_NATIVE_PROTOCOL` 默认 OFF，选择生产 Scroll observer / validator 与 Ring eligibility context；Ring Context / QObject Controller 测试跟随相同开关。Runtime 与 observer 共用 Rust sequence，输入必须经 ValidatedScrollPlan 校验后才能消费 epoch；几何 / 时钟 arm 失败依然消费已接受 epoch。Observer 临时窗口 token 不跨消息累积，runtime token 保持独立稳定生命周期。Ring 无效协议 fail closed，但 stale / conflicting / retired-session 消息保留现有 authority；generation / tombstone 规则不得写回 Qt 转换层。状态中的 backend 字段只读，Scroll 与 Ring 的 authority、协议版本和 JS schema 不合并。

修改共享 protocol / context / DTO / adapter 时，必须验证全部开关 OFF 完整门禁、仅 Protocol ON、所有 Rust 生产开关 ON 且 R3 测试覆盖 OFF，以及 R1–R5 所需的原有组合。Debug / Release 纯 Core CTest 始终执行 Native Protocol C++–Rust 状态 / 接收 / permission 差分和 Rust Ring Context 契约；Rust 单测须包含 JSON / Native epoch 范围、fail-closed 与 tombstone、FFI ownership / 错误、查询零分配。部署后重新验收横向滚动 / retarget、工作区切换、Ring 焦点 / fullscreen / off-on 与停止重启；未得到用户反馈时标记实机待验收。

除根文档要求的 Rust 检查和 `node tools/check.js --native`，CMake / FFI 改动必须执行：

```sh
for config in Debug Release; do
    cmake -S native -B "build/rust-$config" \
        -DCMAKE_CXX_COMPILER=/usr/bin/g++ \
        -DCC_NIRI_BUILD_KWIN_ADAPTERS=OFF -DCMAKE_BUILD_TYPE="$config"
    cmake --build "build/rust-$config"
    ctest --test-dir "build/rust-$config" --output-on-failure
done
```

工具链检查改动必须覆盖：GNU 16.x 通过；非 GNU、GCC 15.x / 17.x、非指定 C++ 路径和非固定 Rust/Cargo 版本在 configure 阶段拒绝。保留完整 Native CTest 中的 FFI smoke、scroll runtime、motion、Focus Ring 集成测试。

R1–R3 必须与旧 C++ 实现做差分；R4/R5 必须重新做设计中的实机视觉验收。未经 Rust 默认生产、完整门禁、实机验收和稳定使用，不删除 Legacy C++ 核心。
