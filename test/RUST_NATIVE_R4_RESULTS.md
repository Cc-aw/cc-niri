# Rust Native R4 生产接入与实机验收记录

日期：2026-10-05。状态：Rust Scroll 生产接入、自动门禁和独立构建部署完成；用户反馈“功能全部正常”，R4 内屏功能 / 视觉验收通过。mixed DPI、实际帧时间与长期稳定性未验证。源码生产开关仍默认 OFF，未删除 Legacy C++ Core。

后续状态：R5 Ring Core 与共享 decoration geometry 已部署独立验收构建，当前桌面见 [R5 记录](RUST_NATIVE_R5_RESULTS.md)。本记录中的 R4 Clip 与旧 Ring 保留为 R5 的回滚组合；R4 反馈只覆盖 R4。

## 生产接入

`CC_NIRI_USE_RUST_SCROLL_RUNTIME` 默认 **OFF**，通过 `ScrollViewportRuntimeBackend.h` 选择 Effect 持有的 runtime：

```text
ViewportClipEffect (C++ KWin hooks / lifetime / paint)
    → RustScrollViewportRuntime (Qt value conversion / FFI ownership)
    → Rust ScrollViewportRuntime (protocol / authority / motion / projection)
```

R4 复用 R3 Core、C ABI、Qt adapter 和现有 Cargo/CMake 构建路径，没有修改 Rust 算法、Spring 参数、JS Control Plane、绘制和 clipping 逻辑。Effect 的 arm / advance / projection 以及 context / cancel / clear / remove / 状态查询通过原有方法转发给选择的 runtime。平台输出 / desktop / frameGeometry 检查、Window 对象生命周期、Effect hooks 和 ownership marker 仍在 C++；R6 统一协议不在本阶段实施。

Scroll Runtime 与 Focus Ring visual-transform / retarget 组合测试自动跟随生产开关。R3 `CC_NIRI_TEST_RUST_SCROLL_RUNTIME` 仍可单独将测试覆盖为 Rust，但两个 R4 生产验收构建均设为 **OFF**，确保测试使用生产选择。纯 Core 的 C++ reference 差分与强制 Rust contract 保持独立。

Rust Scroll 内部使用 Rust Motion / Spring；旧 Spring / Motion 开关只选择保留的 C++ runtime 的数学实现。参考代码和独立差分继续保留。新增只读 `scrollRuntimeBackend` 状态字段与 READY 日志，用于确认实际加载的 backend；JS 完成协议继续使用原字段。

CI 增加生产 Scroll ON 的 OFF/OFF 和 ON/ON 两行，两个 standalone 插件入口均显式传入生产和测试开关；远端 Actions 未运行。根和 native AGENTS 已记录生产组合测试要求。

## 自动验证

工具链：Rust / Cargo **1.99.0**，`/usr/bin/g++` GNU **16.2.1**；Cargo.lock 无变更。

| 验证 | 结果 |
| --- | --- |
| Rust fmt / clippy `-D warnings` / `test --locked` | 通过；17 项单元测试 |
| Debug / Release Core CMake + CTest | 各 9 项通过，含 C ABI、差分、原有契约和 GCC configure 拒绝路径 |
| 全部开关 OFF，`node tools/check.js --native` | 85 项 JS、Bridge 5 项 CTest / 3 项隔离 D-Bus、Viewport 13 项 CTest、Ring 20 项 CTest、Plasmoid 构建全部通过 |
| ON/ON/ON/OFF，`build/native-r4-on` | 24 项 CTest 通过，含 Rust Scroll 与 Ring 组合测试；生产 Effect 编译通过 |
| OFF/OFF/ON/OFF，`build/native-r4-independent` | 24 项 CTest 通过，确认生产 Scroll 不依赖旧数学开关 |
| OFF/OFF/OFF/ON，`build/native-r3-tests` | 24 项 CTest 通过，保留 R3 测试覆盖路径 |
| `git diff --check` / `--cached --check` | 通过 |

开关顺序：Spring / Motion / **生产 Scroll** / **测试 Scroll 覆盖**。已检查生成的编译配置：R4 Effect 为生产 Scroll=1，未包含测试覆盖宏；三个组合测试为生产 Scroll=1 / 测试覆盖=0。默认 standalone Effect 为生产 Scroll=0。

Debug / Release 差分均通过：Spring 1,116 组 / 381,624 samples；Motion 1,096 组历史 / 3,442,720 samples；Scroll **347 组历史、75,041 次操作、21,289,290 次 projection 比较**。最大数值差均为 **0**。Scroll fixture 覆盖最后绘制 offset 接管、反向 / 共享角色 / 固定 gap、未提交几何、完成后保留 outgoing、epoch / context / cancel / remove 等边界。

日志：`/tmp/cc-niri-r4-rust.log`、`/tmp/cc-niri-r4-debug.log`、`/tmp/cc-niri-r4-release.log`、`/tmp/cc-niri-r4-off-check.log`、`/tmp/cc-niri-r4-on.log`、`/tmp/cc-niri-r4-independent.log`、`/tmp/cc-niri-r4-test-override.log`。构建中保留了既有 WorkspaceClipBarrierTest 的 missing-field-initializers warning，未导致门禁失败。

## 实机部署

使用 `build/native-r4-on`，RelWithDebInfo，ON/ON/ON/OFF，安装前缀 `/home/cc/.local`；复用 `tools/install-native-clip.py` 发布 immutable library 并原子切换发现链接。

