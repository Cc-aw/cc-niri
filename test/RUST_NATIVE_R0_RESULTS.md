# Rust Native R0 验收记录

日期：2026-10-05。范围：Rust 构建与 FFI 基础设施，不迁移生产算法。

## 修改范围

- 新增 `native/rust/` Cargo workspace，初期仅一个 `cc-niri-native-core` crate，提供 `rlib` / `staticlib`，无第三方依赖。
- MSRV 为 Rust 1.85；使用 stable Rust，不要求 nightly。提交 `Cargo.lock`，CMake / CI 使用 `--locked`。
- 纯 Rust `rust_core_version()` 与 C ABI `cc_niri_rust_core_version()`；C ABI 返回库生命周期内有效、不可修改或释放的静态 NUL 结尾字符串。
- Rust dev / release 使用 `panic=abort`。当前 FFI 入口无分配、无输入指针、无可失败操作；未来可失败入口仍须提供明确错误状态，不允许 unwind 穿过 C++。
- 新增 C++ FFI smoke test，检查版本、非空指针与重复调用的静态存储身份；注册到 CTest。
- 新增 `native/CMakeLists.txt` 统一入口，也保留 Viewport Clip / Focus Ring 独立 CMake 构建与安装入口。
- CMake 自动调用 Cargo 并链接静态库；Debug → Cargo dev，Release / RelWithDebInfo / MinSizeRel → Cargo release。未指定单配置构建类型时默认 RelWithDebInfo。
- Cargo 构建产物放在各 CMake 构建树内；每次构建交由 Cargo 检查增量依赖，避免 CMake 时间戳遗漏 Rust 输入或产物删除。
- `install.sh` 在构建前检查 cargo / rustc；CMake configure 检查最低 Rust 版本。不要求用户先执行 Cargo。
- `tools/check.js --native` 增加 fmt、clippy、Rust unit tests，原有 Native CTest 同时覆盖 FFI smoke。
- CI 增加 rust-test（固定 1.85.0 与 stable）、rust-fmt、rust-clippy；native-build 安装 Rust / Cargo。Rust 测试任务同时验证 Debug / Release 的 CMake 与 C ABI。
- README 增加工具链依赖、检查方式与配置映射。

## 生产边界

Spring、ViewportMotion、ScrollViewportRuntime、Focus Ring 生产逻辑均保持 C++。
插件进入 Rust 构建和链接体系，但没有新增生产 Rust 函数调用。
未更改 JS protocol schema、Spring 参数、H/L、retarget、窗口角色或 Focus Ring 样式。
未运行安装、卸载、effect reload 或 Plasma Shell 重启。

## 环境与已完成验证

本机：Fedora 44；rustc / cargo 1.98.1；CMake 4.3.0；Ninja 1.13.2。

- `cargo test --manifest-path native/rust/Cargo.toml --locked --workspace`：FFI 字符串终止符、版本一致性与静态存储单元测试通过。
- `cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings`：通过，无 warning。
- `cargo fmt --manifest-path native/rust/Cargo.toml --all --check`：通过。
- 单配置 Ninja Debug / Release：CMake → Cargo 构建及 FFI smoke 均通过。
- Ninja Multi-Config Debug / Release：配置切换后构建与 FFI smoke 均通过。
- `node tools/check.js --native`：完整门禁通过，包含 85 个 JS 测试文件、生成包一致性、Rust 检查、Bridge CTest / 三组隔离 D-Bus 集成测试、Viewport Clip / Focus Ring 构建与 CTest（含 FFI smoke）、Plasmoid 构建。
- `cmake -S native -B build/native-r0 -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo`：统一入口包含两个插件的构建通过；16 项 CTest 全通过。
- `bash -n install.sh` 与 `git diff --check`：通过。
- 低于 MSRV 的模拟 rustc：configure 提前拒绝；`BUILD_TESTING=OFF` 与未指定构建类型：自动选择 release profile 并构建通过。

本机缺少 rustfmt / clippy 包；验证时下载与本机 Rust 同版本的 Fedora RPM，仅解包到 `/tmp/cc-niri-rust-tools/extracted`，通过临时 PATH 调用，未安装系统软件。

## 门禁中发现的既有测试问题

Bridge `workspace-recycle-qobject-lifetime` 测试替身缺少控制器当前要求的 `transitionStatus`，导致始终等不到 compositor idle，并触发 lifetime/confirmation failure。在沙箱内外均可复现。
为该测试提供同步 idle 回调后，原有 500 次 QObject 删除/确认循环通过；未修改控制器生产代码。

隔离 D-Bus 测试需要创建临时 socket，沙箱默认禁止；完整门禁在获准的沙箱外进程中验证，不连接现有桌面的 D-Bus 会话。

