# R7 后续：输入裁切的内部窗口生命周期修复

2026-10-17，清理基线 `7045a8a`。状态：实现完成，自动门禁和私有KWin回归 PASS；未部署，用户桌面实机验收 PENDING。对应 [2026-10-16崩溃分析](KWIN_CRASH_20261016_161144_ANALYSIS.md)。

## 复现与原因

在独立D-Bus、配置、运行目录和双虚拟输出的真实KWin中，用QWindow / QBackingStore创建内部提示窗；销毁QWindow时通过KWin的EffectWindowDeletedRef保留关闭窗口。测试实测该窗口仍在stacking order、deleted=true、handlePresent=false，然后通过正常PointerInputRedirection移动鼠标进入其原矩形。

修复前的Clip（与已提交清理验证中的产物哈希相同）在第一轮鼠标移动时触发KCrash，进程退出码-11 / SIGSEGV。该用例的期望结果为失败，不能将崩溃前已通过的10个准备检查计作整体验收通过。测试fixture和实际销毁顺序在前后对照中相同；后续补充的释放记录和取消后点击断言不改变失败点。生命周期崩溃测试仅对私有KWin禁用core dump，未改变用户进程或系统core策略。

这证明原输入裁切存在可复现的生命周期缺陷：对不归Scroll所有权、已关闭但仍保留绘制的InternalWindow额外执行hitTest，会访问已经不存在的QWindow。原始16:11事件中具体内部窗口的身份仍未从完整core确认；不据此认定它属于Ark或排除所有其他崩溃原因。

## 修复范围

- `ViewportInputClip::apply()` 在额外hitTest前拒绝已删除、无客户端和内部窗口，再通过现有Rust runtime role / frozen handoff所有权判断是否需要参与裁切；没有新增独立所有权集合。
- partial焦点candidate与ambiguity回退candidate共用相同存活性检查，避免从保留的关闭窗口读取几何或产生焦点候选。
- 审查了临时mask恢复、windowClosed / windowDeleted、零延迟timer和重入保护。QPointer仍保护QObject生命周期，关闭但仍保留绘制的客户端仍按原顺序清除临时hidden标志后释放可见性引用；Showing Desktop继续优先。没有更改ACK、park / restore、epoch或恢复流程。

没有修改Rust、FFI、CMake、协议、动画参数、布局与真实焦点authority。没有增加生产服务、线程、动画时钟、持久缓存、图形缓冲或每帧诊断。额外所有权查询使用现有Rust role和handoff接口；未声明整体零分配或资源预算达标。

## 验证

| 检查 | 结果 |
| --- | --- |
| 修复前真实生命周期基线，150% | EXPECTED FAIL：首轮触发SIGSEGV，退出码-11 |
| 修复后生命周期，100% | PASS 45/45；active / frozen handoff各8轮，共16个窗口；每轮关闭状态与引用释放均确认 |
| 修复后生命周期，150% | PASS 45/45；同样16轮；取消后正常点击坐标与按键配对恢复 |
| 150% + Fcitx5完整输入回归 | PASS 38/38；候选窗提交、popup、modal、拖拽、两次点击、滚轮、触摸、implicit grab、Ring、反向与取消后release |
| 150% + Fcitx5 P6完整脚本回归 | PASS 44/44；生成入口、导航/换位/宽度、Workspace、Fullscreen、恢复及私有CLI安全stop/reload |
| JS完整门禁 | PASS 240项 /117文件，无跳过；生成包和whitespace检查通过 |
| Rust fmt / clippy / test | PASS；Rust/Cargo1.99.0，locked workspace all-targets，clippy -D warnings；109项Rust测试 |
| Native CTest | PASS Bridge18/18、Clip18/18、Ring25/25，保留Golden differential与FFI契约 |
| 私有Bridge D-Bus / 生产边界 / Plasmoid | PASS |

完整门禁为 `env CMAKE_BUILD_PARALLEL_LEVEL=2 node tools/check.js --native`。使用既有构建树与 `/usr/bin/g++` GNU16.2.1，顺序构建、并行度2；Bridge为Release，Clip / Ring / Plasmoid为既有RelWithDebInfo，Rust Core及fixture为release。未修改CMake、Core/FFI或Qt值转换，不新增对应的Debug/Release、编译器拒绝或BUILD_TESTING=OFF矩阵。

私有测试加载路径与产物哈希均确认来自本次build tree，不能回退到已安装插件。前期曾测试过更改mask恢复条件的候选版本；最终保留原恢复行为后重新执行完整Native门禁和上表全部私有KWin检查，上表仅引用最终产物结果。

生命周期回归入口为 `python3 tools/scroll-layout-v2-p3-probe.py --isolated --scenario input-lifecycle --scale 1.5 --output /tmp/cc-niri-input-lifecycle-rerun`，将scale改为1即可覆盖100%。使用既有 `build/scroll-layout-v2-p0-fixture` 的Release fixture；修改fixture后须先按指定编译器配置并执行 `cmake --build build/scroll-layout-v2-p0-fixture --parallel 2`，生产Clip亦须由既有Native构建入口更新。

关键事实、全部布尔检查、逐轮关闭/释放状态、源码/产物哈希和完整日志路径/哈希见 [验证证据](kwin-crash-evidence/20261017-input-lifecycle/validation.json)。原始私有日志、截图和报告位于摘要列出的 `/tmp/cc-niri-input-lifecycle-*20261017`，不重复归档整份capture输出。

## 实机、资源与回滚

用户桌面未部署、未卸载或重载组件，KWin未被测试工具重启或强杀。所有主动关闭、保留和输入注入均发生在有隔离检查的虚拟KWin fixture中。真实H/L / 快速反向、J/K、Pair/Wide、Ring、Ark提示层关闭、Fcitx5及安全重载验收仍 PENDING；私有Mesa输出不替代实际GPU、显示器和日常桌面验证。

PSS、Private_Dirty、GPU归因、4K60帧时间和长期增长 NOT MEASURED。生命周期用例证明的是测试窗口和其保留引用逐轮释放，不能代表全项目内存预算已验收。

部署前可将本次三个源码/工具文件和原分析记录恢复到 `7045a8a`，移除新增修复记录与证据，再按既有入口重建；当前已安装组件不受仓库回滚影响。后续经明确授权部署时，使用现有save-state → stop / restore ACK → immutable install → start路径并保留安装前备份；出现异常按该备份和既有恢复流程回滚，不绕过blocked / ACK，也不强杀KWin。
