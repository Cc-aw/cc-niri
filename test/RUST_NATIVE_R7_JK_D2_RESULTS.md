# Rust Native R7：J/K D2 可选帧时间增量限制

**实现与全部离线门禁 PASS；未部署、未启用，实机验收 PENDING。** Blur/Contrast、420ms曲线、H/L Spring、Pair/Wide、Ring和单列居中不修改。当前用户正在使用的桌面仍为2026-10-14部署的D1a版本，缓存关闭；其“目测比较流畅”反馈不作为D2验收。

## 时间策略与架构

配置：`Effect-cc-niri-viewport-clip / WorkspaceFrameDeltaClamping`，默认false，仅smooth60生效。stable保留原时间/retarget语义；Native状态明确报告该选项要求smooth60。D1a缓存与D2可以独立开关，没有隐式互相启用。

规范建议由Adapter持有每输出逻辑时钟。按仓库Core/Adapter边界，将平台无关的时间限制/回退状态机放在Rust `WorkspaceClock`，存在现有每输出Workspace handle内部；C++只提供KWin预测呈现时间、steady_clock回退值、整数milli-Hz、真实输出paint范围与配置。没有第二套scheduler、timer、后台线程或JS工作区authority。原WorkspaceMotion与五次曲线未修改，原FFI时间戳接口仍保留原语义；新增映射接口只被明确开启的路径使用。

- 首个控制事件建立统一逻辑域，首个真实帧也遵守增量限制；因此切换开始到首帧的长等待也会延后逻辑完成，需要与输入响应分别测量。真实最外层输出帧按刷新周期限制每次逻辑推进，60Hz为ceil(1e12/60000)=16,666,667ns。符合刷新周期的输入保持绝对时间；超过周期的增量（包括轻微节奏抖动）会积累逻辑滞后。
- start/retarget、gesture、advance全部使用同一映射域；mark_painted保持实际非空绘制后的Rust确认。控制事件正常情况下不消耗一帧。retarget的位置/速度/加速度仍由原Rust最后绘制锚点选择，未绘制的预测不能替代它。
- 真实输出范围复用既有固定8层paint路由；虚假/嵌套/溢出pass既不推进也不确认锚点。相同正预测时间标识的frame revision不重复推进；返回父输出后恢复原路由。不同输出各自拥有独立Rust handle。
- 无效/倒退预测、无效刷新率、刷新率变化、超过250ms无帧停顿或累计lag超过250ms，锁定到本binding的绝对时间回退，帧与新控制事件均使用当前绝对时间并保持单调。回退可出现追赶跳跃，明确记录首个原因与次数；不声称它修复了帧。
- 重复的冻结预测超过250ms时允许安全追赶，避免永远卡在同一个预测；停顿后新控制事件先重建绝对起点，避免新动画在恢复帧时立即过期。
- binding完成/销毁、stop/reconfigure、输出移除/geometry/scale、桌面增删、grid或Activity变化、其它fullscreen effect接管后，释放binding或结束其逻辑滞后。刷新率变化也在下一有效帧由Rust回退处理。不开启该选项时保留既有生命周期路径。

**取舍**：曲线仍是420ms逻辑时长，长帧下实际墙钟完成可超过420ms，普通采样量化本身也会多出不足一个刷新周期。不能用逻辑时间代替实际framePresented，不能因此宣称FPS提高或真实长帧消失。

## 可审计数据与资源

Native workspaceMotion增加 `frameDeltaClampingEnabled`、`frameDeltaClampingRequiresSmooth60` 和 `samplingClock`，后者区分logicalNs/realNs/lagMs、clampedFrames、fallbackCount及fallbackReason。原因码：0正常，1无效预测，2倒退预测，3无效刷新率，4刷新率变化，5长停顿/冻结预测，6lag上限。

复用已有3秒/512条capture，在arm/paint/finish记录附加时钟POD；原atMs与实际呈现时间完全不改。JSON只在显式查询构造；无每帧日志/JSON/文件/DBus或GPU同步。新增时钟DTO64字节，每个capture record增加64字节，即固定缓冲增加32KiB；Rust时钟为有界小结构，随已有binding释放，没有按历史操作积累的容器。无新增GPU纹理/FBO、线程、服务或计时器。

全项目PSS、Private_Dirty、GPU归因与30–60分钟增长 **NOT MEASURED**。结构大小/零分配契约不替代16GB全项目预算验收。

