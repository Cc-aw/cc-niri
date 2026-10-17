# R7 后续：确认无调用代码清理

2026-10-16，基线 `9cf6503`。本轮按源码引用、生成包语法树和现有回归识别零调用项，仅清理确认无用的 JS 实现与打包入口。Native / Rust / FFI / CMake 源码、ABI、协议、动画参数均未改；仍在使用的 V1、旧状态迁移、Native 诊断 API、Golden 差分基线与 POC 记录保留。

## 清理范围

- 删除 RuntimeEntry 中13个零调用转发函数和2个未使用宽度常量；真实模块调用、快捷键和信号入口保留。
- 删除 StartupLayout 已被 WorkspaceMountController 替代的 orderWindows / restoreOffset 和未使用 anchor 解析/存储，保留仍供迟到窗口使用的 savedOrder / insertionIndex。
- 删除无运行时消费者的 MotionProfiles 表、打包条目及仅验证该表的独立测试，更新当前设计状态。实际 MotionTokens、MotionController、动画时间和通道策略保留。
- 删除 RuntimeBridge.partialPaintedState、MotionController.cancelAll、PresentationController.selectPersistent 的无调用内部方法；Native 的 GetPartialPaintedState D-Bus 诊断接口仍保留。
- v2DeviceRect 与 widePairEdgeError 仍供现有验证使用，移入 CommonJS 区段，避免加载到生产 KWin 脚本。
- 将仅断言废弃转发函数存在的旧测试改为检查实际委派路径；启动测试保留迟到插入和错误快照拒绝，展示测试保留 clear 对持久偏好的保护。

## 静态差分

PASS：比较基线与清理后两个生产包的完整语法树，仅剔除上述明确删除的声明、方法和 StartupLayout 的废弃 anchor 状态后，其余 AST 完全一致。一次性审计还检查了生成包顶层标识符引用，未发现其他零引用顶层函数/变量；测试或诊断仍使用的类方法没有据此盲删。

主脚本433383→428958字节（减少4425）；Effect脚本86859→84187字节（减少2672），合计7097字节。源码和生成脚本通过 `node tools/build.js` 同步。证据见 [AST 差分](dead-code-cleanup-evidence/20261016/runtime-ast.json)。这是源码/包体结果，不是 PSS 或帧率测量。

## 验证状态

PASS：完整 JS 回归240项 /117文件；相比基线241项 /118文件少的是已删除 MotionProfiles 表的独立测试。既有布局、Workspace、恢复 ACK / 重试、Wide / Full 与动画回归继续执行。

PASS：完整 `node tools/check.js --native`，包含以下固定工具链检查：

```sh
cargo fmt --manifest-path native/rust/Cargo.toml --all --check
cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings
cargo test --manifest-path native/rust/Cargo.toml --locked --workspace
node tools/check.js --native
```

Rust109项单测通过；Bridge / Clip / Ring CTest分别18/18/25，包含 Golden differential / FFI 契约；私有 Bridge D-Bus、生产架构边界和 Plasmoid 构建通过。固定 Rust/Cargo1.99.0、`/usr/bin/g++` GNU16.2.1，构建并行度2；Bridge为Release，两个插件与Plasmoid为既有RelWithDebInfo，Rust Core按既有规则使用release。没有 CMake / FFI 改动，不新增 Debug/Release 测试矩阵。

PASS：私有双输出 KWin / Native / Bridge / Ring，150% + Fcitx5场景44/44。覆盖完整生成入口、V1/V2状态切换、H/L与换位、J/K、Fullscreen、恢复后CLI卸载，以及三轮新session的真实安全stop。实际用户桌面未参与这些测试。见 [隔离运行结果](dead-code-cleanup-evidence/20261016/isolated-150-fcitx5.json)。

最终状态见 [验证摘要](dead-code-cleanup-evidence/20261016/validation.json)；[完整Native门禁日志](dead-code-cleanup-evidence/20261016/native-gate.log)仅规范化行尾空白，原始日志SHA保留在摘要中。首次 Native 门禁在用户中断时尚未完成，确认无残留构建后复用现有构建树重跑；中断记录没有计作 PASS。

本轮未部署或重新加载用户桌面，未替换已安装组件，实机目测 NOT PERFORMED。全项目 PSS、Private_Dirty、GPU、4K60与长期增长 NOT MEASURED。回滚可恢复基线中的本轮源码、打包清单和测试，再执行生成与验证；保留的运行逻辑语法树未改变，当前已安装版本不受此次仓库清理影响。

## 第二轮第一批：仅测试调用的方法（2026-10-16）

基线 `d0a981e`，前一轮清理已独立提交为 `34970aa`。本批删除四个没有生产消费者的方法：`ControllerComposition.names`、`MotionTransaction.roleFor` / `complete`、`MotionController.sample`。这些方法不属于 D-Bus、FFI、快捷键或配置接口；引用核查中仅测试使用，历史设计文档里的示例保留。

测试改为检查实际控制器集合、事务角色迁移与现有 clear 行为；Wide 邻窗回归通过生产使用的 visualSnapshot 检查透明度，继续覆盖反向、无几何变化退出、过期完成回调和重复操作。删除仅验证未使用 complete 方法的断言，没有增加测试专用生产接口或复制动画采样实现。`ContinuousViewportController.adopt/setGeometry` 仍为隔离 fixture 构造关键场景，暂保留；RuntimeLogger.setEnabled 在 Effect 有真实消费者，保留。

PASS：定向4个测试文件通过，完整 `node tools/check.js` 为240项 /117文件通过，无跳过；生成包同步与 whitespace 检查通过。首次普通沙箱运行中，P0 Native fixture 拒绝路径测试因 spawnSync Python 的 EPERM 失败；确认环境限制后扩大工具执行权限重跑同一完整门禁，通过结果取自后者，未修改或跳过失败测试。

