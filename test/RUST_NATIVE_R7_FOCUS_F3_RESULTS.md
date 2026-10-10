# Focus F3 — 轻微 gain glow 收敛

日期：2026-10-10。F3 已实现、通过门禁并安装，实机状态 / trace 检查通过；主观视觉验收待用户反馈。保留 F1 的已接受参数与 F2 / F4 的共享呈现时间。F5 四边 weighting 仍为可选未实现阶段。

## 实现范围

- 新获得焦点时，140ms 内从较宽的 7 logical px 柔光轮廓收拢到原有 6.5px 轮廓。文档中的 7 → 5.5 是建议值；本次按用户已接受的紧凑 F1 静态范围选择 7 → 6.5，最大仅增加 .5px。
- 使用两个固定 Gaussian profile 的互补权重混合来实现收敛，并非每帧生成新半径的 Gaussian。Rust `FocusFade` 在原有 opacity 曲线 / 共享 timestamp 上同时推进 `glow_mix`；不新增时钟、timer 或 focus authority。
- 只有完全不可见的新 gain 才以宽轮廓开始。失焦时冻结当前 profile，仅淡出 opacity；中途重新获得焦点从当前 opacity / mix 接续，避免把可见光晕重新撑大。同目标、重复 / 倒退帧不重启。
- 每个 profile 保留原有 .25 的峰值 alpha，两份权重之和为 1；source-over 混合不会高于两份 profile 的峰值上限。清晰边框、颜色、窗口几何和圆角不参与 scale / pulse。
- 较宽 profile 首次需要时创建，固定几何 / DPI 下 opacity / mix 更新只复用纹理。完成时隐藏宽 profile 并保留缓存以备快速重获焦点；原静态 profile 的像素和强度保持不变。
- Paint frame 同时冻结 opacity 和 mix，继承已有 render transform / clip / owner-output restriction。两份 glow 一起使用 decoration clip，清晰线条保持原 clip。五档缩放中较宽 profile 的 native-rounded support 均小于既有 8px 列间隙。
- 修正 unchanged attach 每次 prepaint 重置 damage marker 的路径：保留 paint 已解析的 device-rounded damage，只在真实 attachment / geometry / radius 变化时重设初始 bounds，避免静态 logical / device bounds 往返造成重复 damage。
- FFI 为新增 query / capture 入口，原 F2 opacity Sample ABI 保持不变。Rust 校验 gain mix；C++ 只管理 handle / Scene Item 生命周期和绘制。

静态值保持：#7FC8FF、border width 2、border alpha .85、Gaussian sigma 1.5、glow alpha .25、glow extent 6.5、paint outset 7、viewport outset 5。JS schema / layout / membership、Scroll / Spring / Workspace / Pair / Wide / 快捷键不变；没有修改 frozen reference。

## 自动验证

工具链使用根固定 Rust / Cargo 1.99.0、`/usr/bin/g++` GNU 16.2.1，configure 显式指定 C++ 编译器，经共享 toolchain 检查，Cargo build / lint / test 使用 `--locked`。

| 检查 | 结果 |
| --- | --- |
| `cargo fmt --manifest-path native/rust/Cargo.toml --all --check` | PASS |
| `cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --manifest-path native/rust/Cargo.toml --locked --workspace` | 60 / 60 PASS |
| `node tools/check.js --native` | PASS；100 个 JS 测试文件；Bridge 18、Clip 17、Ring 25 项 CTest 全通过；隔离 DBus 与 architecture boundary 通过 |
| Core Debug / Release build + CTest | 两种配置各 13 / 13 PASS |
| Native umbrella Debug build + CTest | 29 / 29 PASS |
| `BUILD_TESTING=OFF` Native 两插件 + Bridge Release | build 与三个 production artifact boundary 审计 PASS，无 reference target / archive |
| 既有编译器拒绝路径 | CTest PASS：GNU 16 接受，GCC 15 / 17、Clang、非指定路径拒绝；使用既有 configure metadata fixture。本次未改工具链规则 |

所有既有 Spring / Motion / Scroll / Ring / Native Protocol Golden differential 继续通过。新增 / 扩展测试覆盖：gain / loss / visible regain、同帧和完成、FFI null / mix 范围与零分配，冻结 gain frame，100 / 125 / 150 / 175 / 200% 两份小纹理缓存、alpha 上限、客户端内部透明、support 不进入相邻列、unchanged attach 不重置 resolved damage。

日志：`build/focus-f3/native-gate.log`、`/tmp/cc-niri-f3-{ring-build,core-debug,core-release,core-debug-ctest,core-release-ctest,umbrella-debug,umbrella-ctest,production-plugins,production-bridge}.log`。

## 部署与实机检查

