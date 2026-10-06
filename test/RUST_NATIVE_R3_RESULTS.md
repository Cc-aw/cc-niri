# Rust Native R3 ScrollViewportRuntime 实现与验收记录

日期：2026-10-05。范围：Rust Scroll Core、typed DTO / C ABI、薄 Qt 转换层、reference 差分与集成测试。R3 代码阶段完成；生产 Effect 接入与重新实机验收属于 R4。当前桌面继续使用已通过两轮内屏验收的 R2 插件。

## 实现

- `native/rust/cc-niri-native-core/src/scroll_runtime.rs` 管理 context authority / generation、session / workspace / output 切换、epoch / fingerprint、取消屏障、共享 ViewportMotion、columns / source_frames / visual_targets / WindowRole、最后绘制 offset、完成持有和 projection。
- 使用 Rust 自有 Text（UTF-16 值）、WindowId（每个 runtime 的稳定 token）、Rect、Placement、WindowRole、RuntimeContext / ScrollPlan / ScrollEntry。Rust Core 无 Qt/KWin、QObject / Window 指针、JSON 库、系统时钟、后台线程、锁或新增 Cargo 依赖。
- Rust 验证协议 2 / SCROLL、文本长度与 canonical window ID、安全整数、offset / viewport / entry 几何、placements、256-entry 上限和窗口 / 列重复。UTF-16 保留平台字符串单位与未配对 surrogate；Qt 只做字段形状 / 数字类型解码与 serialization。完整 compact envelope 包含未知字段，作为 opaque fingerprint 交给 Rust 比较；不在帧路径解析。
- `ffi_scroll.rs` / `cc_niri_native_core.h` 提供窄 C ABI：唯一可变 handle，clone / copy 保持独立状态；输入 slice 为本次调用借用，context 输出 view 只在下次 mutation / destroy 前有效。空 handle / 非空长度的空 buffer / 错误 DTO 返回明确 status；非法协议和普通状态拒绝返回 false / OK。非空指针必须满足调用契约；保持 panic=abort，不跨 C++ unwind。
- `RustScrollViewportRuntime.h/.cpp` 只转换 Qt 值、管理 token / handle、转发 API。ID 在 arm / frame snapshot 等事件阶段 intern，projection 只查已有 token；window remove 释放两侧 ID 映射且不重用旧 token。context / arm / clone / copy 可分配；advance / projection / status DTO / role / frame fill 不分配。返回 QHash 快照只在显式调用时重建，R4 不应将其引入每帧热路径。
- 平台矩形 equality 的 zero-fuzzy 能力由转换层构造时探测一次，Rust 执行对应的纯数值比较；几何 ownership epsilon 仍为 0.5。支持 Qt 的相对 fuzzy equality，以及当前 Qt 在零值附近的行为，没有依赖 Qt Rust 类型。

## 保留的行为

1. Authority 仅由 Dock State 建立。非法 context、protocol 1、同 session 过期 generation 都按原 runtime 清空 authority 和 Motion。新 session 重置 Motion / cancelled epoch；同 session 的 workspace / output 切换清空绘制状态并保留序列和 motion 屏障。
2. 取消 epoch 在 observe 前拒绝；observe 接受的新 epoch / fingerprint 在几何或 clock 检查前写入。后续 arm 失败仍消耗该序列；相同 fingerprint 的 duplicate 返回当前 active，不重新启动旧运动。未知 envelope 字段的冲突也继续拒绝。
3. Retarget 从最后 advance 实际绘制的 frame_offset 调用 start，不能改为 arm 时重采样。Incoming / Continuing / Outgoing 共用一个 Motion；source 与 visual target 分别保留。
4. 前一段 outgoing 即使省略于新 plan，也在 continuing 场景继续持有，并调整 visual target。motion 完成后保持 outgoing，直到 park / cancel / disarm；clear 不放松 epoch，remove 仅移除指定窗口。
5. Projection 只接受已知 target / source frame 的半像素范围，排除 parking / resize；paint query 不采样时钟。取消、context 切换、无重叠 incoming、未提交几何的 equal-offset return 和完成边界均跟随 reference。

## R3 / R4 边界

`CC_NIRI_TEST_RUST_SCROLL_RUNTIME` 默认 **OFF**，只选择 Scroll Runtime 和 Focus Ring visual-transform / retarget 测试中的 runtime。纯 Core CTest 无论此开关值如何，始终执行 reference 差分与强制 Rust 原有契约测试。

`ScrollViewportRuntime.cpp/.h` 保留 R2 时的 reference；`ViewportClipEffect.cpp/.h` 本阶段没有修改。Production Effect 仍明确持有 C++ ScrollViewportRuntime，两个 R1 / R2 开关继续只控制 reference 的数学模块。已核验 Rust Scroll 宏出现在三个集成测试目标，而未进入 Effect 的编译配置。独立测试 ON 构建不会把生产插件切到 Rust Scroll。

统一与两个独立 Native 入口复用原 Cargo/CMake 路径。Qt6 Core 仅供 C++ adapter / reference harness 使用；不构建 KWin 的 Debug / Release 测试入口也执行这两个 Qt harness，CI rust-test 因此增加 qt6-qtbase-devel。CI 新增 R3 测试 ON 一行，远端 Actions 未运行。

## 验证结果

工具链：Rust / Cargo **1.99.0**，`/usr/bin/g++` GNU **16.2.1**，本机 Qt Core **6.11.2**。Cargo.lock 跟踪状态不变，无依赖变更。

