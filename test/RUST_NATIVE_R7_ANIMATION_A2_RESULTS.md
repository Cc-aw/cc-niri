# Rust Native 后续 Animation A2 验证记录

日期：2026-10-09。分支 `feat/animation-60hz`。开发基线为 A0/A1 提交 `d5b1fa7490da77d4a344eb4fc7416949e705edaa`，已验证及部署的 A2 代码提交为 `270638f6f754d4745bf594337e0f981ae74bbf5c`。本轮仅实现 A2 普通 H/L 的速度接管，A3 以后与 Focus Ring F1–F5 未实施。按用户要求减少重复实机测试，只采集一次 H/L 短连按，随后补完因检查脚本错误而中断的生命周期检查。

## 实现范围

- 新策略仅用于 `smooth60` 的普通 Native Scroll；`stable` 的 start / retarget 零初速度与解析求解器保持原契约，Golden reference 未修改。JS 绘制的 partial Pair/Wide clip companion 保持原策略，避免把 companion 数值状态当作真实窗口绘制速度。
- 生产 `ScrollViewportRuntime::arm_with_policy()` 从同一个最近绘制 sample 取 position / velocity / time，开始时间取事件与 sample 时间的较大值。未绘制 pending sample 不参与；同帧多目标继续使用同一个 painted anchor。context / viewport / policy 改变、没有有效样本或已静止时不继承无关速度。
- 同目标且原曲线范围仍安全时只更新 epoch / entries / ownership，保留曲线与原开始时间；重复 / stale / 失败后已消费 epoch 的既有规则保持。`keep` 的 origin、初速度和制动字段描述保留的原曲线，不是新启动的 v0。
- Rust 新 `scroll_retarget.rs` 检查临界阻尼 Spring 的唯一有限转向点和完整范围，安全则直接携带 v0。需要制动时采用常减速度段，位置 / 速度连续，随后接零初速度的原参数 Spring；不要求制动边界 C2。
- 制动最长 50ms，反向额外位移最多安全逻辑视口宽度的 2%，并受已持有窗口 footprint 的外侧覆盖范围限制。该范围来自既有 plan / retained Outgoing，不建立第二套布局或工作区边界 authority。没有有效空间、覆盖不足、数值不合法时保留位置、显式清零速度，分别计数原因。
- 不对每帧位置 clamp，不叠加按键次数产生额外速度，不先绘制旧目标一帧。Spring mass=1 / damping=1 / stiffness=800 / epsilon=0.0001、3s 安全截止、J/K 曲线、Ring 外观及 repaint 范围未改。

## Adapter / FFI / 观测

保留原 `cc_niri_scroll_arm()` 为 legacy 入口，增加窄 `cc_niri_scroll_arm_with_policy()` 标量 flag。C++ 只转发 profile / Qt DTO、管理 handle、输出时钟及绘制，不实现制动 policy。Scroll v2 与 Ring v1 JS schema、发布 authority 和 Core 边界均保持。

`CcNiriScrollRetargetStatus` 为 120 字节值 DTO，包含 carry / brake / keep / reset 计数、各降级原因、原曲线初速度 / 保存速度、制动时长 / 位移和覆盖边界。查询不读时钟、不分配。`GetScrollMotionStatus()` 输出这些实际 Core 值；capture v1 添加 arm 策略和 initialVelocity，旧字段保持。新增记录只在事件边界或既有采样路径；未增加 timer / repaint / 每帧 JSON。离线分析兼容旧 capture，另报告首个 sample 相对 arm anchor 的物理步进；keep 或截断起点不将原曲线 origin 误当新 anchor。

## 自动验证

工具链 Rust / Cargo 1.99.0、`/usr/bin/g++` GNU GCC 16.2.1，Cargo 均 --locked，构建 / CTest 并行上限 2，门禁顺序执行。Cargo.lock 未修改，未改 src 或生成包。

| 项目 | 结果 |
| --- | --- |
| cargo fmt --all --check | 通过 |
| cargo clippy --locked --workspace --all-targets -- -D warnings | 通过 |
| cargo test --locked --workspace | 40 项通过 |
| node tools/check.js --native | 100 JS 回归；Bridge 17 / Clip 16 / Ring 23 CTest；5 组隔离 D-Bus、Plasmoid 和生产符号审计均通过 |
| Core Debug / Release configure / build / CTest | 各 12 项通过 |
| Native umbrella Debug configure / build / CTest | 27 项通过 |
| BUILD_TESTING=OFF Clip / Ring / Bridge | 构建及生产符号边界通过，target help 无 reference / differential target |
| C++ 编译器拒绝路径 | CTest fixture 覆盖非 GNU、GCC15 / 17、非指定路径拒绝；实际 GNU16 configure 通过 |
| Rust / Cargo 非指定版本 | 两个独立 configure 元数据 fixture 分别拒绝 1.98.0，无其他版本 Rust 构建 |

