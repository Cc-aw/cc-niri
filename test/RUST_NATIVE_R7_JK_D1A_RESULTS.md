# Rust Native R7：J/K D1a 桌面投影预计算结果

**实现与离线门禁 PASS；未部署，实机 A/B 与视觉验收 PENDING。** 按用户要求不调整 Blur/Contrast。此次仅 D1a，不加入 D2 时间步长限制或其它曲线改动。

## 范围与策略

在实际本地 dirty 工作树上开发；原单列居中、typed COLUMN_REINDEX、Bridge、JS authority、资源规范与所有其它未提交修改保留。基线HEAD为b77a40e，验证基于完整本地工作树，不将其当成仅检出远程基线的结果。

Native Clip 增加 `Effect-cc-niri-viewport-clip / WorkspaceProjectionCache`，**默认false**。优化只记忆 Rust `cc_niri_workspace_projection` 的结果，不复制运动、可见性数学或布局决策。

- 在真实输出、最外层 paint pass 的 Rust advance 后，对全部当前desktop预计算投影；只保存Rust标为visible的项。每binding固定4项，没有“最多两个桌面”的假设。
- 保持desktop顺序、membership检查、WindowPaintData变换、原viewport设备clip、全输出重绘、PAINT_SCREEN_TRANSFORMED、420ms及现有retarget/制动逻辑。
- 容量不足、无真实输出frame/view、嵌套/未跟踪pass或失效时使用完整原路径，不使用部分缓存，也不静默漏画。
- 原路径与回退的桌面列表采用const快照，避免共享QList因可写begin()触发detach。该结论来自本机Qt API和共享列表测试；未证明旧getter在所有场景必然分配，也未把它宣称为原长帧根因。
- desktop增删/销毁、grid、output移除/geometry/scale、retarget、窗口删除、finish/stop/reconfigure时清理或失效；缓存只活到当前输出pass结束。新增生命周期信号连接按live desktop/output有界，QObject销毁或adapter卸载时由Qt释放。
- 固定8层输出pass路由恢复嵌套parent，移除输出的借用地址立即forget；溢出不复用缓存。
- 下游paint重入使缓存失效时，对剩余desktop取新列表并回退，不重复已经绘制的desktop；window/binding失效后不继续访问。
- mark_painted仍发生在下游绘制调用返回后且clip非空；若下游重入已改动该binding的motion revision或sample time，不把旧projection误标为新pose。仅缓存失效或其它输出的嵌套绘制不会因此取消正常pose确认。

现有有界Workspace capture追加 `motionCapture.projectionAudit`：cacheEnabled、projectionCalls、cachedFrames、cachedWindowPasses、fallbackWindowPasses。计数仅在已有3秒capture启用时收集，查询才序列化；没有每帧日志/JSON/DBus、timer或额外诊断buffer。缓存中途回退的window pass可同时贡献cached与fallback计数，两者不是互斥分组。

## 几何、调用次数与资源证据

新增 `workspace-projection-cache` CTest 使用真实Rust FFI和实际KWin VirtualDesktop QObject：

- 3×3 grid、wrap开/关、72个整数/分数gesture位置；逐desktop、sticky背景、多desktop membership的缓存/旧遍历/强制回退绘制计划逐项完全相同。
- 有限非相邻曲线与反向retarget，在多个采样点比较相同的Rust投影；last-painted仍交给原Rust契约。
- 负输出原点与100%/150%/200%设备裁剪数值对照，原clip函数输入保持一致；此项不是GL截图或实机混合DPI视觉验收。
- 4项完整结果、5+项溢出完整回退、空可见集、非法投影、共享Qt列表const遍历、绘制重入、window/binding消失、实际QObject销毁、嵌套/其它输出/无frame及pass溢出。
- 非事件帧测试段C++ operator new计数增量为0；原Rust Core的零分配契约继续通过。没有GPU纹理/新服务/新线程。

| 夹具（只代表这个工作负载） | 原遍历 | 每帧缓存 |
| --- | ---: | ---: |
| 27窗口、9桌面的实际Rust投影调用 | 27 | 9 |
| membership检查 | 243 | 54 |
| 绘制计划与投影 | 基准 | 完全相同 |

**原代码是在membership通过后才调用Rust，不是N×D次投影。** 小窗口集、大desktop数时预计算可能反而增加投影调用，不能宣称所有场景都减少CPU成本；需实际A/B决定是否启用。缓存144字节/binding，输出pass栈136字节/adapter，另有geometry/scale/grid/revision元数据及少量诊断计数。binding原有生命周期结束后释放其缓存，没有历史增长。

