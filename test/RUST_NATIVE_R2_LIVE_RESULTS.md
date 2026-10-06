# Rust Native R2 内屏实机验收记录

日期：2026-10-05。状态：已部署并启用 Rust Motion；加载检查及两轮人工验收通过，R2 内屏功能 / 视觉验收完成。源码两个迁移开关仍默认 OFF，本次单独使用 ON/ON 构建，不表示默认生产切换或阶段最终验收完成。

后续状态：R4 独立 Rust Scroll 构建已部署，当前桌面与待验收范围见 [R4 记录](RUST_NATIVE_R4_RESULTS.md)。本记录中的 R2 immutable 插件继续作为 R4 回滚基线，两轮反馈只覆盖 R2。

## 部署

- 复用 `build/native-r2-on`，Rust 1.99.0、GNU GCC 16.2.1、RelWithDebInfo、Spring / Motion ON。安装前重新构建及 22 项 Native CTest 全部通过，日志 `/tmp/cc-niri-r2-live-build.log`。
- 仅发布 Viewport Clip，新 immutable canonical：`/home/cc/.local/lib/cc-niri/viewport-clip/235122ab1af1e93718f544f5282b53332affa87e230bf482382c757c336595de/cc-niri-viewport-clip.so`。安装哈希 `235122ab1af1e93718f544f5282b53332affa87e230bf482382c757c336595de`；验证产物包含 RustViewportMotion / cc_niri_motion 符号与构建开关。
- Bridge、已安装 JS / Script Effect、Focus Ring 插件及用户样式保持原版本。保存 Bridge 工作区状态，先恢复停放窗口再停止，切换发现链接后恢复运行与原 Focus Ring 偏好。
- 旧 C++ canonical：`/home/cc/.local/lib/cc-niri/viewport-clip/3117381f96380c40b7f29ed426d52a766135893699157174cb7d7d46df262ed3/cc-niri-viewport-clip.so`，未覆盖旧 inode。
- 备份：`/tmp/cc-niri-r2-live-20261005-iovikgzn`。包含 kwinrc、workspaces.json、Bridge before / after 状态、插件路径及哈希 manifest、部署日志与回滚脚本。入口指针 `/tmp/cc-niri-r2-live-path`。
- 部署起点 UTC：`2026-10-05T11:00:47.553125+00:00`。KWin PID 前后均为 **2083**。

## 加载检查

- Script、Scroll Effect、Viewport Clip、Focus Ring 均加载，Bridge active；`/ccNiriViewportMotion` 状态接口可调用，目标输出 eDP-1。
- 当前 workspaceId / workspaceIndex、焦点 UUID、输出、4 列及其 widthMode / 顺序保持一致；工作区数保持 3。
- 初次部署后诊断 active=false、epoch=-1；新 session 已建立。27 行加载日志中 native fallback、completion timeout、INVARIANT_FAIL、FAIL_SAFE、ReferenceError、TypeError、Rust panic 均未出现。这仅覆盖加载窗口，不能代表滚动验收通过。
- KWin 保护 `/proc/2083/maps`，普通用户读取被拒；非交互 sudo 需要密码，因此没有直接验证进程映射。采用安装哈希、新 canonical 发现路径、Rust 符号及 KWin unload / load / 状态接口核验；此限制保留记录。

## 部署期间的问题

前三次尝试由安装 / 核验脚本问题触发自动回滚，均恢复 C++ 后继续：子构建目录不存在独立 install_manifest（改用统一构建根目录）；进程 maps 权限限制（调整只读核验）；D-Bus true/false 不兼容 Python literal_eval（修复并先只读验证）。没有观察到 Rust Motion 崩溃或 KWin 重启。最终安装及加载检查成功。失败尝试备份仍保留在 `/tmp/cc-niri-r2-live-20261005-*`。

## 人工验收计划

第一轮：普通半宽窗口，至少三列；慢速 H / L，随后连续 L L、L H、L L H、H L H L，在动画未结束时快速反向。观察平滑性、间距、ghost / snap、Focus Ring 同帧跟随及 outgoing 退出后的残留。**用户反馈“正常”，第一轮通过**。

第一轮后于 UTC `2026-10-05T11:08:21.818494+00:00` 核对：KWin PID 仍为 2083，session 未变，epoch 从 -1 推进到 74，motion active=false，Viewport Clip / Focus Ring 均加载。部署以来 479 行日志未出现 native fallback、completion timeout、INVARIANT_FAIL、FAIL_SAFE、ReferenceError、TypeError 或 Rust panic。状态、日志和用户反馈分别保存为备份目录中的 `manual-round1-state.json`、`manual-round1-kwin.log`、`manual-round1-result.json`。

第二轮：滚动中 J / K、Wide / 普通宽度切换、关闭窗口、Fullscreen；确认焦点 / 工作区恢复和边框生命周期。**用户反馈“全部正常”，第二轮通过**。

第二轮后于 UTC `2026-10-05T11:13:42.032108+00:00` 核对：KWin PID 仍为 2083，session 未变，epoch 推进到 103，motion active=false，Viewport Clip / Focus Ring 均加载。部署以来 742 行日志中上述七项异常计数均为 0。第二轮状态、日志与反馈保存在 `manual-round2-state.json`、`manual-round2-kwin.log`、`manual-round2-result.json`。

Mixed DPI 未执行；本轮先沿用 eDP-1 内屏范围，不能宣称 mixed DPI 验收通过。

性能：独立微基准见 [R2 代码记录](RUST_NATIVE_R2_RESULTS.md)。本轮尚未收集 compositor 帧时间，不宣称 Rust / C++ 实机性能差异或无掉帧。

## 后续采集与回滚

用户每轮操作后，通过 `/tmp/cc-niri-r2-live-capture.py` 只读采集 KWin PID、Native 状态、Bridge 快照及本次部署以来日志，产物写入上述备份目录；保留人工反馈与发现。

需要回滚时运行备份目录中的 `rollback.py`：先 `cc-niri stop` 恢复窗口，原子恢复旧 C++ 发现链接，再 `cc-niri start`。不得覆盖正在映射的 shared object。

## 本轮结论

R2 内屏功能与视觉验收通过，当前继续运行独立 Rust Motion 构建，C++ 回滚产物保留。此结论覆盖用户确认的两轮操作；mixed DPI、compositor 帧时间 A/B 与长时间稳定性未验收。源码默认 OFF、默认 ON 决策和 Legacy 删除规则保持不变。下一代码阶段为 R3 ScrollViewportRuntime，可在本轮已通过的行为基线上继续。