## 性能与限制

R0 未替换任何绘制热路径算法，无新增每帧 JSON 解析、分配、线程或字符串转换；未进行实机帧耗时测量。
不支持 Rust cross-compilation，CMake 明确拒绝该配置。
CI 工作流已更新，本地未执行 GitHub Actions；Rust 1.85.0 的实际编译由新增的 CI matrix 验证。
R0 不做新算法的实机视觉验收；后续 R1–R4 仍须按设计执行差分和实机验收。

## 回滚

撤回本阶段 Cargo / FFI / CMake、安装预检查、检查工具及 CI 集成修改，使用原有两个 Native CMake 入口重新构建即可恢复重构前构建体系。
此阶段没有安装新插件或修改运行中的桌面状态，无需执行系统恢复。
Bridge 测试替身补齐是独立的测试修正，可保留。

## R0 补充：仓库级工具链固定

本节记录后续工具链约束，取代上文初始 R0 的 Rust 1.85 MSRV、stable CI matrix 与本机 1.98.1 工具链约定。

### 修改

- 根 `rust-toolchain.toml` 精确固定 `1.99.0`，minimal profile，包含 rustfmt / clippy；Cargo workspace 的 rust-version 更新为 1.99。
- `native/rust/Cargo.lock` 已加入 Git 索引；继续使用 `--locked`。
- CMake 从仓库工具链文件读取精确版本，在 configure 阶段同时检查 rustc / cargo。检查命令和 Cargo build 在仓库根执行，保证 rustup 能发现根文件；其他版本和预发布版本均拒绝。
- 所有 C++ 入口共享 `cmake/CCNiriToolchain.cmake`：`project()` 前显式选择 `/usr/bin/g++`，之后检查 `GNU` 与版本区间 `[16.0, 17.0)`；其他 C++ 路径、非 GNU 或其他 GCC 主版本均拒绝。
- Native 统一入口、Viewport Clip、Focus Ring、Bridge、Plasmoid、install.sh 和 CI configure 命令都使用相同约束。
- CI Rust 任务均固定 1.99.0；C++ smoke 任务使用 Fedora 44 的 GCC 16，与 Native build 一致。自动化 CTest 增加 C++ 工具链政策拒绝测试。
- 新增根 `AGENTS.md` 和 `native/AGENTS.md`，约束 Core / Adapter / JS authority、FFI、热路径、行为基线以及必须执行的 Rust、Native、差分与实机验证。
- README 更新准备方式与旧 CMake 缓存迁移说明。未修改任何生产算法、协议或视觉行为。

### 验证

本机精确工具链：rustc / cargo 1.99.0；rustup 显示由仓库 `rust-toolchain.toml` 选择 `1.99.0-x86_64-unknown-linux-gnu`；`/usr/bin/g++` 为 GNU 16.2.1。

- Rust fmt / clippy（无 warning）/ unit tests：通过。
- `node tools/check.js --native`：完整通过；85 个 JS 测试文件、Bridge 5 项 CTest / 三组隔离 D-Bus 集成、Viewport Clip 6 项 CTest、Focus Ring 13 项 CTest，以及 Bridge / 两个 Native 插件 / Plasmoid 构建均通过。
- Native Core Debug / Release：CMake → Cargo 构建通过；各 2 项 CTest（FFI smoke 与工具链政策）通过。
- C++ 政策测试：GNU 16.0.0 / 16.2.1 通过；GCC 15.9 / 17.0、Clang 和其他 C++ 路径拒绝。
- 实际 configure 拒绝测试（临时版本替身）：rustc 1.98.1 / 1.100.0 / 1.99.0-beta.1、cargo 1.98.1 / 1.99.0-nightly 以及 `/usr/bin/c++` 均拒绝。
- 既有四个构建目录重新 configure 通过，缓存均为 `/usr/bin/g++`；两个 Native Rust executable 缓存均指向 rustup 代理。
- `git ls-files --error-unmatch native/rust/Cargo.lock`：通过，lockfile 已跟踪；仅暂存此 lockfile，没有创建 commit。
- CI YAML 解析与所有 Rust job 的精确版本检查：通过；远端 GitHub Actions 尚未执行。
- `bash -n install.sh`、已暂存 / 未暂存补丁的 `git diff --check` 与新增工具链文件空白检查：通过。

旧 CMake 构建树从 `/usr/bin/c++` 切换到 `/usr/bin/g++` 时，会触发 CMake 自身的编译器缓存重建；本次保留原有构建路径，重新 configure 并恢复安装前缀等选项后验证。未安装插件或重载桌面。