全项目PSS、Private_Dirty、GPU时间和30–60分钟增长仍 **NOT MEASURED**；不能以sizeof或一次零分配测试宣称16GB预算已通过。

## 最终验证

精确Rust/Cargo1.99.0，所有Cargo构建/测试/lint均locked；所有正常CMake configure固定/usr/bin/g++ GNU16.2.1，并使用共享工具链入口。耗资源构建串行、每次parallel2，未在帧采样中运行编译。

| 检查 | 结果 |
| --- | --- |
| cargo fmt --all --check / clippy --locked -D warnings / test --locked --workspace | PASS；65个Rust测试 |
| node tools/check.js --native（最终共享列表修正后） | PASS；106个JS文件 / 116个Node测试 |
| Bridge / Clip / Ring CTest | PASS；18 / 18 / 25 |
| 5个隔离DBus / Plasmoid / Native boundary | PASS |
| Core Debug / Release configure、build、CTest | PASS；13 / 13 |
| Native umbrella Debug build、CTest（最终版本） | PASS；30项，含新增缓存测试 |
| BUILD_TESTING=OFF Release两插件+Bridge | PASS；无Golden/differential/cache-test target，production nm boundary通过 |
| 编译器拒绝路径 | PASS；policy覆盖GCC15/17、非GNU、非指定路径；实际configure拒绝/usr/bin/c++ |
| DESTDIR安装暂存与manifest | PASS；唯一Clip路径在/home/cc/.local下，未写discovery链接 |
| 实机缓存off/on同窗口A/B、S01–S14、H/L/Wide/Ring/停启 | PENDING；需先由用户决定部署 |
| 新flag实际GPU/FPS改善 | NOT MEASURED，不宣称解决掉帧 |

最终日志：`/tmp/cc-niri-jk-d1a-native-final.log`、`debug.log`、`release.log`、`umbrella-final.log`、`production-final.log`、`bridge-production.log`、`reject.log`（共同前缀`cc-niri-jk-d1a-`）。第一次生产审计脚本使用了错误的umbrella产物子路径，改为真实bin目录后审计成功；没有降低门禁要求。

源与候选hash、验证汇总：[`diagnostics/JK_D1A_VALIDATION_20261013.json`](diagnostics/JK_D1A_VALIDATION_20261013.json)。CPP源码、测试和这份阶段报告作为D1a独立变更保存，README/doc索引中此前的单列居中与D0内容不混入该变更。

## 待决定的部署与回退

本轮还未修改当前Native discovery链接、kwinrc或运行组件。当前Blur/Contrast与单列居中保持原状态。D2为独立选做观感策略，本轮没有实现；D1b按用户决定不实施。

候选已经过现有安装入口的DESTDIR暂存；构建ELF与安装后的ELF可能因install RPATH调整而不同，部署核对以暂存安装字节为准：

`737c5dbf9bbf682ed59a384f52d1676be8cfbeab8b90f4450ac4e35785c4678d`

经用户决定部署后，先更新持久配套备份和实际窗口/焦点基线，走既有 save-state → cc-niri stop → tools/install-native-clip.py immutable Clip安装 → cc-niri start。不重启KWin/Plasma，不覆盖原已映射.so。Bridge/Ring/JS此次未变，不为缓存补丁另改authority。

先保持新flag false验证原行为，再在相同窗口集合、同输入序列下比较false/true/false；用原始framePresented边界统计、projectionAudit及实际渲染/输入检查分别报告。配置切换在Native idle时进行，保留原键缺失状态和其它用户配置。未获视觉验收前默认不提高到true。

回退：将WorkspaceProjectionCache恢复到试验前值/缺失状态，再按既有reconfigure或restart；如仍异常，安全stop后将Clip discovery恢复至原不可变库并按配套状态start。原库SHA为`024557e2565edd03796136671eda16c91bbf64985ebb568a1727f7893d04be3a`。部署前重新建持久备份，不依赖已经被重启清理的旧/tmp备份。

持久审阅候选与备份：`/home/cc/.local/state/cc-niri/backups/jk-d1a-prepare-20261013-190002`（0700）。该目录已保存旧Clip、候选安装字节、配置/布局、独立补丁和门禁日志；尚未部署。用户决定部署时先刷新配置、布局、输出及实际焦点基线，不把审阅时快照当作之后的新状态。