## 验证与限制

测试包括59.94/60/120/144Hz正常轨迹、默认关闭的绝对时间、50ms输入限制、保持lag、同帧去重、不同输出隔离、非法时间/刷新率/变率、停顿/冻结预测、lag上限、溢出、idle reset和FFI空指针/所有权/零分配。C++契约使用独立long-double多项式oracle，核对同一真实输入下曲线、实际完成时长、未绘制预测后的反向/同向C0/C1/条件C2、制动边界、gesture及pause。实际Qt paint路由测试覆盖nested/offscreen/overflow并确认不消耗逻辑时间。

| 检查 | 结果 |
| --- | --- |
| Rust fmt/clippy/locked workspace tests | PASS；71项Rust测试，新增clock映射查询零分配契约 |
| 完整node tools/check.js --native | PASS；106个JS文件、116个Node测试，Bridge/Clip/Ring CTest 18/18/25，5个隔离DBus测试、Plasmoid及生产符号边界 |
| Core Debug/Release build+CTest | PASS；各13项，workspace-motion-rust-contract含D2合成时钟/retarget契约 |
| Native umbrella Debug build+CTest | PASS；30项，含实际Qt对象/paint范围契约 |
| BUILD_TESTING=OFF Release两插件+Bridge，production boundary | PASS；无reference/differential/projection测试target，无旧C++算法符号 |
| 编译器拒绝路径 | PASS；实际拒绝/usr/bin/c++，完整CTest中的policy检查保留 |
| DESTDIR候选安装暂存/manifest/nm | PASS；未修改用户discovery链接 |
| 4K60同负载off/on/off实际帧+视觉验收，S01–S14 | PENDING；本轮未部署 |
| 实际FPS、deadline延迟、最大可见跳跃改善 | NOT MEASURED；合成数据不是实机结果 |

构建基于包含单列居中等既有dirty修改的完整本机工作树，独立提交只包含D2新增路径，不覆盖/混入这些先前修改。所有Cargo使用1.99.0与locked，CMake固定/usr/bin/g++ GNU16，构建串行、每次parallel2。

Debug/Release的同一组合成60Hz输入均得到：单次50.000001ms物理间隔时，off/on的最大步幅为0.209061468/0.074317332 cell，墙钟完结433.333/466.667ms。差异约33.334ms来自被限制的两帧逻辑时间；433.333ms包含离散帧的完成量化。两组物理间隔完全相同；不是实际屏幕帧、输入延迟或视觉验收数据。

最终日志：`/tmp/cc-niri-jk-d2-native-final.log`、`debug.log`、`release.log`、`umbrella.log`、`production.log`、`reject.log`、`stage.log`（共同前缀`cc-niri-jk-d2-`）。首次普通沙箱完整门禁在隔离DBus套接字创建时被环境阻止；改用允许本地套接字的离线运行环境后，最终完整门禁通过，未改动用户运行组件或桌面。最终复核补齐绝对时间回退后的控制事件映射，并重新通过全套门禁。源码/产物hash与汇总见 [`diagnostics/JK_D2_VALIDATION_20261014.json`](diagnostics/JK_D2_VALIDATION_20261014.json)。安装暂存SHA：`1c8c3d0174c572e3412d4e1c968bb3811e23e718f9aff7b0be2bc541b6372726`；构建与安装ELF可能因RPATH调整而不同，部署核对以安装字节为准。

## 部署与回退

本轮只开发与离线验证，不改用户kwinrc/discovery链接，不停启用户组件、不主动J/K。取得部署决定后，刷新实际配置/布局/焦点备份，走save-state → stop → immutable Clip安装 → start。选项仍默认关闭；实机比较保持D1缓存及Blur配置固定，分别记录真实framePresented分布、painted pose步幅和实际arm到finish墙钟时间，注明无paint-to-present join。

回退先将新键恢复到测试前值/缺失状态，在idle时同步reconfigureEffect使其生效；如需回退代码，保存当前状态并安全stop，原子恢复D1a不可变Clip链接再start。当前已部署D1a安装SHA `737c5dbf9bbf682ed59a384f52d1676be8cfbeab8b90f4450ac4e35785c4678d`，备份仍在`/home/cc/.local/state/cc-niri/backups/jk-d1a-deploy-20261014-091706`。不回写整份旧kwinrc，不覆盖已映射.so，不重启KWin/Plasma。
