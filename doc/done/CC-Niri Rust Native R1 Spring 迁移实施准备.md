# CC-Niri Rust Native R1 Spring 迁移实施准备

归档状态（2026-10-07）：R1–R7 已完成，用户已确认 Rust 部署正常、重构完成；文中迁移开关是历史实施步骤，生产固定 Rust。旧 Spring 文件现为冻结测试 reference，见 [R7 记录](../../test/RUST_NATIVE_R7_RESULTS.md)。

本文记录 R1 实施前的边界、语义基准与验证方案。首次实现已按此方案完成 Rust Spring、差分测试、C ABI 与当时默认 OFF 的开发开关，见 [R1 验收记录](../../test/RUST_NATIVE_R1_RESULTS.md)。R1 当时生产默认仍为 C++，默认 ON 和实机验收留给后续阶段；这些工作现已完成。下文的起点、拟实施清单与准备结果保留实施前语境。

本轮依据 [Native Core 总设计](CC-Niri%20Rust%20Native%20Core%20重构实施设计.md)、[R0 验收记录](../../test/RUST_NATIVE_R0_RESULTS.md)和当前源码。工具链继续固定为 Rust 1.99.0、`/usr/bin/g++` GNU 16.x，沿用 R0 的单 crate、C ABI、CMake → Cargo 和 `--locked`。

## 实施起点

R0 与工具链固定已通过本地完整门禁；远端 CI 尚未执行。当前 R0 修改仍在工作区，只有 Cargo.lock 已暂存。后续应将 R0 和 R1 保持为独立的提交或 PR；本次准备没有创建提交。

当前 `Spring.h`、`Spring.cpp`、`ViewportMotion.cpp` 和 `ViewportMotionTest.cpp` 没有工作区修改，可作为首轮差分基准。参考实现保持原有数学代码，不改参数、不重命名替换算法，也不在 Rust 验证通过前删除。

## 必须保留的 Spring 语义

基准文件为 [Spring.h](../../native/rust/tests/reference/Spring.h) 和 [Spring.cpp](../../native/rust/tests/reference/Spring.cpp)。

| 项目 | 当前基准 |
| --- | --- |
| 默认参数 | dampingRatio = 1.0，stiffness = 800.0，epsilon = 0.0001，mass = 1.0 |
| 参数含义 | dampingRatio 为阻尼比；迁移不得误当作阻尼系数 |
| 输入 | from、target、initialVelocity、参数和有符号纳秒 elapsed |
| 采样模型 | 闭式时间函数，不按帧数积分，也不读取时钟 |
| 三种阻尼 | ratio == 1 为临界，ratio < 1 为欠阻尼，ratio > 1 为过阻尼 |
| 固有频率 | sqrt(stiffness) / sqrt(mass)，保持运算顺序 |
| 非正 elapsed | 有效 Spring 返回精确 from 和 initialVelocity |
| 无效 Spring | sample 返回有限 target，否则 0；velocity 为 0；isSettled 为 false |
| 非有限采样结果 | 返回 target 和零速度 |
| 收敛 | 有效且样本有限；位置误差 <= epsilon，速度绝对值 <= epsilon × omega |

必须逐项移植有限值检查、溢出检查、near-critical 运算和过阻尼 slow root 的倒数写法。不能将 near-critical 输入归并到临界分支，不能重排公式或引入 fast-math。

epsilon = 1e-4 是生产收敛阈值，与差分容差不同。无效输入的安全采样也是基准行为，不能只比较有效输入。

## R1 与 R2 的职责

R1 只迁移 Spring 的构造、有效性、position / velocity 采样与收敛判定。

`ViewportMotion` 的 epoch、start / retarget / finish / snap、三秒超时及完成时精确落到 target 均继续使用现有 C++。当前 retarget 重置速度为零；高频测试需要保留这条规则，不能顺便改成速度连续。

Scroll Runtime、窗口角色、最后绘制 offset 的 authority、Outgoing 生命周期及 Focus Ring 渲染不在 R1 中迁移。

## 文件与接口准备

以下为拟实施清单，不表示文件已经新增。

| 文件 | 拟修改 |
| --- | --- |
| native/rust/cc-niri-native-core/src/spring.rs | Rust SpringParams、SpringSample、阻尼状态与纯数学实现 |
| native/rust/cc-niri-native-core/src/lib.rs | 导出 Spring 模块 |
| native/rust/cc-niri-native-core/src/ffi.rs | 最小 Spring C ABI 和错误状态 |
| native/rust/include/cc_niri_native_core.h | 参数、样本 DTO 及函数声明 |
| native/rust/tests/SpringDifferentialTest.cpp | 直接运行旧 C++ 与 Rust，比较同一输入 |
| native/rust/CMakeLists.txt | 注册差分 CTest，在不依赖 KDE 的构建中执行 |
| native/viewport-clip/RustSpring.h 和 .cpp | C++ 生命周期封装，转发 Rust 数学，禁止复制公式 |
| native/viewport-clip/ViewportMotion.h 和 .cpp | 后期接入可切换 Spring backend，保留 Motion 语义 |
| native/viewport-clip/CMakeLists.txt | backend 开关及目标依赖 |
| native/focus-ring/CMakeLists.txt | 同步两个引用 Scroll Runtime / Motion 的测试目标 |
| test/RUST_NATIVE_R1_RESULTS.md | 实施后记录测试、差分范围、性能、实机与回滚 |