| 验证 | 结果 |
| --- | --- |
| cargo fmt --all --check | 通过 |
| cargo clippy --locked --workspace --all-targets -- -D warnings | 通过 |
| cargo test --locked --workspace | 17 项通过；含新的 Core 状态 / projection / registry、FFI 生命周期与分配计数检查 |
| Debug / Release Core CMake + CTest | 各 9 项通过；保留 7 项 R0–R2 测试，新增 Scroll differential / Rust contract |
| OFF/OFF/OFF node tools/check.js --native | 通过：85 项 JS；Bridge 5 项 CTest 与 3 项隔离 D-Bus；viewport 13 项 CTest；ring 20 项 CTest；Plasmoid 构建 |
| ON/OFF/OFF、ON/ON/OFF 独立 Native CTest | 各 24 项通过，R1 / R2 reference 路径回归 |
| OFF/OFF/ON、OFF/ON/ON 独立 Native CTest | 各 24 项通过，包括 Rust Scroll 的原有契约及 Focus Ring visual-transform / retarget / HiDPI / presentation |
| ABI DTO size、Qt strict ASCII 编译、GCC configure 拒绝路径 | 通过 |
| git diff --check / --cached --check | 通过 |

表中开关顺序为 Spring / Motion / Scroll test。默认门禁使用既有四个 standalone 构建树；ON 路径复用 `build/native-r1-on` / `build/native-r2-on`，新 R3 集成目录 `build/native-r3-tests` 最终为 OFF/OFF/ON。

Differential 固定 seed `0x43434e4952495233`（4846803700800901683）：**347 组历史、75,041 次操作、21,289,290 次 projection 比较**。Debug / Release 的最大数值差均为 **0**；接受 / 拒绝、status、active / completed、maps 的 key、role 和 projection presence 精确比较。矩形 / translation 容差为 `1e-8 + 1e-12 * scale`；提供非有限物理 frame 的 fixture 仅比较两侧同样的非有限值，不把它计为正常投影。

- 256 组固定随机历史，每组 100 次持续滚动及不同帧提交顺序，60 / 120 / 144 / 1000 Hz；交错 duplicate / 冲突 extra field / stale plan、取消、remove、copy、自赋值、失败时间、context / session 切换。
- 64 组 malformed plan / canonical UTF-16 ID fixture、20 组 context fixture、7 组退化 / 非有限 source frame 与“几何拒绝消耗序列”fixture。
- 每步检查 targets / sourceFrames / roles / status；投影检查 source / target、parking、resize、0.5 与略大于 0.5 的边界、未知窗口。失败打印 seed、history / step、操作、context、plan、时刻及输入物理 frames，方便复现。
- 原 `ScrollViewportRuntimeTest.cpp` 在 Rust backend 下完整执行，继续覆盖固定间距、共享 motion、retarget 链、动画中反向、未提交几何、explicit retargetOnly、延迟 park / completion、context barrier 与关闭窗口。Focus Ring 两项组合测试切到相同 runtime，保持渲染行为检查。
- 测试专用 allocator 按线程计数，不影响生产库。Core 与 C ABI 各连续执行 1,000 帧 advance / projection / 状态 / role / frame fill，**堆分配计数为 0**。clone 独立修改、copy / self-copy、空指针、空 buffer、frame count / fill 与 buffer 拒绝路径通过。

最终日志：`/tmp/cc-niri-r3-debug-final.log`、`/tmp/cc-niri-r3-release-final.log`、`/tmp/cc-niri-r3-off-check.log`、`/tmp/cc-niri-r3-r1-path.log`、`/tmp/cc-niri-r3-r2-path.log`、`/tmp/cc-niri-r3-rust-motion-path.log`、`/tmp/cc-niri-r3-integration-final.log`。

开发中发现差分 fixture 使用隐式 ASCII QString 转换，纯 Core 与 umbrella 初测通过，但 standalone KDE 的 QT_NO_CAST_FROM_ASCII 编译失败。已改为显式 Latin-1 字面量，并重跑上述最终门禁，全部通过。

## 性能与限制

GCC `-O2`、Rust release staticlib、本机 3-window plan，7 轮中位数，每轮 1,000,000 次查询；提前取出 QString ID / target frame，projection 固定持有位置，advance 在 0–1ms 保持运动：

| 操作 | C++ reference | Rust + Qt Adapter |
| --- | ---: | ---: |
| projection | 25.43 ns | 55.18 ns |
| advance | 30.15 ns | 34.25 ns |

当前 Rust projection 路径耗时更多。该微基准来自 `/tmp/cc-niri-r3-benchmark.cpp`，只衡量计算、map 查找与 FFI；不能推导 KWin 帧时间或视觉性能。R3 尚未生产部署或执行 Scroll Runtime 实机验收；compositor 帧时间、mixed DPI 和长期稳定性待 R4 / 后续验证。

## 阶段结论与回滚

R3 Rust Core、FFI、Qt adapter、347 组差分及集成测试完成，保留 reference 和默认 OFF 测试开关。下一阶段 R4 将 Effect 的 runtime 接入 Rust，单独推进生产构建、部署和实机验收；不得因 R3 自动通过删除 Legacy。

本阶段没有安装、重载或修改桌面配置。部署发现链接仍为 R2 的 `235122ab1af1e93718f544f5282b53332affa87e230bf482382c757c336595de`。回退 R3 测试路径只需将 `CC_NIRI_TEST_RUST_SCROLL_RUNTIME=OFF` 重新构建；R2 实机回滚继续使用 [实机记录](RUST_NATIVE_R2_LIVE_RESULTS.md) 的旧 C++ immutable 插件。工作区 R0–R3 改动未创建阶段 commit，未改动用户的 Core UX 设计文档。

后续状态：R4 现已接入生产 Effect 并部署独立验收构建，详见 [R4 记录](RUST_NATIVE_R4_RESULTS.md)。上文 R3 阶段的生产边界与部署状态为当时结果；reference 和测试覆盖开关继续保留。
