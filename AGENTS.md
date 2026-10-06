# CC-Niri 仓库约束

## 工具链

- Rust 精确使用根 `rust-toolchain.toml` 指定的 **1.99.0**，包含 rustfmt / clippy；不得用 stable 别名、nightly 或其他版本替代。
- 跟踪 `native/rust/Cargo.lock`。构建、测试、lint 使用 `--locked`，依赖变化须一并更新 lockfile。
- 所有 C++ CMake 入口显式使用 **`/usr/bin/g++`，GNU GCC 16.x**。configure 必须通过共享的 `cmake/CCNiriToolchain.cmake` 选择和检查编译器；不得绕过检查。
- 使用既有构建树与安装入口；CMake 调用 Cargo，Debug → dev，其余标准配置 → release。

## 架构边界

- JS Control Plane 负责布局、工作区、协议发布、StabilitySupervisor 与全局恢复；Rust 重构不得复制这些 authority。
- Rust Core 负责与平台无关的算法、几何、协议验证和状态机。Qt/KWin 类型、QObject / EffectWindow 指针不得进入 Core。
- C++ Adapter 负责 KWin/Qt API、对象生命周期、effect hooks、Scene Item 和渲染；迁移后的核心 policy 不得回流到 Adapter。
- R0 基础设施已建立，R1 Spring 与 R2 ViewportMotion 已移植，分别接入默认 OFF 的 `CC_NIRI_USE_RUST_SPRING` / `CC_NIRI_USE_RUST_VIEWPORT_MOTION`。R3 Scroll Runtime 已迁移到 Rust，R4 通过默认 OFF 的 `CC_NIRI_USE_RUST_SCROLL_RUNTIME` 选择生产 Effect runtime；Scroll / Focus Ring 组合测试跟随生产开关。`CC_NIRI_TEST_RUST_SCROLL_RUNTIME` 默认 OFF，可单独覆盖测试选择 Rust。源码生产默认仍为 C++，实机独立构建与回滚基线按阶段记录保留；保留 Golden Baseline 和差分测试。
- R5 Focus Ring 数值快照、geometry / corner / pixel alignment / decoration padding 由默认 OFF 的 `CC_NIRI_USE_RUST_FOCUS_RING_CORE` 选择；两个插件和现有 Ring 组合测试必须使用相同开关。Native KWin 继续决定唯一 owner；不引入 Ring 时钟或第二套 focus authority。
- R6 `CC_NIRI_USE_RUST_NATIVE_PROTOCOL` 默认 OFF，选择共享 Rust Scroll observer 与 Focus Ring eligibility policy。Rust Motion / Scroll / Ring 复用统一 ID、Epoch、Generation、Context、Rect 和 NativeError；Scroll v2 与独立 Ring v1 authority / JS schema 保留。JSON / QUuid 解码与 KWin 实际焦点、可见性、对象生命周期仍在 Adapter；不能以类型统一为由合并两套发布 authority。
- 工具链或语言迁移不改变滚动、Spring 参数、retarget、Focus Ring、Pair/Wide、Workspace 或快捷键行为。
- 修改 `src/` 后用 `node tools/build.js` 生成包，不直接编辑生成脚本。

## 必须执行的验证

工具链、Native、构建或 FFI 改动完成前，必须执行并报告结果：

```sh
cargo fmt --manifest-path native/rust/Cargo.toml --all --check
cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings
cargo test --manifest-path native/rust/Cargo.toml --locked --workspace
node tools/check.js --native
```

完整 Native 门禁使用已配置的 `build/bridge`、`build/native-viewport-clip`、`build/native-focus-ring`、`build/plasmoid`；configure 时传入 `-DCMAKE_CXX_COMPILER=/usr/bin/g++`。工具链缓存来自旧版本时，重新配置并更新 Rust executable 缓存或使用新构建树，不降低门禁要求。

修改 CMake / FFI 时还须验证 Native Core 的 Debug / Release 构建与 CTest，以及编译器拒绝路径，详见 `native/AGENTS.md`。纯 JS 修改至少执行 `node tools/check.js`；修改生产动画须继续执行设计要求的差分与实机验收。

自动测试不能替代实机验收；未执行的检查应明确标记。阶段结果写入 `test/RUST_NATIVE_R*_RESULTS.md`，记录范围、结果、性能、限制和回滚方式。