PASS：相对基线的完整生产包 AST 差分只删除以上四个方法，其余语法树一致；主脚本428958→428891字节（减少67），Effect脚本84187→83764字节（减少423），本批合计490字节，相对前一轮清理前累计减少7587字节。见 [本批AST证据](dead-code-cleanup-evidence/20261016/batch1/runtime-ast.json) 和 [本批验证摘要](dead-code-cleanup-evidence/20261016/batch1/validation.json)。完整门禁日志保留在摘要指定的临时路径，不重复归档整份输出。

本批没有修改 Native、Rust、FFI、CMake、工具链或生产动画算法，因此未重复 Native 构建及私有 KWin；本批实机验收 NOT PERFORMED，资源目标 NOT MEASURED。未部署、重载或修复输入裁切崩溃。回滚以 `d0a981e` 恢复本批三个源码文件、对应测试与两个生成包即可，已安装桌面不受影响。

下一批审查结论：Native Backend / protocol 别名仍有生产或测试消费者，移除需改动调用方，属于结构简化而非确认无用代码；旧 Bridge 可执行文件、D-Bus 和 systemd 名称仍承担兼容职责；POC 缺少生产引用不代表无诊断用途；测试证据体积不属于运行时代码。当前没有将这些项目纳入删除清单，待逐项证明被完整替代后再独立实施和验证。

## 第二轮第二批：Native 零引用声明（2026-10-16）

删除 `FocusRingCoreBackend.h` 中没有调用方的 capture / captureVisual 两个 inline 转发，以及 `RustViewportMotion.h` 中没有使用方的 MaxSpringTime 常量，共303字节源码。生产实际使用 captureGain；底层 cc_niri_ring_capture / cc_niri_ring_capture_visual 的 Rust实现、C ABI声明及其直接契约/差分测试保留。3秒完成保护继续由 Rust实现和既有测试覆盖，没有新增 C++ policy。

引用审查覆盖生产、测试、工具与文档，未发现这三个声明的消费者；两个头文件与 `d0a981e` 的逐字比较确认，除了三处声明删除，其余内容完全一致。所有仍被调用的 Backend / protocol 别名、可动态调用的 Qt / D-Bus 入口和 Golden 基线均保留。

PASS：`env CMAKE_BUILD_PARALLEL_LEVEL=2 node tools/check.js --native`，包括完整240项JS /117文件、固定Rust1.99.0的 fmt、clippy（locked / all-targets / -D warnings）、109项Rust测试；Bridge / Clip / Ring CTest分别18/18/25通过，私有Bridge D-Bus、Rust生产边界、Plasmoid构建通过。使用既有构建树、`/usr/bin/g++` GNU16.2.1、顺序构建且并行度2。原构建类型仍为Bridge Release、Clip / Ring / Plasmoid RelWithDebInfo，Rust Core release。

没有修改 CMake、Core算法、FFI契约、Qt值转换或平台hook，不新增对应的Debug / Release / 编译器拒绝测试矩阵，也未重跑私有KWin。完整Native门禁验证了第二批Native与第一批JS的组合。见[第二批验证摘要](dead-code-cleanup-evidence/20261016/batch2/validation.json)，记录精确头文件差分、产物哈希与临时门禁日志路径及哈希；不重复归档大段构建输出。

本批未部署或重载桌面，实机验收 NOT PERFORMED，资源收益 NOT MEASURED；删除未调用的inline / 常量不等于降低PSS或提升帧率。回滚恢复 `d0a981e` 的两个头文件后按原入口重建即可。本批没有处理输入裁切崩溃。

## 第二轮第三批：过期一次性 POC（2026-10-16）

进一步逐份阅读后，仅删除下面五个共2322字节的一次性脚本。它们绑定历史窗口标题、固定恢复/停放矩形或测试窗口关闭动作，没有通用配置或状态恢复能力；删除前对所有Git跟踪文件检查文件名引用，除自身外均为0。当前生产打包与安装入口均不加载这些文件。本次没有执行任何POC或关闭、移动用户窗口。

- `poc/kwin-poc-restore-chatgpt.js`：指定标题窗口的固定矩形恢复。
- `poc/kwin-poc-restore-typora.js`：指定历史文档标题窗口的固定矩形恢复。
- `poc/kwin-poc-select-pseudo.js`：按固定几何或标题选择一次性伪窗口。
- `poc/kwin-v3-force-code-parking-poc.js`：把Code窗口写到旧测试的固定停放位置。
- `poc/kwin-v3-close-test-code.js`：按历史测试标题关闭Code窗口。

通用Workspace API探针、布局/停放实验、对应历史记录及生产Recovery均保留。Git中的 `d0a981e` 仍可恢复以上五个原文件；没有用新的生产恢复逻辑替换历史脚本。

PASS：余下31个POC JavaScript逐份通过 `node --check`（只解析、不执行）。生产包哈希与第一批验证值一致，第二批Native头文件哈希也一致。随后独立运行完整 `node tools/check.js`，240项 /117文件通过，无跳过；生成包与whitespace检查通过。见[第三批验证摘要](dead-code-cleanup-evidence/20261016/batch3/validation.json)，包含删除前大小/哈希、引用检查结果、逐项退役理由及门禁日志路径/哈希。

第三批没有Native改动，沿用第二批完整Native门禁，不重复构建；未部署或重载桌面，实机验收 NOT PERFORMED，资源收益 NOT MEASURED。本轮已确认的删除项到此结束，不为压缩体积删除仍承担测试、兼容或诊断职责的实现。输入裁切崩溃修复仍待独立实施。
