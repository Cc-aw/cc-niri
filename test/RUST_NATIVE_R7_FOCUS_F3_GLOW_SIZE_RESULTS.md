# Focus F3 — 柔光范围微调

日期：2026-10-10。按用户“柔光再大一点”的反馈微调渲染参数，保留 F3 gain 收敛、F2 淡入淡出和 Clip 共享呈现时间。

## 范围

- Gaussian sigma：1.5 → 1.7，稳定柔光的 logical support：6.5 → 7.1px。
- Gain profile support：7 → 7.4px，仍在同一条 140ms 曲线上收拢到稳定轮廓。
- 初始 damage outset：7 → 8px，覆盖 native pixel rounding；viewport outset 保持 5px。
- 颜色 #7FC8FF、2px 边框、border alpha .85、glow alpha .25 保持原值。没有修改 Rust Core / FFI / JS / CMake / frozen reference。
- 在 100 / 125 / 150 / 175 / 200% 下，gain 的 native-rounded support 为 7 / 7.2 / 7.333 / 7.429 / 7.5 logical px，均小于 8px 列间隙。

## 验证

使用固定 Rust / Cargo 1.99.0 和既有 `/usr/bin/g++` GNU 16.2.1 构建树。

- `cargo fmt --manifest-path native/rust/Cargo.toml --all --check`：PASS。
- `cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings`：PASS。
- `cargo test --manifest-path native/rust/Cargo.toml --locked --workspace`：60 / 60 PASS。
- Ring 构建与 CTest：25 / 25 PASS，包含五档缩放、邻列边界、Gaussian alpha / falloff、缓存、viewport clip、retarget 和 Golden differential。
- `node tools/check.js --native`：PASS；100 个 JS 测试文件，Bridge 18 / 18、Clip 17 / 17、Ring 25 / 25，隔离 D-Bus 与 production architecture boundary 均通过。

日志：`build/focus-f3-size/ring-build.log`、`ring-ctest.log`、`rust-test.log`、`native-gate.log`。

## 性能与限制

仍使用两组固定小纹理和互补权重，不增加每帧 rasterization、窗口尺寸纹理或全屏 blur。主屏 150% 下稳定 support 从 6.667 增到 7.333 logical px；稳定 / gain 的外边界会对齐到同一设备像素，收拢主要体现为 falloff profile 变化。没有新增 GPU 时间或功耗 benchmark。主观视觉验收待用户反馈。

## 安装与实机结果

安装成功备份：`/home/cc/.local/state/cc-niri/backups/focus-f3-size-20261010-142431`。使用 save-state → stop → immutable Ring install → start，KWin PID 2050 未重启。Clip 与其他组件的安装产物保持原值。

- Ring SHA-256：`d13466a9597fc66481150bb0c171f3bdc2c66983792845f659dd2b15558ad62e`。
- `deployment-success.json`：PASS，运行中参数为 sigma 1.7、稳定 extent 7.1、gain extent 7.4；配置、输出、窗口几何、工作区、fullscreen / minimized、Pair anchor、实际焦点恢复检查通过。
- 部署后 1 秒 idle：active transition=0，fade repaint request / glow rasterization 增量均为 0。
- 主屏 150% Pair H/L 与反向：PASS，观察到有限 opacity / gain mix 收敛、可见 retarget 不重新扩张、唯一真实 focused owner，无 continuation full repaint。
- 连续 H/L 后实际焦点转到副屏非 eligibility 窗口，Ring 正确清除 owner / visuals。旧实机脚本仍假设主屏焦点，`rapid-HL-return` 和最终 active-window 相等检查因此未通过。后续停止主动切换，不把此脚本计为完整实机 PASS。
- 本次 travel H/L、J/K、Wide、fullscreen、Ring off/on 的后续实机复验未执行；这些行为的既有自动检查和前一轮 F3 实机记录保留。未做 GPU 像素截图、锁屏、拔插、maximize / restore 复验。OS 仍拒绝 `/proc/2050/maps`，仅核验 immutable 安装 hash 与运行中 API 参数。

首次安装因副屏窗口最小化状态恢复不全自动回滚；临时部署 helper 增加按保存状态恢复非目标输出窗口。第二次遇到工作区焦点恢复未稳定而回滚；补充稳定焦点重试后，最终部署通过全窗口 / 输出桌面恢复核验。两次失败记录保存在 `focus-f3-size-20261010-142215` 与 `focus-f3-size-20261010-142334` 私有备份中，没有为此修改生产布局或焦点逻辑。

## 回滚

成功备份中的 `rollback-component.sh` 使用 stop → 原子恢复原 immutable Ring discovery link → start。旧 Ring SHA-256 为 `3e83820d0ed9aa1314cf260031e43978690b17ccdcf37af56d2fd5f6b0924615`；不回退 Clip 或其他组件。停启后可使用备份的 `live-support.py` 和现场保存状态恢复工作区 parking / 副屏 minimized，不能整体覆盖旧配置或缓存。
