# Rust Native R1 Spring 首次实现验收记录

日期：2026-10-05。范围：Rust Spring、C ABI、差分与开发开关；默认生产仍使用 C++。

## 实现范围

- 单 crate 增加 `spring.rs`：三种阻尼、原有闭式公式、默认参数、构造检查、signed nanoseconds、invalid / overflow fallback、位置与速度收敛条件。
- C++ `Spring.cpp` / `Spring.h` 数学 reference 保持原样。没有改 Spring 参数、JS schema、动画风格或 Scroll 状态机。
- C ABI 增加参数 / 样本 / status DTO、create / clone / destroy / isValid / sample / isSettled；显式定义空句柄错误与所有权。无效数学输入产生 invalid 但可安全采样的 Spring，与句柄错误分开。
- Rust immutable Spring 由 Arc 持有，构造时一次分配并预计算系数；clone 增加引用且不分配，最后一次 destroy 释放。sample / isSettled 不分配、不重新构造、不读时钟、不解析 JSON、不转换字符串。
- C++ `RustSpring` RAII 封装保留原有 value / copy / assignment 语义；不包含 Spring 公式。开发 backend 的成员与 candidate 通过 `SpringBackend` 选择。
- ViewportMotion 只替换 Spring 类型，epoch、retarget、零初速度、finish / snap、三秒超时均保留 C++。没有迁移 R2 内容。
- `CC_NIRI_USE_RUST_SPRING` 默认为 OFF。共享 CMake 模块使 Viewport Motion 和 Focus Ring 的 visual-transform / retarget 组合测试使用相同 backend。
- Core CTest 总是运行差分与 CPP / Rust 两种 Motion 测试，不依赖生产开关。Native CI 增加 OFF / ON matrix，Rust-test 在 Debug / Release 覆盖上述 Core 测试。

## 差分验证

每组相同输入直接运行 C++ reference 与 Rust C ABI / RAII。比较 isValid、position、velocity 与 isSettled；对同一外部样本也比较收敛判断。

容差固定为 `1e-8 + 1e-12 × max(abs(cpp), abs(rust))`，位置与速度分别检查。valid / settled 必须精确一致；无效 Spring fallback 和非正时间的初始样本逐位一致，包含 signed zero。

最终矩阵：1,116 组参数、381,624 次采样；其中包含 1,000 组固定种子随机参数。种子为 `0x43434e4952495231`（十进制 4846803700800901681）。覆盖：

- 正反向、零距离 / 非零初速度、小数坐标；critical / under / over 与 1 ± 1e-12；overshoot。
- i64 时间最小 / 最大、负值、零、1ns、乱序与重复采样；60 / 120 / 144Hz。
- 参数零 / 负 / NaN / 正负 Inf、subnormal、位移 / 系数 / 采样溢出、有限回退。
- 收敛阈值等于 / 超过的位置和速度、目标高速穿越。
- L L、L H、L L H、H L H L 在 60 / 120 / 144 / 1000Hz 下反复从最后采样位置重建，并保留零初速度。
- C ABI 布局、null status、句柄复制后原对象销毁、赋值与自赋值。

本机 Debug 和 Release 的最终差分均通过，最大 position / velocity delta 均为 0。该结果只对应当前 Rust 1.99.0、GNU 16.2.1 和本机平台，不宣称跨平台 bitwise 相等。

保留现有 C++ 的独立 RK4 ODE 参考，并为 Rust 添加独立 RK4 检查，避免只靠两份闭式公式互相比较。

## 自动门禁

- Rust fmt --check：通过。
- Rust clippy --locked --workspace --all-targets -- -D warnings：通过，无 warning。
- Rust unit tests：8 项通过，包含 ODE、收敛、单调 / overshoot、时间边界、invalid fallback、null handle 与引用生命周期。
- Native Core Debug / Release：每种配置 5 项 CTest 通过，包括差分、两种 Motion backend、FFI smoke 与编译器政策。
- 默认 OFF 的 `node tools/check.js --native`：完整通过，含 85 个 JS 测试、Rust 检查、Bridge / 三组隔离 D-Bus 测试、两个 Native 插件与 Plasmoid 构建、Native CTest。
- 独立 `build/native-r1-on`：RelWithDebInfo、Rust ON 的统一 Native 构建及 20 项 CTest 全通过。检查 Ninja 编译定义确认 Viewport Motion 与两个 Focus Ring 组合测试确实使用 `CC_NIRI_USE_RUST_SPRING=1`。
- 首轮完整门禁后补充 signed-zero 检查并修正 retarget 诊断；最终 Debug / Release 差分已复核通过。
- 使用最终差分矩阵再次运行默认 OFF 完整门禁与 ON 的 20 项 Native CTest：均通过。
- C++ reference 未修改；Rust 工具链与 Cargo.lock 约束保持不变。CI 配置已更新，远端 GitHub Actions 尚未执行。

## 性能观察

采样只读取不可变系数，经 C ABI 返回小型 DTO；每帧无新分配或共享状态锁。Arc 引用计数仅在 copy / replace / destroy 时更新，不在 sample 时更新。构造 / 替换增加一次 Rust 分配，这是相对 C++ inline Spring 的成本变化。

临时 CPU 微基准使用 GCC -O2、Rust release、默认临界阻尼，取 7 轮中位数：每轮 1,000,000 次 sample + isSettled，100,000 次 construct + isValid + destroy。观测为：

| 操作 | C++ | Rust C ABI / RAII |
| --- | --- | --- |
| sample + isSettled | 14.02 ns/op | 21.87 ns/op |
| construct + isValid + destroy | 9.78 ns/op | 36.27 ns/op |

临时源码为 `/tmp/cc-niri-r1-benchmark.cpp`。这是本机非正式测量，受 CPU 调频等影响，不代表 compositor 帧时或所有阻尼场景；尚未测量真实绘制开销。默认 ON 前仍须实机观察与必要的性能复核。

## FFI 与已知限制

- 非空句柄须由本库 create / clone 获得，保持存活并按引用次数 destroy；任意地址、use-after-destroy 与 double-destroy 属于调用方违反 ABI 契约，不能靠 null 检查修复。
- 合法 RAII 生命周期下，sample / query 的 status 必须为 OK；Cpp 封装对契约错误 abort，不继续输出可能损坏的状态。无效参数仍按基准返回 isValid=false 和安全 fallback，不触发 abort。
- dev / release 保持 panic=abort，Rust unwind 不跨 C++。Rust 分配失败仍是进程级 abort；开发 backend 未加入新的可恢复 allocator。
- 未进行 Native ON 部署、实机视觉验收、mixed-DPI 验收或稳定日常使用；没有切换生产默认，也没有删除 Legacy C++。

## 后续与回滚

R1 首次实现完成。下一步是独立 ON 构建的实机验收与性能复核，再单独决定默认 ON；R2 ViewportMotion 迁移尚未开始。

回滚开发路径时，以 `-DCC_NIRI_USE_RUST_SPRING=OFF` 重新 configure / build。常规 OFF 构建仍使用原 C++ Spring，不需要 Rust backend 的 RAII 状态。
本次没有安装或重载插件，无运行中桌面状态需要恢复。R0 和 R1 工作区修改尚未创建独立 commit；后续提交仍应保持阶段边界。

## 后续阶段

2026-10-05 后续按用户指令开始并实现 R2 ViewportMotion，见 [R2 记录](RUST_NATIVE_R2_RESULTS.md)。以上 R1 验收为当时快照，默认 ON 与实机验收仍待推进。