- 新 canonical：`/home/cc/.local/lib/cc-niri/viewport-clip/17f0cbaffe11844a35cd4a7fc2b98381077cefd012a1a436131752920c09638c/cc-niri-viewport-clip.so`。
- SHA-256：`17f0cbaffe11844a35cd4a7fc2b98381077cefd012a1a436131752920c09638c`。产物包含 RustScrollViewportRuntime::arm / cc_niri_scroll_projection；运行中状态接口返回 **scrollRuntimeBackend=Rust**。
- R2 回滚 canonical：`/home/cc/.local/lib/cc-niri/viewport-clip/235122ab1af1e93718f544f5282b53332affa87e230bf482382c757c336595de/cc-niri-viewport-clip.so`；原 C++ `3117381f…` baseline 也保留，未覆盖已映射的旧库。
- 备份：`/tmp/cc-niri-r4-live-20261005-2f2n638t`；入口 `/tmp/cc-niri-r4-live-path`。保存 kwinrc、workspaces.json、Bridge before / after 状态、插件路径 / 哈希、部署日志、manifest 与回滚脚本。
- 先保存 Bridge 工作区，再用既有 `cc-niri stop` 恢复停放窗口，安装后 `cc-niri start` 恢复运行与 Ring 偏好。仅发布 Viewport Clip。Bridge、已安装 JS 与 Focus Ring 的路径 / SHA-256 前后精确一致。
- 起点 UTC：`2026-10-05T12:07:50.700327+00:00`；KWin PID 前后均为 **2083**，未重启 compositor。
- Bridge before / after 的 workspaceId / index、焦点 UUID、目标输出、列顺序 / widthMode、工作区列表、presentation 和 viewportAnchor 精确一致；比较结果保存为 `deployment-state-comparison.json`。

初次尝试在部署前的保留文件核对中退出：脚本将安装目录误写为 cc-niri，而 CLI 使用 cc-niri-maximize。未执行 stop 或更改发现链接；修正核对路径后部署成功。

KWin 的 `/proc/2083/maps` 仍受保护，本次沿用 R2 已确认的限制，没有重试提权读取。通过新的运行中 backend 诊断、immutable 安装哈希 / 路径、符号和加载状态核验，没有宣称直接验证进程映射。

## 实机验收范围

当前输出只有 **eDP-1，1920×1080@144Hz，scale=1**。加载后 UTC `2026-10-05T12:08:51.609855+00:00` 核对：Scroll / Ring 均加载、Bridge 可查询，backend 为 Rust，KWin PID 仍为 2083，epoch=-1 / active=false。18 行加载日志中 native fallback、INVARIANT_FAIL、FAIL_SAFE、ReferenceError、TypeError、completion timeout、Rust panic 均为 0。此时尚未证明滚动视觉通过。

| 设计要求 | 状态 |
| --- | --- |
| 慢速 H / L；快速 LLL、LLH、HLHL | 用户反馈“功能全部正常”，内屏通过 |
| 滚动中 J / K | 同轮反馈，内屏通过 |
| Pair → Wide；Wide → Pair | 同轮反馈，内屏通过 |
| 窗口关闭、Fullscreen 进出 | 同轮反馈，内屏通过 |
| Focus Ring 跟随 | 同轮反馈，内屏通过 |
| mixed DPI / wrong output | 当前仅单输出，待设备与人工验收 |
| 无 snap / ghost / gap 变化 / opacity residue / stale outgoing | 按本轮人工检查反馈，内屏通过 |
| 无 native fallback / INVARIANT_FAIL / FAIL_SAFE | 滚动后 750 行日志中均为 0 |

用户对上述 R4 检查列表反馈 **“功能全部正常”**。这是本轮内屏人工反馈，不是逐帧仪器测量；mixed DPI 未测试。

反馈后于 UTC `2026-10-05T12:19:10.931440+00:00` 核对：KWin PID 仍为 **2083**，session 保持 `1a10bf69581-97920465`，epoch 从 -1 推进到 **67**，active=false，生产 backend 仍为 Rust。Viewport Clip / Focus Ring 均加载，Bridge 可查询。部署以来 **750 行日志**中 native fallback、INVARIANT_FAIL、FAIL_SAFE、ReferenceError、TypeError、completion timeout、Rust panic 七项计数均为 **0**。

本轮证据保存为备份目录中的 `manual-round1-state.json`、`manual-round1-bridge.json`、`manual-round1-kwin.log`、`manual-round1-result.json`，manifest 已记录用户原文与验收范围。

状态 / 日志采集脚本：`/tmp/cc-niri-r4-live-capture.py`；证据保存在备份目录。R2 的两轮“正常 / 全部正常”反馈不计为 R4 验收。

## 性能、限制与回滚

R4 没有改动 R3 热路径算法，也没有新建每帧 JSON 解析或对象重建。R3 微基准显示 Rust + Qt projection 比 C++ reference 更慢（55.18ns 对 25.43ns），advance 为 34.25ns 对 30.15ns；这些数据只衡量计算 / map / FFI，不能推导 compositor 帧时间。本阶段尚未测量实际帧时间、mixed DPI 或长期稳定性。

本会话回滚到已验收的 R2：

```sh
python3 /tmp/cc-niri-r4-live-20261005-2f2n638t/rollback.py
```

脚本先恢复停放窗口并 stop，再原子恢复保存的 R2 immutable 链接并 start。备份位于 `/tmp`，重启后可能被清理；永久回滚库位于上述 `.local/lib/cc-niri` canonical 目录。源码回退生产路径可将 `CC_NIRI_USE_RUST_SCROLL_RUNTIME=OFF` 重新构建；保留 Golden Baseline，不在本阶段删除 C++ Core 或切换默认 ON。

工作区沿用 R0–R3 未提交改动，本阶段没有创建 commit；用户的 Core UX 设计文档未修改。R4 生产接入、自动门禁及内屏功能 / 视觉验收完成；mixed DPI 与性能 / 长期稳定性仍待验证，不能据此宣称完整实机矩阵通过，也不切换默认 ON 或删除 Legacy。
