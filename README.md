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

检查涵盖生成文件一致性、生产模块测试和空白检查；`--native` 额外执行 Bridge、原生 Effect、Plasmoid 构建及对应测试。自动测试不替代实机视觉验收。

## 日志与兼容性

在脚本设置中开启调试日志后查看：

```bash
journalctl --user -b -f | rg 'cc-niri-maximize|VIEWPORT_CLIP_NATIVE'
```

- 原生裁剪能力未确认时，滚动自动采用安全回退；原生 Effect 原地升级后，可能需要重新登录才能加载新库。
- 安装时会暂时禁用不兼容的 Geometry Change 和部分最小化动画，并记录原状态以供停止或卸载时恢复。
- shader 裁剪仅用于诊断，生产裁剪采用原生 RenderViewport 路线。

后续实现请以 [文档索引](doc/README.md) 的当前状态和优先级为准。
