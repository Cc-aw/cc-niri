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
