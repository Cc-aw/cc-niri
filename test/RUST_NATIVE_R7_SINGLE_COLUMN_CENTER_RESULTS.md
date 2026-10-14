# AlwaysCenterSingleColumn 开发与部署结果（实机视觉验收待确认）

日期：2026-10-13；HEAD 基线 `b77a40eb1e0a0fd66d053c5996a13bc88e75518b`，当前工作区未提交。依据[居中规范](../doc/todo/cc-niri_always-center-single-column_Codex_Spec.md)、根/native AGENTS 和 [16GB 资源规范](../doc/todo/iA%20Writer.md)。

**P1–P4 的代码实现已补齐，默认关闭；必需离线门禁全部通过，包含最后 JS 边界补充后的完整复跑。已在后续授权下部署并开启，S01–S14 实机视觉验收尚待确认，不标记功能 DoD 完成。** 开发阶段遵照用户保留桌面的要求，没有配置写入、安装、stop/start、KWin/Plasma 重启或真实窗口操作。后续部署授权及结果见文末。内存 B0/B1 测量仍暂停。

## 已实现

| 阶段 | 实现与离线覆盖 |
| --- | --- |
| P1 | KConfig/UI/RuntimeConfig 的 AlwaysCenterSingleColumn，默认 false；固定 Virtual Leading Inset、有限输入处理、InvariantChecker 共用几何函数 |
| P2 | 主屏单 half 居中，单 Full 100%，多列 Pair / H/L；空工作区、快照 roundtrip、旧快照、关闭配置回退、工作区迁移；副屏、Wide、Floating、Dialog、Fullscreen 沿用原语义 |
| P3 | 同 logical 基准的 1→2 右插入、2→1 右移除走现有 Rust SCROLL；membership ACK → publish ACK → Native arm ACK → geometry → activation；列变更本身一次 generation，保留原生 windowAdded 等独立事务 |
| P4 | 关闭左窗/左插入通过独立 COLUMN_REINDEX 进行 Native 连续投影；在途基准重排接管最后实际 painted pose；迟到 ACK、快速反向、同偏移成员变化、取消超时与 focusNew=false 边界覆盖 |

W=2512、gap=8 时 half=1252、L=630。单 half 的 logicalX=630 / camera=0；两 half 的 logicalX=630,1890 / camera=630；单 Full 的 logicalX=630 / camera=630。strip 取最后列右边缘，offset 仍受原 [0,max(strip−viewport,0)] 上限约束；不会为居中放宽负 SCROLL offset 或扩大 bound。

开关只影响当前主屏 Column 布局，没有新 widthMode、viewport mode 或持久快照字段。默认 false 的正常输入保持原坐标。adoption settling 不取消刚 arm 的 Spring；focusNew=false 的左插入保留原窗口实际焦点并 reveal 幸存列。同偏移成员变化遇到 pending gate 或尚未完成的 Native parking batch 时，使用原 retargetOnly，保持幸存窗口的在途 motion。

## P4 协议、投影与回退

先记录[协议与回滚设计](../doc/todo/cc-niri_single-column-reindex-protocol.md)，再实现独立 `COLUMN_REINDEX`（protocol 2）。它复用原 IPC endpoint、Rust sequence/runtime、Spring、output presentation clock、paint/clip context 和 Ring transform。额外字段只有 sourceWindowId/sourceLogicalX；entries 使用新 logical 基准，old/new wire offsets 仍有限且非负。

Rust 校验唯一旧 visible 源、同宽半列、最多两个 entries、placement、数值和 epoch。新类型仅允许完整可见的源和目标；ordinary SCROLL validator 与冻结 Golden 不变。Adapter 转换 Qt 值、核对实际输出/桌面/源 frame，管理 FFI handle 和 ownership，不加入布局或 Spring policy。

Rust 定义 basisShift = newLogicalX − sourceLogicalX。关闭左窗：1890→630、camera 630→0，internal from=−630；source 首帧 x=safe.x+1260，末帧 x=safe.x+630。左插入：630→1890、camera 0→630，internal from=1260。内部 rebased camera 不写回 JS offset，也不伪造负 SCROLL wire plan。在途时校验原基准，再将最后实际 painted camera 加 basisShift；未绘制的预测 sample 不作为起点。速度依照既有 bounded Spring 的 carry/brake/reset 规则处理，参数不变。

现有 SCROLL render ownership marker 表示共享 strip renderer，并非 wire 类型；继续用于抑制 legacy geometry 动画。实际 wire 类型始终 COLUMN_REINDEX，不借用 PAIR_TO_WIDE/WIDE_TO_PAIR，不新增 Ring motion owner。

