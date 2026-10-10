# Focus F2 / F4 — 有限焦点过渡与共享呈现时间

日期：2026-10-10。范围：在用户已接受的 F1 紧凑柔光上实现 F2，并接入 F4 的 H/L 呈现时间。代码、自动检查、部署和下列实机状态检查完成；主观视觉验收待用户反馈。F3 gain glow 收敛、F5 四边权重仍未实现。

## 实现与边界

- Rust `FocusFade` 负责 140ms smoothstep 淡入 / 淡出、同目标不重启、快速反向从最后采样透明度接续，以及重复 / 倒退时间戳去重。首个新的真实呈现帧锚定过渡；完成时精确得到 0 或 1。每帧 advance / sample 和 eligibility 查询零分配。
- `m_owner` 仍只观察 KWin 的真实 active window。旧窗口仅保留短暂的退场装饰；Rust `permits_decoration` 不授予焦点，只允许满足既有成员、工作区、输出、可见性等约束的 inactive decoration。没有第二套 JS / Native 焦点 authority。
- Clip 在同步 `prePaintScreen` 链中发布所选的呈现时间值；运行中的 Scroll 使用既有实际 sample time，静态帧使用 compositor prediction，缺失预测才由 Clip 选择现有 monotonic fallback。Ring 只拷贝栈 DTO，按实际输出消费，不保留栈指针，不创建时钟或 timer。嵌套、非真实输出和其他输出不能推进本输出的 fade。
- Ring 的有限 demand token 使没有 Scroll 的静态焦点切换也能使用 Clip 的既有 hooks。只有未完成的 transition 在 `postPaintScreen` 请求局部 scene damage；完成、清理或 effect 销毁释放 demand。
- 原有 post-window paint frame 继续冻结实际窗口 transform / clip，并同时冻结 visual opacity。Rust 将 native item opacity 与 visual opacity 相乘；WindowPaintData opacity 仍只作用一次。柔光纹理只依赖几何 / DPI，透明度动画复用缓存。
- 工作区 / session / target output 改变、禁用、全屏、锁屏、show desktop、全屏 effect 立即清理；关闭 / 删除 / 不再符合 eligibility 的装饰立即移除。显式 clear 使下游保留的旧 attachment 失效，QPointer 保护真实对象生命周期。
- 不改布局、JS schema、Scroll / Spring 参数、Pair / Wide 或快捷键。保留 F1：2 logical px、border alpha .85、Gaussian sigma 1.5、glow alpha .25、extent 6.5、paint outset 7、viewport outset 5、#7FC8FF。

## 自动验证

使用根工具链 Rust / Cargo 1.99.0、`/usr/bin/g++` GNU 16.2.1。所有 configure 显式指定该 C++ 编译器，经共享 toolchain 选择与检查；所有 Cargo build / lint / test 使用 `--locked`。

| 检查 | 结果 |
| --- | --- |
| `cargo fmt --manifest-path native/rust/Cargo.toml --all --check` | PASS |
| `cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --manifest-path native/rust/Cargo.toml --locked --workspace` | 58 / 58 PASS |
| `node tools/check.js --native` | 100 个 JS 测试文件门禁 PASS；Bridge 18、Clip 17、Ring 25 项 CTest 全通过；隔离 DBus 集成和生产 boundary 审计通过 |
| Core `build/rust-Debug` build / CTest | 13 / 13 PASS |
| Core `build/rust-Release` build / CTest | 13 / 13 PASS |
| Native umbrella `build/native-r7-debug` build / CTest | 29 / 29 PASS |
| `BUILD_TESTING=OFF` umbrella 两插件、`build/bridge-r7-production` Bridge | Release build PASS；无 reference target / archive；三个产物 boundary 审计 PASS |
| 编译器拒绝路径 `native-cxx-toolchain-policy` | GNU 16.x 接受；GCC 15 / 17、Clang、非指定路径拒绝。使用既有 metadata configure fixtures；本次未修改工具链规则 |

所有既有 Spring / Motion / Scroll / Ring / Native Protocol Golden differential 保留并通过，未修改 frozen reference。新增 `focus-fade-shared-frame-contract` 覆盖栈 DTO 嵌套恢复、销毁、共享时间、有限 crossfade、重复采样与反向；`focus-ring-fade-paint` 覆盖 100 / 125 / 150 / 175 / 200% 的透明度因子、冻结 transform、纹理复用和 attachment 失效。

日志：`build/focus-f2/native-gate.log`，`/tmp/cc-niri-f2-{core-debug,core-release,umbrella-debug,umbrella-ctest,production-plugins,production-bridge,rust-tests}.log`。初次新增 FFI 空 DTO 断言错用了 INVALID_HANDLE，已改为既有 INVALID_DTO 后完整门禁通过。构建中的旧 differential warning 未作为新问题处理；无构建失败。

## 部署与实机检查