完整命令、退出码与用时在 `build/animation-a2/results.json`，附加拒绝检查在 `additional-checks.json`。初轮 C++ 新夹具错误地包含 parked/parked 条目，随后同目标夹具缺少 retargetOnly 标志，两次门禁失败均来自无效测试协议。修正夹具后定向 FFI 契约和完整门禁通过，未放宽生产验证规则或修改 reference。最终 gate 日志覆盖完整通过快照。

新增核心检查直接使用生产 arm，覆盖 30/60/120ms 同向、20/50/130/250ms 反向、同帧目标、同目标曲线保留、pending 与 painted 分离、关闭覆盖边缘窗口的显式降级、输出隔离 / partial companion、completion 后 Outgoing 保留。C0/C1 使用有单位的绝对加相对容差；转向范围由独立 RK4 ODE 交叉验证。制动拼接端点、无空间 / 非法数值 / 覆盖降级独立检查，帧及新增 FFI 查询零分配通过。

## 部署与实机状态

首次预检在锁屏时停止，未执行 save-current-state、stop 或安装。用户解锁后，沿用已有部署授权执行 save-current-state → 安全 stop（确认 parked windows 恢复）→ 既有 immutable Clip installer → start，仅替换 Clip。持久备份为：

`/home/cc/.local/state/cc-niri/backups/animation-a2-20261009-151035`

备份包含原配置键的存在性与值、实际窗口 / 输出 / 工作区快照、workspaces.saved.json、组件路径与 hash、CLI、代码提交 / dirty diff、两个用户未跟踪文档、部署命令和安全回滚脚本。安装后 canonical Clip 为：

`/home/cc/.local/lib/cc-niri/viewport-clip/b805cde6130d137dd3717d1ac00d939e39b5ea6bfd1fe96d98fc061991abc9a7/cc-niri-viewport-clip.so`

安装文件 SHA-256 与 immutable 目录名一致；已显式卸载 / 加载并验证新 A2 status / capture 字段、Rust backend。OS 拒绝读取 `/proc/2050/maps`，因此**未独立验证 KWin 实际映射文件的 hash**。Ring、Bridge、CLI、JS 包、输出设置与非本任务配置均保持。KWin PID 2050 未变；最终有效 profile 为 `smooth60`，工作区优化 true / 420ms，Slide false。

实机使用 DP-1 3840×2160 / 60Hz / 150% 与 HDMI-A-1 2560×1440 / 60Hz / 100%。检查结果：

| 场景 | 实际结果 |
| --- | --- |
| 单次 L L H H，间隔约 30ms | 实际生产 carry / brake 使用非零 savedVelocity，初速度与 savedVelocity 一致；结束释放 motion，Ring owner 正确，无 clock fallback 或 retarget 降级 |
| Wide 开始约 75ms 后 J/K 离开 / 返回 | 返回同一 Wide owner，真实窗口保持 Wide 宽度；退出后 Ring 正确 |
| Full column / fullscreen / restore | Full Ring 正确；fullscreen 抑制 Ring，恢复后重新附着 |
| Ring off / on | 卸载与恢复成功，owner 正确 |
| 运动中关闭临时目标窗口 | 关闭前确认 motion active，关闭后列移除、motion 结束、焦点与 Ring 回退成功 |
| 运动中 smooth60 → stable → smooth60 | 重配置清理 motion，恢复后普通滚动与 Ring 正常 |
| 安全 restart 与原状态恢复 | 原窗口顺序 / 宽度偏好 / 工作区归属 / minimize / fullscreen、实际与 Bridge 焦点恢复；副屏原窗口 geometry、桌面拓扑、组件与配置核对通过 |
| 静止 1s / KWin 日志 | 插件 full repaint requests 为 0，paintedSamples 为 0；无 TypeError / ReferenceError / SyntaxError / invariant / fail-safe / completion timeout / Rust panic 记录 |