备份目录：`/home/cc/.local/state/cc-niri/backups/focus-f3-20261010-140352`，umask 077。按既有 save-state → stop → immutable install Clip / Ring → start 流程部署；使用保存的实际窗口状态恢复 inactive workspace parking、Pair anchor 和真实焦点。虽然 Clip hooks 未继续修改，其静态链接 Core 已更新，所以安装了同次构建的两个插件。

| 安装组件 | SHA-256 |
| --- | --- |
| Ring | `3e83820d0ed9aa1314cf260031e43978690b17ccdcf37af56d2fd5f6b0924615` |
| Clip | `c2edea38afd2f5abb614adf9fce1da4b39bbc9c03ae385668f4137ecbde8c036` |

KWin PID 2050 未重启。主屏 DP-1 3840×2160 / 60Hz / 150%，副屏 HDMI-A-1 100%。`deployment-success.json` 和 `short-platform-check/result.json` 均 PASS：

- Pair H/L 与约 60ms 后反向：新 owner 的 opacity / mix 从 `[0, 1]` 到约 `[.143, .857]`、`[.642, .358]`。失焦后 mix 保持 .358，opacity 继续下降；重获焦点的旧窗口保持原 profile，从现有 opacity 接续。只存在一个 focused owner。Pair 两列已可见，此组 Scroll painted frame 为 0，不将其当作运动同步证明。
- 七次约 25ms 间隔连续 / 反向 H/L（含同目标边界输入）：opacity / mix 都在 [0,1]，可见 retarget 无 gain mix 增大；最终只有当前装饰，opacity=1、mix=0、active transition=0。
- 已有四列工作区的真实 travel / retarget：47 个 painted Scroll frames，Ring gain 与 Scroll 同时 active；incoming opacity / mix 约 `[.039, .961]`、`[.291, .709]`。continuation full repaint=0，fallback full repaint=0；既有事件 full repaint=9、target output requests=46，capture 未截断。
- J/K 中途反向、Pair / Wide 往返、fullscreen / restore、Ring off / on：PASS。全屏时清除所有 visuals；重新加载后 `sharedFrameSamples > 0`，gain 完成后 mix 精确归零。
- 1 秒 idle：active transition=0、fade repaint request 增量=0、glow rasterization 增量=0；Scroll capture 无 painted motion frame，full / output repaint request=0。验证的是停止主动动画工作，不要求整个 compositor 没有其他 repaint。
- 原窗口、几何、工作区、minimized / fullscreen、焦点、Pair anchor、配置、输出、组件开关与其他安装产物全部恢复；无新增窗口，无 KWin / JS / Rust error 日志。

## 性能、限制与待验收项

- Rust advance / sample / glow query 和 eligibility 查询零分配。每个可见 owner 第一次 gain 会生成两组各 8 patch 的小纹理，之后 mix-only 变化不重建；宽 profile 结束后隐藏并保留缓存，因此稳定状态的累计 rasterization 为 16。两份短暂 decoration 可合计 32 patch。
- 增加的绘制与缓存只作用于 glow；不新增窗口尺寸纹理或全屏 blur pass。几何 / DPI 真实变化仍会更新纹理，本次没有 GPU 时间 / 功耗 / 峰值内存 benchmark。
- 该混合近似收敛轮廓，不是持续变半径的严格单个 Gaussian。在 100% 等部分 native pixel alignment 下，两份 support 宽度可能对齐到同一个像素，因此空间收拢会更不明显；保留设备对齐和克制的幅度。
- 自动 SDK renderer / geometry 覆盖五档缩放，本次实体输出只覆盖 150% / 100%。未录制 GPU 像素级动画或测量 paint-to-present / 端到端延迟；实机状态检查不能替代用户对清晰度、柔光范围和动画手感的主观反馈。
- OS 拒绝读取 `/proc/2050/maps`；核验 installed immutable 文件 hash 及运行中的 F3 API / 行为，未独立取得映射文件 hash。
- 关闭 / 最小化发生在 gain 中、锁屏、输出拔插、maximize / restore 未做新的实机操作；既有 Core eligibility、对象销毁和 attachment 失效测试继续通过。

## 回滚

备份目录中 `rollback-component.sh` 执行 stop → 原子恢复旧 immutable Clip / Ring discovery link → start，恢复 F2 / F4 版本。保留旧文件，不覆盖全份 kwinrc / workspace cache、不重启 KWin、不回退其他组件。

旧 Ring：`c24ffb397a8a94f027a592d95ba45c9bf97bf9022ae3bf4856aa35d5e5b1a9f9`；旧 Clip：`2d72dfac4932777699e1a76e425e8400eedecabb55822b0d98b186d4f32c2b6f`。