FFI 沿用 C ABI，参数使用 f64，elapsed 使用 i64 纳秒，bool 状态以固定宽度整数表达；不传 Qt 类型或时钟对象。

建议采用 Rust 拥有的 immutable Spring opaque handle，C++ RAII 封装负责 create / clone / destroy，sample / isSettled / isValid 只转发。实现时必须保证现有 Spring 的复制和赋值语义，因为 Motion 构造 candidate 后赋值给成员。分配仅发生在创建或替换 Spring 时；每帧 sample 不分配、不重算构造系数。

句柄方案属于拟实施选择：在生产接入前必须验证生命周期、复制赋值、无效句柄处理与构造成本。无效数学输入仍保留可采样的 invalid Spring；FFI 状态错误与 Spring.isValid 分开表达。失败不能留下半替换的 Motion 状态，panic 不能穿越 C++。

## 差分测试矩阵

每个样例使用相同参数、初始值和纳秒 elapsed，比较 isValid、position、velocity、isSettled。保留 [现有 ODE 数值参考](../../native/viewport-clip/tests/ViewportMotionTest.cpp)，避免两份实现同时移植错误仍互相通过。

| 类别 | 必须覆盖 |
| --- | --- |
| 方向与距离 | 正向、反向、零距离、零距离但非零初速度、fractional coordinates |
| 阻尼 | 0、0.65、1、1.7；1 ± 1e-12；欠阻尼 overshoot 与高速穿越 target |
| 时间 | i64 最小值、负值、0、1ns、小 dt、大 dt、i64 最大值；乱序和重复采样 |
| 参数 | 非默认 mass / stiffness / epsilon；每个字段的零、负值、NaN、正负 Inf |
| 数值边界 | 位移溢出、频率或系数不可表示、指数衰减、采样溢出和 fallback |
| 收敛 | 位置与速度阈值内、等于和超过阈值；收敛判定必须与 C++ 一致 |
| 连续输入 | L L、L H、L L H、H L H L；60 / 120 / 144Hz 与高频重建；初速度重置为零 |
| 随机样例 | 固定种子、限定可解释参数范围；失败输出种子、完整输入、采样时间和两侧结果 |

拟固定差分容差：position 和 velocity 分别使用 `abs_error <= 1e-8 + 1e-12 × max(abs(cpp), abs(rust))`。isValid / isSettled 和 fallback 行为必须精确一致；t <= 0 的有效采样必须保持精确初始值。阈值边界单独检查，不以数值容差放宽布尔收敛判定。

容差属于 R1 的拟验收标准，尚未经 Rust 实现验证。出现差异时先检查运算顺序、libm、ABI 与浮点选项，并记录原因，不能为了让测试通过自动扩大容差。

## 实施顺序

1. 保持 C++ reference 不变，建立测试输入、比较规则与失败诊断。
2. 逐公式移植 Rust Spring，并接入测试用 C ABI；Rust unit tests 与 C++ / Rust 差分同时推进，先不接生产。
3. 在 R0 Native Core 的 Debug / Release CTest 中执行差分；保留现有 Motion、Runtime 与 Focus Ring 集成测试。
4. 差分通过后实现 RustSpring 生命周期封装，接入 `CC_NIRI_USE_RUST_SPRING` CMake option，默认 OFF。
5. 分别验证 OFF 和 ON。Focus Ring 的两个组合测试当前直接编译 Spring.cpp / ViewportMotion.cpp / ScrollViewportRuntime.cpp，必须同步 backend 与链接依赖，不能在测试中无意继续走旧 backend。
6. 使用单独的 ON 构建验证行为与性能，记录主屏慢速 H/L、连续及反向 retarget、滚动中 J/K、Pair / Wide、Focus Ring 跟随的实机结果。
7. 自动与实机结果充分后，再单独推进默认 ON；稳定使用和 Legacy 删除按总设计条件处理，不在首次 R1 移植中删除旧 C++。

## 必执行门禁

Rust fmt、clippy `-D warnings`、`cargo test --locked --workspace`，以及 `node tools/check.js --native` 均须通过。CMake / FFI 修改还要运行根与 Native AGENTS.md 中的 Debug / Release 构建和 CTest。

Spring 开关 OFF / ON 使用不同构建目录，configure 明确传入 `/usr/bin/g++`，记录 backend，防止复用缓存造成误验。差分测试直接链接 reference 和 Rust，不受生产开关影响。

R1 首次实现完成标准：Rust 数学与测试接口就绪，差分及完整门禁通过，生产默认仍 OFF，结果写入 R1 记录。默认 ON 是后续独立切换动作，不能将实现通过等同于已完成生产验收。

## 当前准备结果

已核对现有 Spring 公式、默认参数、invalid fallback、Motion 的复制赋值和 retarget 语义、Focus Ring 组合测试依赖，以及 R0 的测试与工具链约束。

本次仅增加准备文档和索引，未修改 Rust / C++ / JS、构建配置或开关，也未部署。未因文档改动重跑完整门禁；沿用 R0 工具链固定阶段已通过的验收记录，不将其记作 R1 测试结果。