短序列的第一次 Wide 断言在返回后程序化切到了另一个临时窗口，现有 contextual viewport 规则会因此选择 Pair。读取源码与既有回归确认该预期后，仅修正检查顺序、补完尚未执行的检查，没有重跑 H/L 连按或修改生产代码。第一次清理的实际焦点断言也过早，随后独立快照确认焦点与所有原状态已恢复；补完脚本改为等待实际 KWin 与 Bridge 一致。原失败记录均保留。

补完脚本最后的“窗口集合必须完全等于旧快照”断言未通过：基线后出现一个非测试窗口，PID 2208062，与本轮四个 owned client PID 均不同。保留该窗口，以已记录的 teardown 快照逐项核对原窗口和工作区偏好为有序子集，全部通过，四个测试窗口均已移除。之后该新增窗口获得焦点、原窗口按正常滚动规则被 parked；保留现场的新状态，没有覆盖工作区文件或再次强制原焦点。恢复时刻与后续观察分开保存在 `remaining-a2-acceptance/acceptance-summary.json`、`later-observation.json`，原 exact-set 失败结果仍保留。

证据在备份的 `short-a2-acceptance/` 与 `remaining-a2-acceptance/`；前者保存一次 H/L capture，后者保存剩余功能与恢复快照。人工手感仍待实际反馈。A1 长循环的一次焦点准备失败原因仍未查明，不以本次检查脚本修正或数值 C1 检查宣称它已解决。

## 性能与限制

一次 H/L capture 共 45 个 painted samples，全部来自 DP-1；sampleMs 等于 predictedMs，fallback 为 0，数据未截断。生产 arm 记录同向 carry v0=12076.469 logical px/s；反向 brake v0=18024.953 logical px/s，制动 5.574494ms、额外位移 50.239995 logical px，小于安全视口 2512px 的 2%（50.24px）且小于 50ms 上限。短连按有被下一目标覆盖的控制消息，因此 4 次输入不等于 4 条独立绘制曲线。

| 输出 | 呈现间隔数 | P50 / P95 / P99 / max（ms） | >25ms |
| --- | --- | --- | --- |
| DP-1 | 48 | 16.667 / 16.728 / 16.782 / 16.828 | 0 |
| HDMI-A-1 | 49 | 16.667 / 33.340 / 33.397 / 33.398 | 5 |

该副屏没有 Scroll painted sample，呈现观测仅按输出关联，不构成 paint-to-present join。持续 repaint 仍是旧 full 范围，本次 capture 计 107 个请求；A5 尚未缩小范围。三条有绘制曲线的相邻物理步进最大值分别为 318.599 / 526.944 / 76.252px；这是短连按不同目标与速度下的描述值，没有配对 stable A/B，不能当作改善证据。最后反向曲线采样 T95=183.276ms、双物理可见阈值=366.772ms、数值完成=649.981ms，完成 sample 仍持有 ownership，既有 cancel 于 capture 759.559ms 请求；没有将数值完成提前当作生命周期释放。

离线分析为 `build/animation-a2/live-retarget-analysis.json`，亦复制到持久备份。小样本、非受控负载的 P99 不代表长期稳定性。自动测试验证的是保存绘制状态的数值连续性，不证明任意墙钟上的实际屏幕轨迹严格 C1，也不证明流畅度 / GPU / 输入到面板延迟改善。50ms / 2% 为文档建议的工程起点，尚未经过实机 A/B 调参。核心仅对现有临界阻尼参数做解析范围规划；其他数学状态使用显式安全降级，不改共享 Spring 默认行为。

热插拔、完整 100/125/150/175/200% 矩阵、更多长测和编译压力组未执行。按用户限制不增加重复实机采样；A3、A4 和 A5 的速度 / 收尾 / damage 改进均不归入本轮。

## 回滚

行为回滚将 AnimationProfile 设为 stable，经既有安全生命周期恢复 legacy；该模式切换已在本轮运动中检查通过。若要保留 A1 呈现时钟而撤回 A2，执行持久备份目录的 `rollback-component.sh`：先 `./cc-niri stop` 恢复 parked windows，恢复失败即停止；恢复原 A1 immutable Clip `2d11b47e9da1297ab4eea5a4b2523273c6b55edd904f07f5890b944c64da885a` 绑定、原 AnimationProfile=smooth60，再 start。已准备脚本，未为测试目的重复执行组件回滚。

不强制释放持有窗口的插件，不覆盖整个 kwinrc / workspaces.json；备份仅供故障恢复调查，保留用户在测试期间与之后的新窗口 / 工作区状态。代码回滚对独立 A2 提交 `270638f` 做 revert，保留两个未跟踪 todo 文档，不 reset / stash / 自动合并 main。
