# CC Niri Maximize

在 KDE Plasma / KWin Wayland 上实现类似 niri 的滚动列工作流：主屏窗口按列排列，支持横向导航、Wide 聚焦与纵向工作区切换。

详细设计、实施状态与后续计划见 [设计文档索引](doc/README.md)，验收记录见 [test/](test/)。

## 当前功能

- **滚动列**：主屏每列一个普通窗口；默认显示两列，H/L 移动焦点并按需滚动。列顺序与 Dock 双向同步，重载后恢复已有窗口的顺序和视口。
- **安全区域**：最大化和 Quick Tile 使用配置的边距与间隔；Fullscreen 保持原生行为。副屏支持独立安全区域，滚动列仅管理主屏。
- **Contextual Wide**：保存每列的 Wide 偏好，聚焦时可居中扩展至安全区域的 72%；Pair 模式仍显示两个半宽窗口。
- **窗口策略**：支持手动浮动及拖动脱离；Dialog、Modal、Transient 等辅助窗口保持原生浮动，不进入列布局。
- **连续动画**：支持快速输入与反向 retarget，使用原生 viewport clip 限制绘制范围。当前运行路径仍使用 OutCubic。
- **工作区 W0–W9**：J/K 纵向切换、各工作区布局快照、窗口迁移，以及可选的末尾空工作区追加和空工作区回收。当前主屏范围已部署并验收。

**共享 ViewOffset + Spring** 已接入普通 H/L 滚动并通过本轮内屏验收；新的 **原生 Focus Ring** 已完成 Phase 1–6、部署并通过内屏验收，当前活动受管窗口显示 3px 浅蓝边框。设计已[归档](doc/done/cc-niri_Focus_Ring_实现设计.md)，双屏扩展留待以后。

多窗口 Column、Overview 和副屏滚动列尚未实现；完整日常交互验收仍有待完成项，见 [稳定版验收](test/V3_DAILY_ACCEPTANCE.md)。

## 安装与控制

开发与验证环境为 Fedora 44、Plasma / KWin 6.7.5、Wayland。原生插件需要匹配的 KWin 开发包，Fedora 为 `kwin-devel`。

仓库通过根 `rust-toolchain.toml` 精确固定 Rust / Cargo **1.99.0**，包含 rustfmt / clippy，并跟踪 `native/rust/Cargo.lock`；使用 rustup 执行 `rustup toolchain install 1.99.0 --profile minimal --component rustfmt --component clippy` 准备工具链。C++ 固定为 **`/usr/bin/g++`、GNU GCC 16.x**；CMake configure 拒绝其他路径、编译器或主版本。CMake 自动调用 Cargo，无需手动预编译 Rust。

```bash
./install.sh
```

安装器无需 root，会编译并安装 KWin Script、动画与裁剪 Effect、D-Bus Bridge 和 `CC Scroll Tasks`，重载 KWin 组件并重启 Plasma Shell。Script、Bridge 和 Dock 应一起升级。

日常控制无需重新编译或重启 Plasma Shell：

```bash
cc-niri start
cc-niri stop
cc-niri restart
cc-niri status
```

`stop` 先恢复各工作区被停放的窗口，再卸载组件并关闭自动启动；恢复请求失败时中止卸载。`start` 重新启用自动启动。若 `~/.local/bin` 不在 PATH 中，可使用 `~/.local/bin/cc-niri` 或仓库内的 `./cc-niri`。

卸载：

```bash
./uninstall.sh
```