私有备份：`/home/cc/.local/state/cc-niri/backups/focus-f2-20261010-134226`（umask 077）。包含 before / after snapshot、窗口探针、工作区持久化缓存、配置备份、patch、部署命令、门禁日志、实机 capture 和回滚脚本。

按既有 save-state → stop → immutable install Clip / Ring → start 执行，恢复 inactive workspace 的 lazy parking、原 Pair anchor、真实焦点及窗口状态。KWin PID 2050 未重启；配置、输出、组件开关和 Bridge / CLI / JS 产物保持一致。

| 安装产物 | SHA-256 |
| --- | --- |
| Clip | `2d72dfac4932777699e1a76e425e8400eedecabb55822b0d98b186d4f32c2b6f` |
| Ring | `c24ffb397a8a94f027a592d95ba45c9bf97bf9022ae3bf4856aa35d5e5b1a9f9` |

主屏 DP-1：3840×2160、60Hz、150%；副屏 HDMI-A-1：100%。实际执行：

- 两窗口 Pair 的 H/L 与约 60ms 后反向：采样观察到旧 / 新 opacity 从 `[1, 0]` 到约 `[.536, .464]`，反向从已有值连续接续。每次采样只有一个 focused owner。当前 Pair 两窗口均已可见，H/L 没有位移，故不能单靠这组样本证明 H/L motion 同步。
- 七次约 25ms 间隔的连续 / 反向 H/L，含边界同目标输入：所有 opacity 在 [0,1]，随后只有当前装饰、opacity=1、active transition=0。
- 切到已有四列工作区实测真实横向 travel 与约 79ms 后 retarget：47 个 painted Scroll frames，两个 epoch；Ring 与 Scroll 同时 active，采样中旧 / 新 opacity 约 `[.709, .291]`、`[.537, .463]`。不等待 Spring 收尾才开始 fade。实际 Scroll sample 使用 predicted presentation，fallback=0；continuation full repaint=0、fallback full repaint=0。事件 full repaint=9 属既有路径，不声称所有全屏重绘为零。
- J/K 中途反向、Pair / Wide 往返、fullscreen / restore、Ring unload / reload：PASS。全屏时 visuals 立即为空，重新启用后使用共享呈现时间完成淡入。恢复后原窗口、工作区、几何、最小化 / 全屏状态、焦点和 anchor 校验通过，无 KWin / JS / Rust error 日志。
- 1 秒 idle 补充观察：active transition=0、fade repaint request 增量=0、glow rasterization 增量=0；Scroll capture 无 painted motion frame，full / output repaint request=0。Ring drawCount 增量=60，说明桌面仍有普通 compositor repaint，不能写成 compositor 完全不重绘。

实机脚本初次把静态 reload 后 `separateGlowClipDrawCount > 0` 当作必需条件，断言失败但所有动作及状态恢复已通过。静态帧没有 active viewport context 是合法状态；reload 后 `sharedFrameSamples=11` 证明共享时钟生效，真实 travel 样本中 separate glow clip draw 计数已增加。保留 `short-platform-check/failure.txt` 与原结果，修正断言，并用独立 idle 观察补全验证；最终结果在 `short-platform-check/result-corrected.json`。

## 性能与限制

- Rust 热路径零分配；C++ visual / FFI handle 在焦点事件创建，opacity-only 绘制复用现有 8 patch 柔光纹理。两个短暂装饰的总纹理计数可达 16，退场删除后回到 8。
- 没有 timer、永久 opacity 更新、独立 Ring motion runtime 或全屏动画 repaint 循环。保留动态状态统计用于检查完成与 owner，不在 paint 中解析 JSON。
- 实机状态 / trace 不等于显示像素测量或用户主观验收。未录制 GPU 像素级视频、没有 paint-to-present 一一关联或端到端延迟 / GPU 时间 / 功耗基准。
- OS 拒绝读取 `/proc/2050/maps`，因此核验了 installed immutable 文件 hash 和运行中的 F2 API / 行为，未独立取得进程映射文件 hash。
- 125 / 175 / 200% 由真实 SDK CPU renderer / geometry 测试覆盖，本次没有对应实体输出。实际关闭 / 最小化发生在 fade 中、锁屏、输出拔插、maximize / restore 尚未做实机操作；Core eligibility、对象销毁和 captured attachment 失效测试覆盖相应基础约束。
- F2 / F4 的视觉手感仍待用户确认。F3 glow gain 收敛与 F5 weighting 不在本次实现范围。

## 回滚

运行备份中的 `rollback-component.sh`：stop、原子恢复旧 immutable Clip / Ring discovery link、start。旧组件保持在安装目录中；不整体覆盖 kwinrc / 工作区文件，不重启 KWin，不回退其他已安装组件。

旧 Ring：`afa7c40537b61c57b6b36c6f6082eece602a7984346b9abc4782cd1a4fafc7df`；旧 Clip：`8cefef2a59fd9c18f76c8d680b131067bb74f7b3cadf3218e567b0a7757d2e66`。两个组件应一起回滚，以恢复 F1 的整套呈现契约。