membership/publish/arm 拒绝、超时、旧插件不支持、基准或实际 frame 不符时，取消当前 epoch，待 ACK 或既有有限期限后提交合法静态几何。隐藏源、宽度/安全区变化走静态回退；迟到回调不能重放几何/激活。工作区离开、空工作区、窗口关闭、输出移除和卸载复用既有清理。取消 ACK 永不返回的本地请求现在也有 150ms 期限，回收 disarming/timer/idle closure，避免历史请求积累。

FFI 是追加接口：旧 ScrollPlan DTO 仍 184 bytes，新 ReindexPlan 为 200 bytes，全部嵌套 buffer 仅同步调用期间借用。新增 arm_reindex / sequence_reindex；Bridge 与两个插件仍只链接 Rust policy。Cargo.lock、CMake 策略、冻结 reference、Spring 参数和工作区/快捷键 authority 未改。

## 验证

工具链：rustc/cargo 1.99.0；/usr/bin/g++ GNU 16.2.1；Cargo 全部 --locked；构建并行数 2，大型构建顺序执行。

| 检查 | 结果 |
| --- | --- |
| node tools/build.js / --check、node tools/check.js | PASS；最后新增 focusNew=false / 同偏移在途分支的完整复跑见下 |
| cargo fmt --manifest-path native/rust/Cargo.toml --all --check | PASS |
| cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings | PASS |
| cargo test --manifest-path native/rust/Cargo.toml --locked --workspace | PASS：65 项 |
| node tools/check.js --native 首轮 | PASS：105 个 JS 测试文件 / 113 项 Node；Bridge/Clip/Ring CTest 18/17/25，五组隔离 D-Bus、Plasmoid、Qt JS、生产边界 |
| 最终完整 Native 复跑 | PASS：113 Node / 65 Rust、Bridge 18/18、Clip 17/17、Ring 25/25，五组隔离 D-Bus、Plasmoid 与生产边界全部通过；/tmp/cc-niri-reindex-native-final2.log |
| Core Debug / Release 构建与 CTest | PASS：各 13/13，包含 Spring/Motion/Scroll/Ring/Protocol 冻结 Golden、Rust 契约、FFI smoke、compiler policy |
| umbrella Native Debug 构建与 CTest | PASS：29/29 |
| BUILD_TESTING=OFF Release Bridge / 两插件 | PASS：构建通过，help 中无 reference/differential target，nm 边界检查通过 |
| 编译器 configure 拒绝 | PASS：GNU 16 接受；非 GNU、GCC 15/17、其他 C++ 路径拒绝。另以临时 --version fixture 核验 Rust/Cargo 1.98.0/1.100.0 在 configure 拒绝，未用这些版本构建 |
| 新 Native 数学与生命周期契约 | PASS：关闭左窗首/末投影，左插入、预测不替代 painted pose、快速反向、普通 SCROLL 接回新基准、stable/smooth60、失败 epoch、复制冻结与关闭清理 |
| 新 typed 协议边界 | PASS：缺源/错类型、未知 UUID、负/非有限数、宽度/placement、重复 owner/列、超量、epoch 与 source fingerprint conflict；原 SCROLL 负偏移仍拒绝 |
| 实际 Bridge canonical / legacy 隔离 bus | PASS：新 UUID 先 State；左插入/关闭左窗、信号 FIFO、duplicate、shared epoch、错源类型、普通 SCROLL 恢复新基准；调用前核对服务 owner PID |
| 5000 次取消 ACK 丢失/迟到模型 | PASS：本地 request/timer 回到零，回调幂等；已有两组 5000 次 Ring/state/snapshot 清理回归保留 |
| S01–S14、混合 DPI、真实呈现 / 输入 / Ring | PENDING：统一实机验收，未运行 |
| 特性及整套项目 PSS/GPU 增量 | NOT MEASURED：未建立受控 B0/B1，不能据包大小或零分配宣称预算通过 |

日志：首轮完整门禁 /tmp/cc-niri-reindex-native-final.log；最终 /tmp/cc-niri-reindex-native-final2.log；Core /tmp/cc-niri-reindex-debug-final.log、/tmp/cc-niri-reindex-release.log；umbrella /tmp/cc-niri-reindex-umbrella.log；生产 OFF /tmp/cc-niri-reindex-production.log。D-Bus 测试在获准的独立测试会话运行，不连接用户桌面。

