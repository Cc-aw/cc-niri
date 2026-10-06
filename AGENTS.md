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
- R0–R7 已完成：Spring、ViewportMotion、Scroll Runtime、Focus Ring geometry 和 Native Protocol / eligibility 的生产实现固定为 Rust；迁移开关已退休，不能选择 C++ runtime。
- C++ Adapter 仅转换 Qt 值、管理 FFI handle、观察 KWin 实际焦点 / 可见性与对象生命周期、绘制。Scroll v2 与独立 Ring v1 的 JS schema 和发布 authority 保留；不建立第二套布局 / 焦点 authority 或 Ring 时钟。
- 旧 C++ Golden Baseline 只存在于 `native/rust/tests/reference/`，仅 `BUILD_TESTING` 的差分可执行文件可链接，不继续开发。生产 Bridge 与两个插件必须通过 `tools/check-native-boundary.py`；`BUILD_TESTING=OFF` 不得生成 reference target。
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
