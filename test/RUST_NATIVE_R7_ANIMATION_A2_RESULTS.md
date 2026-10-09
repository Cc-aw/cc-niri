# Rust Native 后续 Animation A2 验证记录

日期：2026-10-09。分支 `feat/animation-60hz`。开发基线为 A0/A1 提交 `d5b1fa7490da77d4a344eb4fc7416949e705edaa`。本轮仅实现 A2 普通 H/L 的速度接管，A3 以后与 Focus Ring F1–F5 未实施。用户要求减少重复实机测试，本轮实机计划为一次短序列。

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

已沿用用户此前的部署授权准备安全 save-state / stop / immutable install / start 入口，限定仅更新 Clip。但首次预检发现真实会话已锁屏，脚本在 save-current-state、stop 和安装前停止。**本轮尚未替换桌面插件，桌面仍运行 A1 的 smooth60。** 预检创建的目录只保存脚本，没有完整桌面快照，不能作为已部署回滚备份。

已请求用户解锁后继续；后续只执行一次短序列：H/L 同向 / 反向、Wide 中途 J/K / 返回、Ring / fullscreen / off-on、窗口关闭、profile 切换和安全 restart / idle。尚未执行的实机检查不标记通过，人工手感仍待实际反馈。A1 长循环的一次焦点准备失败原因仍未查明，本轮不以自动 C1 数值检查宣称该问题解决。

## 性能与限制

自动测试验证的是保存绘制状态的数值连续性，不证明任意墙钟上的实际屏幕轨迹严格 C1。尚未采集新版实机相邻帧位移、呈现 P99 或受控负载，不能给出流畅度 / GPU / 输入到面板延迟改善结论。50ms / 2% 为文档建议的工程起点，尚未经过实机 A/B 调参。核心仅对现有临界阻尼参数做解析范围规划；其他数学状态使用显式安全降级，不改共享 Spring 默认行为。

热插拔、完整 100/125/150/175/200% 矩阵、更多长测和编译压力组未执行。按用户限制不增加重复实机采样；A3、A4 和 A5 的速度 / 收尾 / damage 改进均不归入本轮。

## 回滚

当前桌面未部署 A2，因此无需恢复桌面组件。后续部署会生成新的持久状态备份，保存当前 A1 immutable Clip、AnimationProfile 原值、dirty diff / stage commit、窗口状态及可执行安全回滚脚本；不使用 /tmp 作为唯一备份。

行为回滚将 AnimationProfile 设为 stable，经既有安全生命周期恢复 legacy；若需要保持 A1 呈现时钟而撤回 A2，则恢复部署前 A1 Clip 的 immutable 绑定。先 ./cc-niri stop 恢复 parked windows，恢复失败中止卸载，不强制释放持有窗口的插件，不覆盖整个 kwinrc / workspaces.json。代码回滚采用本阶段独立提交的 revert，保留用户两个未跟踪 todo 文档，不 reset / stash / 自动合并 main。
