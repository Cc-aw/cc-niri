# Native 开发约束

本目录同时遵守根 `AGENTS.md`。

## Core / Adapter

- Rust 使用自身的 ID、Rect、状态和错误类型，不依赖 Qt/KWin，不拥有平台对象指针。
- C++ 只承担平台适配职责，生产 Core 固定 Rust。旧 C++ oracle 冻结在 `rust/tests/reference/`，由编译 guard 和测试专用链接隔离。不得恢复迁移开关或生产 C++ 核心。
- FFI 使用窄 DTO / C ABI，明确内存所有权和生命周期；可失败入口返回明确错误，panic 不得跨越 C++ frame。保持 dev / release 的 `panic=abort`。
- compositor 当前线程同步执行，不因重构引入 async runtime、后台线程或全局锁。
- 热路径不得新增每帧 JSON 解析、复杂对象重建或重复字符串转换。
- retarget 从最后绘制的 offset 接管；Incoming / Continuing / Outgoing 共用 motion；完成后保留 Outgoing 直到 JS park / disarm。
- Focus Ring 真实 owner 由 Native KWin 决定，JS 只发布 eligibility；Rust 消费 Adapter 提供的 paint context。
- 独立 WorkspaceMotion 的有限曲线、gesture 边界 / wrap、连续 retarget 与投影由 Rust 负责。WorkspaceSlideAdapter 只持有 KWin output / window 可见性引用、转发 presentation timestamp 和绘制；不拥有工作区选择或焦点。优化选项默认关闭，不与 KDE Slide 同时运行，也不改既有 Scroll / Wide / Ring 参数。修改时执行 Rust 单测、workspace-motion-rust-contract、完整 Native 门禁和主屏 J/K / 反向 / Wide 中途切换实机复验。

## 构建与测试

复用 `native/CMakeLists.txt`、两个独立插件入口以及 `native/rust/CMakeLists.txt`；任何新 C++ 入口都要在 `project()` 前选择 `/usr/bin/g++`，之后检查 GNU 16.x。

`common/NativeCore.cmake` 是三个入口（Bridge / Clip / Ring）的共享 Rust adapter 构建路径。CMake 会清理旧 cache 的 R1–R6 迁移开关并说明 Rust 是唯一实现；不用迁移开关测试矩阵。

修改 Core / FFI / Qt 转换时，必须执行 Debug / Release Core CTest（全部 Spring、Motion、Scroll、Ring、Native Protocol Golden differential 和 Rust 契约），默认生产的完整 Native 门禁，以及 umbrella Native 构建 / CTest。修改 CMake 链接或 Core 边界时还须构建 `BUILD_TESTING=OFF` 的两个生产插件与 Bridge，核验没有 reference target / 旧算法符号。`tools/check-native-boundary.py` 已纳入完整门禁。

Runtime 与 observer 共用 Rust sequence，只有 ValidatedScrollPlan 可以消费 epoch；几何 / 时钟 arm 失败依然消费已接受 epoch。Observer 临时 token 不跨消息累积，runtime token 保持独立稳定生命周期。Ring 无效协议 fail closed，但 stale / conflicting / retired-session 保留现有 authority；generation / tombstone 不得写回 Qt 转换层。Rust 单测保留 JSON / Native epoch 范围、FFI ownership / 错误、查询零分配。

实机更新使用既有 save-state / stop / immutable install / start 路径。修改动画或平台 hooks 后复验 H/L / retarget、J/K、Pair/Wide、Ring owner / fullscreen / off-on 和停止重启；没有用户反馈时标记待验收。验收与回滚记录见 `test/RUST_NATIVE_R7_RESULTS.md`，早期 R0–R6 记录是迁移历史，不作为当前开关说明。

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

Golden differential 仍必须运行；不得将 reference 链接进生产，也不得用自动测试替代实机验收。
