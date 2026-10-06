# Rust Native R2 ViewportMotion 首次实现验收记录

日期：2026-10-05。范围：Rust Motion 状态机、C ABI、薄 C++ 封装、差分与默认 OFF 开关。生产默认仍使用 C++；本阶段没有安装或重载插件。

## 实现范围

- `native/rust/cc-niri-native-core/src/viewport_motion.rs` 持有 Spring、from / target、epoch、起始时间和运动状态，接管 start、retarget、sample / current / velocity、finish、snap 和完成判断。纯 Rust，无 Qt/KWin、系统时钟、线程、锁或新增依赖。
- `ffi_motion.rs` / `cc_niri_native_core.h` 提供固定宽度 DTO 与独占 mutable handle。create 与 clone 分配独立状态，destroy 释放；copy 在已有 handle 内复制状态，支持自赋值。start / retarget / sample / finish / snap / copy 不分配内存。非空 handle 必须有效，调用同步且满足 Rust 借用约束；空 handle 返回 INVALID_HANDLE，非法数学输入或拒绝的序列返回 false / OK，状态不变。panic / OOM 不跨 C++ frame，保持 panic=abort。
- `RustViewportMotion.h/.cpp` 仅转换类型、转发调用和管理生命周期，复制保持独立值语义；不重新实现 epoch / 时间 / retarget policy。
- `ViewportMotion.cpp/.h` 保留 R1 时的 C++ reference 实现。ScrollViewportRuntime 只将 motion 成员及重置构造切换到 backend alias，其角色、投影、最后绘制 offset、outgoing 生命周期和协议算法保持原样，R3 尚未迁移。
- `CC_NIRI_USE_RUST_VIEWPORT_MOTION` 默认 OFF；Rust Motion 内部使用 Rust Spring。R1 `CC_NIRI_USE_RUST_SPRING` 仍默认 OFF，只控制保留的 C++ Motion 的 Spring。四种组合合法；Scroll 与 Focus Ring visual-transform / retarget 组合测试使用相同配置。Rust wrapper 编译继承同一 Spring 配置，保持其引用的 C++ 声明一致。
- 复用 R0 Cargo/CMake 构建入口、精确 Rust 1.99.0、`/usr/bin/g++` GNU 16.2.1 与已跟踪 Cargo.lock。CI Native matrix 扩展为两个开关的四种组合，远端 CI 尚未执行。

## 保留的行为

- 首次 motion epoch 为 -1，负 epoch / 负 start、retarget 时间拒绝。epoch 单调；完全匹配的重复 start / retarget 幂等，不重启运动，即使该重复请求的非负时间早于起始时间。
- 新 epoch 时间不得倒退；拒绝请求不改变状态。retarget 从指定时间的当前采样位置接管，初速度重置为 0；Scroll Runtime 仍以最后绘制 offset 调用 start 接管。
- sample 只读，较早时间夹到 elapsed=0；起始时间非负，i64 极值时间差安全。Spring 收敛或 elapsed >= 3 秒时输出精确 target / 0 速度，但不隐式修改持有状态。
- finish 仅接受匹配 epoch 且已完成的 motion；snap 仅接受有限 offset，并保留 epoch / 起始时间屏障。无参数、样式、JS schema、恢复或生产行为调整。

## 自动验证

| 验证 | 结果 |
| --- | --- |
| cargo fmt --all --check | 通过 |
| cargo clippy --locked --workspace --all-targets -- -D warnings | 通过 |
| cargo test --locked --workspace | 12 项通过；含 3 项新 Motion 单测和 1 项新 FFI 空指针 / 独立 clone / copy 生命周期测试 |
| Debug / Release 纯 Core CMake + CTest | 各 7 项通过，包含原 Spring 差分、两种 Spring 的 C++ Motion、Rust Motion 原有契约、Motion 差分、ABI smoke 与 GCC 拒绝路径 |
| OFF/OFF 完整 node tools/check.js --native | 通过；85 项 JS、Bridge 5 项 CTest 与 3 项隔离 D-Bus、viewport 11 项 CTest、ring 18 项 CTest、Plasmoid 构建 |
| ON/OFF、OFF/ON、ON/ON 独立 Native CTest | 各 22 项通过，包括 scroll runtime、motion、Focus Ring visual-transform / retarget、HiDPI 与 presentation |