开发过程中首次 C++ 契约构建发现新 source 局部变量与已有变量重名，已改名后重跑通过；JS fixture 的跨 VM Array 比较与 windowAdded 独立 generation 计数修正后通过。新失败 epoch 测试区分 motion epoch 与消费过的 sequence barrier，没有放宽协议、改 Golden 或跳过失败检查。首轮全绿后继续补齐左插入不抢焦点、同偏移成员变化不取消在途中心 motion，并做最终完整复跑。

## 性能、范围与限制

没有新增服务、线程、Native/JS 动画时钟、Scene Item、纹理、逐帧 JSON 或诊断捕获。新增元数据最多两列；同一个 Rust handle 使用已有 map 和 Spring。新增帧 prepare/paint/projection 查询在 Rust allocation counter 下零堆分配；不等于整个 compositor 或 GPU 零分配。

取消期限 timer 只处理协议完成，不插值动画；ACK/期限清理本地集合和 timer。底层 D-Bus callback、真实 QObject/GPU/allocator 收敛与长期 PSS仍未测，本轮不声称解决全部内存账本热点。Bridge deferred admission、输出历史 barrier 等未量化项仍保留。

奇数 viewport 宽度沿用 floor 和原 strip bound，可能保留 1px 对齐差异；混合 DPI 与 SDK clipping 最终看实机。真实 Wayland configure/frame ACK、第一/末呈现帧、Ring 边界和快速输入尚待统一验证。普通 SCROLL / 新类型的自动契约不能代替这些视觉项目。前一轮 J/K 单次约60fps观测不是本功能性能证据；不宣称解决用户卡顿。

## 统一实机验收清单

全部实机项当前 PENDING，禁止用离线 PASS 替代：

| ID | 验收内容 | 当前证据 |
| --- | --- | --- |
| S01 | 空→单 half 居中 | 布局/runtime 离线 PASS |
| S02 | 右侧新增→Pair | ACK/Bridge/Scroll 离线 PASS |
| S03 | 关右窗→中心 | Scroll/焦点离线 PASS |
| S04 | 关左窗、左侧插入 | typed 基准/首末数学投影/在途反向离线 PASS，视觉未测 |
| S05 | half ↔ Full | runtime/宽度偏好离线 PASS |
| S06 | half ↔ Wide | runtime/既有 Wide 回归 PASS |
| S07 | 3–5 列 H/L 后剩单列 | 布局/runtime 离线 PASS |
| S08 | J/K 空/单/多工作区 | 状态隔离/旧 ACK 离线 PASS |
| S09 | 相邻/数字 move-and-follow | workspace/runtime 离线 PASS |
| S10 | Dialog / transient / modal | 排除与焦点离线 PASS |
| S11 | 主副屏独立安全区 | 既有副屏回归 PASS，实机未测 |
| S12 | 4K150%+2K100%、100–200% clip/Ring/输入 | 原有渲染/HiDPI CTest PASS，新特性 capture 未测 |
| S13 | stop/restart、Bridge 暂不可用 | snapshot/拒绝/timeout 离线 PASS；实机恢复未测 |
| S14 | false 回退与重启 | 默认/旧快照/配置回退离线 PASS |

实机时记录 KWin/Plasma/Fedora 版本、两屏模式/缩放、配置、截图/短视频、frame capture、Bridge/Native 状态及回滚路径。需验证 stable 与 smooth60、在途 H/L/J/K、快速开关十轮、fullscreen/output 清理；资源指标按全项目文档另建 B0/B1。README 和 doc 索引已标明开发实现与未部署/待验收，设计保留在 todo。

## 文件与回滚

JS：ColumnLayout、SingleColumnTransition、ScrollMotionPlan、ScrollPlanCommitGate、RuntimeConfig、RuntimeBridge、InvariantChecker；main.js 仅手写入口部分修改，模块由 tools/build.js 生成。配置：main.xml / config.ui。Native：Rust protocol/runtime/FFI/header，Qt DTO/sequence/runtime adapter、Bridge type 路由和 effect 源 frame 转换；测试覆盖上述路径。根 AGENTS 增加低内存约束。保留用户原有副屏报告、layoutEligibility fixture 修复与文档，不整库 reset。

没有部署，无需回滚当前桌面。已安装 main.js SHA-256 仍 94145022b0303d541afe6b445c4670763ebec251e4dac46769a7af73552a4869，302988 bytes。开发包 314616 bytes，相比安装包增加 11628 bytes，只代表源码，不代表 PSS。