卸载不会改写 Plasma 面板，也不会移除已安装的 `CC Scroll Tasks` applet。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Meta+H / L` | 聚焦上一列 / 下一列，不循环 |
| `Meta+J / K` | 切换下一工作区 / 上一工作区，不循环 |
| `Meta+Z` | 切换当前列的 Focus Wide |
| `Meta+Shift+H / L` | 将当前列左移 / 右移 |
| `Meta+Shift+Enter` | 切换列管理与浮动，支持主键盘和小键盘 Enter |

Dock 菜单提供 Normal、Focus Wide 和安全区域最大化。原生最大化按钮也进入安全区域最大化；部分窗口装饰的图标不会随状态变化，但再次点击仍可还原。

## 配置与工作区

在 **系统设置 → 窗口管理 → KWin 脚本** 中配置输出名称、边距、间隔和日志。主屏名称留空时选择最左侧启用的输出。

J/K 请求切换脚本的主屏。KDE 默认会联动所有屏幕；在 KWin 6.7 上执行下列命令可让副屏保留自己的工作区，设置立即生效并保留至下次登录：

```bash
cc-niri workspace primary
cc-niri workspace status
```

`cc-niri workspace global` 恢复 KDE 的双屏联动模式。此设置使用 KWin 原生独立工作区，不移动窗口或模拟工作区；安装 / start 不强制覆盖用户选择。双屏实测与帧时间见 [工作区输出与帧率记录](test/WORKSPACE_OUTPUT_FRAME_RESULTS.md)。

4K 60Hz 可启用独立的 420ms 工作区曲线：平滑起止、有限时间收尾，连续 J/K 从上一绘制位置接管。Rust 负责曲线与投影，KWin 继续管理工作区、窗口和绘制；不调整 KDE 全局动画速度、H/L Spring 或 Wide 参数。此选项默认关闭，启用需要已构建并安装包含该功能的 Native Clip：

```bash
kwriteconfig6 --file kwinrc --group Effect-cc-niri-viewport-clip --key OptimizedWorkspaceAnimation --type bool true
kwriteconfig6 --file kwinrc --group Effect-cc-niri-viewport-clip --key WorkspaceDuration 420
cc-niri restart
```

启用期间 `cc-niri` 暂停 KDE 原生 Slide，stop 时恢复先前偏好。将 `OptimizedWorkspaceAnimation` 设为 `false` 并 restart 可回到原动画；`WorkspaceDuration` 支持 240–800ms。60Hz 的物理呈现上限仍为每秒 60 帧，实测与限制见 [工作区动画优化记录](test/WORKSPACE_ANIMATION_RESULTS.md)。

所有尺寸使用逻辑像素，不额外乘输出缩放比例：

| 配置 | 主屏默认值 | 副屏默认值 |
| --- | --- | --- |
| 输出 | 留空，自动选择 | `HDMI-A-1` |
| 上 / 下 / 左 / 右边距 | `50 / 70 / 24 / 24 px` | 均为 `24 px` |
| 内部间隔 | `8 px` | `8 px` |

J/K 纵向动画要求 KDE 工作区网格为一列。以下两个选项默认关闭：

- **W8 — 保留末尾空工作区**：主屏末尾工作区被占用时追加一个空工作区，并保持纵向网格。
- **W9 — 自动回收空工作区**：依赖 W8；保留末尾和各输出当前工作区，依据所有输出的真实窗口归属判断是否可删除。开启后也会回收已有的空非当前工作区。

可在脚本设置中启用，或执行：

```bash
kwriteconfig6 --file kwinrc --group Script-cc-niri-maximize \
  --key DynamicTrailingWorkspace --type bool true
kwriteconfig6 --file kwinrc --group Script-cc-niri-maximize \
  --key AutoRecycleWorkspaces --type bool true
