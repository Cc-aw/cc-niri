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

## 全项目低内存设计约束（16GB 桌面）

- 资源预算覆盖 KWin JavaScript、Rust Native Core、原生 Viewport Clip / Focus Ring、独立 Bridge，以及开启时的可选 Dock。不得仅凭单个进程 RSS 或单个功能零分配宣称整体低内存。
- 默认 Dockless 整套项目相对原生 KDE 的空闲稳态 PSS 净增量初始目标为 **≤32 MiB，争取 ≤16 MiB**；正常动画期间 PSS 观测峰值净增量目标为 **≤64 MiB**。这些是待测目标，不是现有实测结果；先建立同负载 B0/B1 基线，无法可靠归因时标记 `INCONCLUSIVE`。
- 轻量布局特性的空闲 / 动画增量目标为 ≤2 / ≤8 MiB，必须计入同一份项目总预算；同样窗口 / 工作区数量下，30–60 分钟交互后空闲 PSS 净增长超过 4 MiB 须调查，持续正斜率或存活对象增长不得通过验收。
- 禁止新增不必要的常驻 daemon、线程池、全屏 / 窗口尺寸图像或纹理、额外动画时钟、每帧 JSON 与无界缓存。新增动画热路径以零堆分配为设计目标；必要的现有状态可按真实窗口数量 O(N) 增长，不得按历史操作次数增长。
- 新功能默认新增独立服务 / 线程池 / 动画时钟、窗口尺寸 / 全屏缓冲均为 0；例外须明确批准，图形缓冲须先架构评审并测量资源成本。
- 窗口关闭、工作区退出 / 回收、输出移除、effect 卸载和安全 stop 后，关联引用、Scene Item、纹理、信号、timer、FFI handle 与 IPC callback 必须释放或回到有界稳态；不得绕过 ACK、park / restore 或 epoch 清理顺序。
- 正常 idle 不得有插件发起的循环 repaint、每帧日志或持续 capture。诊断默认关闭、容量与时间有界，不得在绘制热路径分配诊断缓冲。
- 对内存 / 生命周期路径先测量再优化，报告 A/B PSS、Private_Dirty、对象 / 纹理数量、帧时间、GPU 归因限制与回归结果；不以降低 4K60 动画流畅度或破坏安全恢复换取内存。
- 测量使用 Release 产物，待大型构建 / 测试结束后低频采样；16GB 设备不并行执行高内存 Debug / Release 构建，通常使用 `--parallel 2`。用户正在使用的桌面不得未经明确允许执行组件卸载、强杀 KWin、强制重登、热插拔或内存耗尽测试。
- 按 [全项目资源规范](doc/todo/iA%20Writer.md) 执行 M0 基线、M1 账本、M2 最小优化和 M3 验收；结果分别写入 `test/CC_NIRI_GLOBAL_MEMORY_BASELINE.md`、`test/CC_NIRI_GLOBAL_MEMORY_AUDIT.md` 和 `test/CC_NIRI_GLOBAL_MEMORY_RESULTS.md`，每项明确 `PASS` / `FAIL` / `BLOCKED` / `INCONCLUSIVE` 或 `NOT MEASURED`。未验收项目保持 Pending，不虚报达标。

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