统一验收前先备份 kwinrc、workspaces.json、旧 KPackage 和原生产物；走既有 save-state → stop → immutable install → start。Bridge 与 Native 插件配套更新；本次虽为追加 ABI，仍核对所有消费者和安装字节。回退可关闭 AlwaysCenterSingleColumn 并按既有 restart 恢复原布局，或按 rollback-component.sh 回退配套产物。发生黑屏/停车区问题优先既有 emergency restore，不强杀 KWin、不强制重登。


## 2026-10-13 配套部署并启用

用户随后明确“开始部署”，并选择“开启，准备验收新功能”。按既有 install.sh 默认 core 流程执行，构建并行数2：备份 → save-current-state → 安全 stop/窗口恢复 → immutable Clip/Ring 安装、Bridge 与两个 KPackage 升级 → start。未使用 --with-dock，没有重启 KWin/Plasma、强杀或重登，也没有创建/关闭用户窗口做压力测试。

备份及完整日志：`/tmp/cc-niri-single-center-deploy-20261013-3rdtygjp`；包含 before/after live state、kwinrc、快捷键、旧包、CLI/Bridge/unit、旧插件链接与字节、输出、Native 状态、install.log、verification.json、journal、配置差异、独立 DESTDIR 字节审计。配套回滚入口：`rollback-component.sh`（恢复本次部署前保存的组件、配置与快照，再按普通 CLI start 启动）；临时目录重启后可能清理。

2026-10-13 05:56:52 UTC（13:56:52 CST）的核验：

- PASS：AlwaysCenterSingleColumn=true；脚本及三个 CC Effect 加载，Bridge active；Scroll/Protocol/decoration/Ring 生产 backend 为 Rust。
- PASS：KWin PID仍2062；输出配置完整JSON与部署前一致；smooth60、优化工作区动画开启及420ms时长保持。
- PASS：各工作区 UUID顺序、half/full偏好、记忆焦点和presentation均保留。活动workspace从部署前的2列工作区变为另一3列工作区；未归因于用户并行操作或恢复时激活，所以不标记全局活动workspace/实际焦点完全保留，也未擅自切回旧桌面。
- PASS：kwinrc唯一最终差异为新增 AlwaysCenterSingleColumn=true；Dock及其他配置保持。
- PASS：独立DESTDIR安装结果与已安装Bridge/compat shim、两个插件全部SHA-256一致；两个KPackage全部源文件与安装文件一致；CLI与源字节一致；已安装三个Native产物再次通过生产符号边界。
- 启动观察区间 TypeError/ReferenceError/SyntaxError/INVARIANT_FAIL/FAIL_SAFE/Rust panic/native fallback/crash 计数均0。该短期检查不代替长期运行、第一/末呈现帧、输入或用户视觉验收。

| 已安装产物 | SHA-256 |
| --- | --- |
| 布局 main.js（314616 bytes） | 2154436e0c97251eecadadd13bb533dfedfd2146cb0dd1fff34693ad6c9814f2 |
| Bridge | 2f923a1a158fafb3bf61bf7234aa13562702d164ba97e904b116e3823d76b3f6 |
| Clip immutable | 024557e2565edd03796136671eda16c91bbf64985ebb568a1727f7893d04be3a |
| Ring immutable | 994e939d1c9e314d150728b13dbc250adc462f5deef652bb857f2d76716defa4 |

产品默认false保留，本机明确启用true。S01–S14和资源实测仍按上表待统一验收；没有用成功部署代替新特性视觉通过。


## 2026-10-13 用户重启后检查

用户反馈重启后明显 J/K 卡顿消失。只读启动核对 PASS：Bridge、布局脚本、三个效果正常运行；单列居中仍开启；安装脚本 SHA 与本次开发包一致；Rust backend、smooth60 与 420ms 保持。12 次 J/K 短时采样全部接受；最长呈现间隔约50ms，未再观察到重启前约100ms长空档。原工作区、实际焦点、两个输出桌面恢复验证 PASS。

详见 [JK 诊断与重启后复测](JK_STUTTER_DIAGNOSTIC_20261013.md)。该轮是2列↔2列，单列居中 S01–S14 仍 Pending，不以成功启动或主观不卡顿替代功能视觉验收。重启前后窗口负载不同，性能根因仍 INCONCLUSIVE；未修改生产实现，本轮不重跑 Native 门禁。

之前 `/tmp/cc-niri-single-center-deploy-20261013-3rdtygjp` 部署备份已被重启清理，文中旧回滚脚本目前不可用。后续升级或组件回滚前必须先建立新的持久备份，不应直接执行不存在的旧路径。