四种组合按 Spring / Motion 顺序书写。OFF/OFF 使用既有 `build/native-viewport-clip` / `build/native-focus-ring`；ON/OFF 复用 `build/native-r1-on`；OFF/ON 在 `build/native-r2-on` 验证后恢复 ON/ON。没有修改安装前缀、执行 install 或激活 Rust 插件。

Motion differential 固定 seed `0x43434e4952495232`（4846803700800901682）。共 **1,096 组历史、307,984 次操作、3,442,720 次采样**；Debug 和 Release 的最大位置 / 速度差均为 **0**。数值容差为 `1e-8 + 1e-12 * max(abs(a), abs(b))`，接受 / 拒绝、kind、epoch 与 active / done 逐项精确比较。

- L L / L H / L L H / H L H L：六种阻尼、60 / 120 / 144 / 1000 Hz，每组连续重复 100 次，并交错重复 / 冲突 / 过期 epoch 请求。
- 1,000 组固定种子随机历史：每组 200 次 start、retarget、finish、snap、sample，包含非法参数、NaN / infinity、负 / 倒退时间、i64 极值、epoch 最大值、无位移和慢 Spring。
- 每步探测过去、现在、完成边界与极值时间，完成后再采样过去以确认只读语义；穿插 clone 独立修改、赋值、自赋值与后续状态检查。失败输出种子、历史 / step、操作、输入、时间及 Spring 参数。
- 复用原 `ViewportMotionTest.cpp` 对 Rust Motion 执行已有运动契约；新增 Rust 单测显式验证位置连续 / 零速度、幂等 / snap 屏障、三秒边界 / 极值时钟。

本地日志：`/tmp/cc-niri-r2-core-final.log`、`/tmp/cc-niri-r2-off-check.log`、`/tmp/cc-niri-r2-spring-only.log`、`/tmp/cc-niri-r2-motion-only.log`、`/tmp/cc-niri-r2-on-final.log`。临时日志不作为仓库产物。

## 性能与限制

独立 GCC `-O2` 微基准，Rust release staticlib、默认 critical 参数；7 轮中位数，每轮 1,000,000 次 sample 与 100,000 次交替 retarget：

| 操作 | C++ reference | Rust Motion |
| --- | ---: | ---: |
| sample | 14.74 ns | 18.38 ns |
| retarget | 30.07 ns | 38.23 ns |

此数据仅评估本机单实例计算和 FFI 开销，使用 `/tmp/cc-niri-r2-benchmark.cpp`，不等同于 KWin 帧时间或正式性能验收。采样及 retarget 无堆分配；create / clone 分配一次，运行时 context 重置可创建新 handle。未进行 Rust 生产部署、实机视觉、混合 DPI、长时间稳定性或 compositor 帧时间验收，不能据此开启默认开关或删除 C++ reference。

## 阶段状态与回滚

R2 首次实现与本地自动验证完成，R3 ScrollViewportRuntime 迁移尚未开始。R1 / R2 默认 ON 与实机验收仍独立待推进。现有 C++ reference 和两个默认 OFF 开关保留；开发构建回退时将两个开关设为 OFF 并重建。R0–R2 工作区修改尚未创建阶段 commit；不改变既有 Cargo.lock 跟踪状态。

## 后续实机部署

2026-10-05 按用户指令单独部署并启用 Rust Motion，加载检查和两轮内屏人工功能 / 视觉验收通过；实机帧时间、mixed DPI 和长时间稳定性尚未验收。源码开关默认仍为 OFF；以上“未部署”为代码阶段快照，最新状态见 [R2 实机记录](RUST_NATIVE_R2_LIVE_RESULTS.md)。

## 后续代码阶段

2026-10-05 按用户指令实现 R3 ScrollViewportRuntime，代码阶段差分与自动门禁通过，见 [R3 记录](RUST_NATIVE_R3_RESULTS.md)。当前桌面继续运行本阶段已验收的独立 R2 构建。