cc-niri restart
```

将对应值设为 `false` 并重启即可关闭。关闭 W8 不会删除已创建的工作区。

布局快照保存于 `${XDG_STATE_HOME:-~/.local/state}/cc-niri/workspaces.json`，可恢复已有窗口的列顺序、宽度、Wide 偏好、焦点与视口锚点；不会重新启动应用。

## 开发与检查

| 目录 | 职责 |
| --- | --- |
| `src/kwin/` | 窗口与列状态、布局、生命周期、工作区、策略与恢复 |
| `src/effect/` | 动画状态、采样、retarget 与事务 |
| `native/viewport-clip/` | 原生绘制裁剪、运动协议与 Spring 数学模块 |
| `native/rust/` | Rust Spring、Motion、Scroll Runtime 与 C ABI，含差分测试；生产开关默认 OFF |
| `bridge/` | 事件驱动的 D-Bus IPC 与快照持久化 |
| `plasmoid/com.cc.scrolltasks/` | 定制任务栏、列顺序同步与窗口操作 |
| `test/` | 自动测试和阶段验收记录 |

KWin 逻辑层负责布局、焦点和列顺序；纯 `LayoutEngine` 计算方案，`GeometryCommitter` 提交列几何，Effect 负责视觉运动与裁剪。Bridge 不决定布局，运行时不使用轮询。

修改 `src/` 后生成运行脚本，不直接编辑 `package/contents/code/main.js` 或 `effect/contents/code/main.js`：

```bash
node tools/build.js
node tools/check.js
```

在具备 KDE 开发依赖的环境中运行完整检查：

```bash
node tools/check.js --native
```

检查涵盖生成文件一致性、生产模块测试和空白检查；`--native` 额外执行 Rust fmt/clippy/unit tests、Bridge、原生 Effect、Plasmoid 构建及对应测试（含 C++ → Rust FFI smoke）。自动测试不替代实机视觉验收。

无需 KDE 开发依赖即可验证 Rust 与 FFI：

```bash
cmake -S native -B build/native-core -DCMAKE_CXX_COMPILER=/usr/bin/g++ -DCC_NIRI_BUILD_KWIN_ADAPTERS=OFF -DCMAKE_BUILD_TYPE=Debug
cmake --build build/native-core
ctest --test-dir build/native-core --output-on-failure
cargo test --manifest-path native/rust/Cargo.toml --locked --workspace
```

CMake `Debug` 对应 Cargo `dev`；`Release`、`RelWithDebInfo`、`MinSizeRel` 对应 Cargo `release`。Rust 产物放在各 CMake 构建树内；FFI 库采用 `panic=abort`，禁止 unwind 穿越 C++。

现有构建树若缓存了 `/usr/bin/c++` 或发行版旧 Rust，重新 configure 时显式传入 `-DCMAKE_CXX_COMPILER=/usr/bin/g++`，并用 `-DCC_NIRI_CARGO_EXECUTABLE="$(command -v cargo)" -DCC_NIRI_RUSTC_EXECUTABLE="$(command -v rustc)"` 更新 Rust 缓存（仅 Native 入口需要）。更换 C++ 编译器可能触发 CMake 缓存重建，应复核安装前缀等自定义选项。

开发约束和必执行测试见根 [AGENTS.md](AGENTS.md) 与 [native/AGENTS.md](native/AGENTS.md)。

Rust Spring（R1）与 ViewportMotion（R2）已移植，源码默认仍使用 C++。两个开发开关默认 OFF：`CC_NIRI_USE_RUST_SPRING` 选择 C++ Motion 的 Spring；`CC_NIRI_USE_RUST_VIEWPORT_MOTION` 将整个 Motion 状态机交给 Rust（内部使用 Rust Spring）。默认 Scroll Runtime 使用 C++；R4 可单独选择 Rust。独立验证 Rust Motion 路径：

```bash
cmake -S native -B build/native-r2-on -G Ninja -DCMAKE_CXX_COMPILER=/usr/bin/g++ -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCC_NIRI_USE_RUST_SPRING=ON -DCC_NIRI_USE_RUST_VIEWPORT_MOTION=ON
cmake --build build/native-r2-on
ctest --test-dir build/native-r2-on --output-on-failure
```

该命令仅构建与测试。独立 Rust Motion 构建已部署并通过[两轮内屏功能 / 视觉验收](test/RUST_NATIVE_R2_LIVE_RESULTS.md)；源码默认 ON 切换尚未执行，mixed DPI 与实机帧时间尚未验收。代码验收见 [R1 记录](test/RUST_NATIVE_R1_RESULTS.md) 与 [R2 记录](test/RUST_NATIVE_R2_RESULTS.md)。

Rust ScrollViewportRuntime（R3）的 Core、C ABI、Qt 转换层、差分与集成测试已完成。`CC_NIRI_TEST_RUST_SCROLL_RUNTIME` 默认 OFF，可仅切换测试中的 runtime。独立执行 R3 验证：

```bash
cmake -S native -B build/native-r3-tests -G Ninja -DCMAKE_CXX_COMPILER=/usr/bin/g++ -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCC_NIRI_USE_RUST_SPRING=OFF -DCC_NIRI_USE_RUST_VIEWPORT_MOTION=OFF -DCC_NIRI_TEST_RUST_SCROLL_RUNTIME=ON
cmake --build build/native-r3-tests
ctest --test-dir build/native-r3-tests --output-on-failure
```

结果与性能限制见 [R3 记录](test/RUST_NATIVE_R3_RESULTS.md)。Debug / Release Core CTest 的 reference harness 需要 Qt6 Core，Rust crate 本身不依赖 Qt。

R4 新增生产开关 `CC_NIRI_USE_RUST_SCROLL_RUNTIME`（默认 OFF），将 Viewport Clip 的 runtime 交给 Rust；KWin hooks、平台对象生命周期与绘制仍在 C++。Scroll 与 Focus Ring 组合测试自动跟随生产 backend，验收构建关闭 R3 测试覆盖，避免只测试到覆盖路径。Rust Scroll 内部使用 Rust Motion / Spring，两个旧数学开关只控制保留的 C++ runtime。独立构建：

```bash
cmake -S native -B build/native-r4-on -G Ninja -DCMAKE_CXX_COMPILER=/usr/bin/g++ -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_INSTALL_PREFIX="$HOME/.local" -DKDE_INSTALL_PLUGINDIR=lib64/qt6/plugins -DCC_NIRI_USE_RUST_SPRING=ON -DCC_NIRI_USE_RUST_VIEWPORT_MOTION=ON -DCC_NIRI_USE_RUST_SCROLL_RUNTIME=ON -DCC_NIRI_TEST_RUST_SCROLL_RUNTIME=OFF
cmake --build build/native-r4-on
ctest --test-dir build/native-r4-on --output-on-failure
```

这些命令仅构建和测试。R4 独立构建已部署，用户反馈“功能全部正常”，内屏功能 / 视觉验收通过；部署与证据见 [R4 记录](test/RUST_NATIVE_R4_RESULTS.md)。只读 `GetScrollMotionStatus` 的 `scrollRuntimeBackend` 标识实际加载的生产路径。mixed DPI、实际帧时间与长期稳定性待验证；保留默认 C++、R2 immutable 插件及差分 baseline。

R5 通过 `CC_NIRI_USE_RUST_FOCUS_RING_CORE`（默认 OFF）选择 Ring 数值快照、描边 / 圆角 / 像素对齐与 decoration padding 的 Rust 实现。KWin 唯一 owner、Scene Item、QPainter 栅格化、paint hooks 和 damage 提交仍由 C++ 负责；没有新增 Ring 动画时钟或修改 JS eligibility 协议。两个插件及现有 Ring Phase 1–6 测试共用此开关：

```bash
cmake -S native -B build/native-r5-on -G Ninja -DCMAKE_CXX_COMPILER=/usr/bin/g++ -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_INSTALL_PREFIX="$HOME/.local" -DKDE_INSTALL_PLUGINDIR=lib64/qt6/plugins -DCC_NIRI_USE_RUST_SPRING=ON -DCC_NIRI_USE_RUST_VIEWPORT_MOTION=ON -DCC_NIRI_USE_RUST_SCROLL_RUNTIME=ON -DCC_NIRI_TEST_RUST_SCROLL_RUNTIME=OFF -DCC_NIRI_USE_RUST_FOCUS_RING_CORE=ON
cmake --build build/native-r5-on
ctest --test-dir build/native-r5-on --output-on-failure
```

命令仅构建和测试。R5 独立构建已部署，用户反馈“功能正常”，内屏功能 / 视觉验收通过；HiDPI / fractional scale / mixed DPI 实机、实际帧时间与长期稳定性待验证。生产 Ring 的 `coreBackend` 与 Viewport Clip 的 `decorationGeometryBackend` 只读字段用于核验实际 backend；差分、性能、部署与验收证据见 [R5 记录](test/RUST_NATIVE_R5_RESULTS.md)。

R6 使用共享的 Rust Native Protocol 类型与 sequence，并通过 `CC_NIRI_USE_RUST_NATIVE_PROTOCOL`（默认 OFF）选择 Scroll observer / validator 与 Ring eligibility policy。Scroll v2、独立 Ring v1、JS schema 与 KWin 唯一 owner 保留；两个插件的 `nativeProtocolBackend` 为只读加载诊断。代码和自动门禁已通过，独立构建已部署；用户反馈一般功能正常，[Pair→Wide 动画中 J/K 邻窗重叠](test/WORKSPACE_WIDE_DEPARTURE_RESULTS.md)的第二版交接修复已由用户确认成功。随后报告的双屏联动已启用原生主屏独立切换，普通 J/K 实测约 60fps，详见 [输出与帧率记录](test/WORKSPACE_OUTPUT_FRAME_RESULTS.md)及 [R6 记录](test/RUST_NATIVE_R6_RESULTS.md)。

```bash
cmake -S native -B build/native-r6-on -G Ninja -DCMAKE_CXX_COMPILER=/usr/bin/g++ -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_INSTALL_PREFIX="$HOME/.local" -DKDE_INSTALL_PLUGINDIR=lib64/qt6/plugins -DCC_NIRI_USE_RUST_SPRING=ON -DCC_NIRI_USE_RUST_VIEWPORT_MOTION=ON -DCC_NIRI_USE_RUST_SCROLL_RUNTIME=ON -DCC_NIRI_USE_RUST_FOCUS_RING_CORE=ON -DCC_NIRI_USE_RUST_NATIVE_PROTOCOL=ON -DCC_NIRI_TEST_RUST_SCROLL_RUNTIME=OFF
cmake --build build/native-r6-on
ctest --test-dir build/native-r6-on --output-on-failure
```

命令仅构建和测试。保留 C++ reference、R5 回滚插件与原有开关；R6 实机反馈与 R7 默认 Rust / 稳定使用等删除条件按阶段记录推进。

## 日志与兼容性

在脚本设置中开启调试日志后查看：

```bash
journalctl --user -b -f | rg 'cc-niri-maximize|VIEWPORT_CLIP_NATIVE'
```

- 原生裁剪能力未确认时，滚动自动采用安全回退；原生 Effect 原地升级后，可能需要重新登录才能加载新库。
- 安装时会暂时禁用不兼容的 Geometry Change 和部分最小化动画，并记录原状态以供停止或卸载时恢复。
- shader 裁剪仅用于诊断，生产裁剪采用原生 RenderViewport 路线。

后续实现请以 [文档索引](doc/README.md) 的当前状态和优先级为准。
