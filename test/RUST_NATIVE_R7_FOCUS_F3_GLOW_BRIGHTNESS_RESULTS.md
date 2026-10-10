# Focus F3 — 柔光亮度微调

日期：2026-10-10。按用户“提高一点亮度”的反馈，将柔光 alpha 从 .25 提高到 .28（约 +12%）。稳定与 gain 两份固定 Gaussian profile 使用同一 alpha，互补权重和 140ms 收敛曲线保持原实现。

## 范围

- 保留 sigma 1.7、稳定 extent 7.1、gain extent 7.4、2px 边框及 border alpha .85、颜色 #7FC8FF、viewport outset 5。
- 更新既有纹理像素验收值：8-bit alpha 上限 72、近边峰值至少 69；远端仍接近透明。五档缩放和邻列 support 检查保留。
- 不修改 Core、FFI、JS、CMake、动画或平台 hooks。

## 验证

固定 Rust / Cargo 1.99.0、既有 `/usr/bin/g++` GNU 16.2.1 构建树。

- `cargo fmt --manifest-path native/rust/Cargo.toml --all --check`：PASS。
- `cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings`：PASS。
- `cargo test --manifest-path native/rust/Cargo.toml --locked --workspace`：60 / 60 PASS。
- `node tools/check.js --native`：PASS；100 个 JS 测试文件，Bridge 18 / 18、Clip 17 / 17、Ring 25 / 25，包含 Golden differential、五档缩放 / 邻列边界、纹理 alpha / falloff、缓存、FFI、隔离 D-Bus 与 production architecture boundary。

日志：`build/focus-f3-brightness/ring-build.log`、`rust-test.log`、`native-gate.log`。

## 性能与限制

只提高固定纹理的 alpha，不扩大 support、不增加纹理数量或每帧 rasterization。没有新增 GPU 时间 / 功耗 benchmark。本次不修改动画，未重复完整 H/L / retarget、J/K、Wide、fullscreen / off-on 实机矩阵；既有自动检查继续执行。主观亮度验收待用户反馈。

## 安装与实机参数核验

备份：`/home/cc/.local/state/cc-niri/backups/focus-f3-brightness-20261010-143035`。按 save-state → stop → immutable Ring install → start 流程安装；KWin PID 2050 未重启。`deployment-success.json` PASS。

- Ring SHA-256：`3073b43d36399c2fb18a1bdf4d86f484909f0d8d4cbed45ad2fd3919b452f9cf`。
- 运行中 API 确认 glow alpha .28、稳定 extent 7.1、gain extent 7.4；边框、颜色、曲线和其他参数保持原值。
- 窗口几何、desktops、fullscreen / minimized、实际焦点、Pair anchor、配置、输出 / 各屏桌面与组件开关恢复核验 PASS；Clip / Bridge / JS 安装产物保持原 hash。
- 1 秒 idle：active transition=0，fade repaint request / glow rasterization 增量均为 0。
- OS 拒绝读取 `/proc/2050/maps`；核验 installed immutable hash 与运行中参数，未独立验证映射文件 hash。没有截图级主观视觉验收。

## 回滚

备份中的 `rollback-component.sh` 执行 stop → 原子恢复旧 immutable Ring discovery link → start。旧 Ring 为 `d13466a9597fc66481150bb0c171f3bdc2c66983792845f659dd2b15558ad62e`；Clip 和其他组件不回退。不整体覆盖配置或旧 workspace cache。若需完整现场窗口恢复，先保存回滚时状态，再使用备份 `live-support.py` 恢复 parking / 副屏 minimized 和真实焦点。
