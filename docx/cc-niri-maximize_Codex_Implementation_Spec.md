# `cc-niri-maximize`：KDE Plasma 6 / KWin 6 实现规格

> **给 Codex 的任务说明。**  
> 目标不是做一个平铺窗口管理器，而是在 KDE Plasma 6 中给**主屏普通“最大化”**增加类似 niri 的 outer gaps：最大化窗口不铺满整个主屏，上下（以及可选左右）保留壁纸区域；顶部状态岛和底部 Dock 可以悬浮在这块壁纸区域中。  
> **副屏继续保持 KDE 原生最大化行为，用于全屏 SSH 终端。**

---

# 1. 用户的实际桌面与工作流

用户当前是双屏 KDE Plasma：

```text
┌──────────────── 主屏 / 左侧显示器 ────────────────┐┌──────── 副屏 / 右侧显示器 ────────┐
│                                                   ││                                 │
│   顶部：多个 Floating Panel / Status Island       ││                                 │
│                                                   ││                                 │
│                日常多个工作窗口                    ││        SSH Terminal             │
│                                                   ││        长期最大化/全屏           │
│                                                   ││                                 │
│              底部中央 Floating Dock               ││                                 │
│                                                   ││                                 │
└───────────────────────────────────────────────────┘└─────────────────────────────────┘
```

主屏上目前有：

- 左上角极简 Launcher；
- 顶部中央时钟；
- 右上角状态岛；
- 底部中央 Plasma Floating Dock；
- Dock 使用 `Dodge Windows` 或之后可能使用 `Auto Hide`。

副屏主要用途：

- Terminal；
- SSH 连接服务器；
- 希望仍然可以正常占满整个副屏；
- **不希望 `cc-niri-maximize` 影响副屏。**

---

# 2. 最终目标

用户在**主屏**点击窗口标题栏的普通最大化按钮：

```text
□
```

期望得到：

```text
                   主屏

        ───────── 顶部壁纸留白 ─────────

          ┌──────────────────────┐
          │                      │
          │                      │
          │        Window        │
          │                      │
          │                      │
          └──────────────────────┘

        ───────── 底部壁纸留白 ─────────
                     Dock
```

而不是传统 KDE：

```text
┌───────────────────────────────────────┐
│                                       │
│             Maximized Window          │
│                                       │
└───────────────────────────────────────┘
```

关键语义：

```text
普通 maximize
    ↓
Niri-style pseudo maximize
    ↓
主屏保留 outer gaps
```

真正 fullscreen：

```text
F11 / 视频全屏 / 应用 Fullscreen
    ↓
仍然真正占满显示器
```

副屏：

```text
普通 maximize
    ↓
仍使用 KDE 原生最大化
    ↓
占满副屏可用区域
```

---

# 3. 为什么不能只依赖 Plasma Panel reserved area

不要通过把顶部和底部 Panel 设置成 `Always Visible` 来实现。

用户的底部 Dock 必须可以：

```text
Dodge Windows
或
Auto Hide
```

并且 Dock 隐藏以后：

> 窗口仍然不能侵占底部预留的壁纸区域。

因此这里的：

```text
outer gap
```

必须属于：

```text
窗口几何策略
```

而不是：

```text
Panel strut / reserved area
```

即：

```text
留白区域 ≠ Dock 本身
```

---

# 4. 推荐技术路线：KWin JavaScript Script

优先实现为：

```text
KWin/Script
```

使用 KWin 6 JavaScript Scripting API。

不要使用：

- `wmctrl`
- `xdotool`
- `xprop`
- X11 window polling
- Quickshell
- Latte
- 外部常驻 daemon
- 定时轮询 KWin D-Bus

当前环境是现代 KDE/Wayland，KWin 本身已经暴露所需 API。

官方文档：

```text
https://develop.kde.org/docs/plasma/kwin/
https://develop.kde.org/docs/plasma/kwin/api/
```

KWin 6 API 已提供本任务所需要的主要能力：

```text
Window.frameGeometry
Window.output

Window.maximizedAboutToChange(MaximizeMode)
Window.maximizedChanged()

Window.fullScreen
Window.fullScreenChanged()

Window.outputChanged()

Window.interactiveMoveResizeStarted()
Window.interactiveMoveResizeFinished()

Workspace.screens
Workspace.screensChanged()
Workspace.activeWindow
Workspace.clientArea(...)
```

---

# 5. Codex 开始前必须先做环境侦察

**不要直接照猜测 API 写代码。**

先执行：

```bash
plasmashell --version
kwin_wayland --version 2>/dev/null || true

rpm -q \
    plasma-desktop \
    plasma-workspace \
    kwin \
    kf6-kpackage \
    2>/dev/null || true

kscreen-doctor -o
```

记录：

```text
Plasma version
KWin version
主屏 output name
副屏 output name
两块屏幕 logical geometry
scale factor
当前屏幕左右排列
```

例如 output 可能叫：

```text
DP-1
HDMI-A-1
```

但**禁止在源码里直接假定名称**。

检查 KWin Script 安装环境：

```bash
kpackagetool6 --type=KWin/Script --list
kpackagetool6 --type=KWin/Script --list --global
```

检查本机已有 KWin Script 示例：

```bash
find /usr/share/kwin/scripts \
    -maxdepth 3 \
    -type f \
    \( -name 'metadata.json' -o -name 'main.js' \) \
    -print
```

如 KWin 版本比本文假设的新，**以当前安装版本的 API 和本机脚本为准**。

---

# 6. 项目名称与目录

项目：

```text
cc-niri-maximize
```

Plugin ID：

```text
cc-niri-maximize
```

推荐开发目录：

```text
~/Projects/cc-niri-maximize/
```

目录：

```text
cc-niri-maximize/
├── README.md
├── install.sh
├── uninstall.sh
├── package/
│   ├── metadata.json
│   └── contents/
│       ├── code/
│       │   └── main.js
│       ├── config/
│       │   └── main.xml
│       └── ui/
│           └── config.ui
└── test/
    └── TEST_PLAN.md
```

不要直接在：

```text
~/.local/share/kwin/scripts/
```

里面开发源码。

---

# 7. Package metadata

使用 KDE Plasma 6 官方推荐的 KPackage 格式。

目标类似：

```json
{
    "KPackageStructure": "KWin/Script",
    "KPlugin": {
        "Name": "CC Niri Maximize",
        "Description": "Niri-style pseudo maximize with configurable outer gaps on one monitor",
        "Icon": "view-fullscreen",
        "Id": "cc-niri-maximize",
        "Version": "1.0.0",
        "License": "MIT",
        "EnabledByDefault": false,
        "Category": "Window Management"
    },
    "X-Plasma-API": "javascript",
    "X-Plasma-MainScript": "code/main.js",
    "X-KDE-ConfigModule": "kwin/effects/configs/kcm_kwin4_genericscripted"
}
```

如果当前本机 KWin 版本对 metadata 有不同要求，以本机已安装脚本和 KDE 官方文档为准。

---

# 8. 配置要求

V1 至少提供：

```text
Target monitor
  [ Auto: leftmost monitor ]
  或指定 output name

Top gap
Bottom gap
Left gap
Right gap

☐ Include dialog windows
☐ Debug logging
```

推荐默认：

```text
Top gap:     42 logical px
Bottom gap:  64 logical px
Left gap:    10 logical px
Right gap:   10 logical px
```

这里全部使用：

```text
logical pixels
```

不要乘 `devicePixelRatio`。

---

# 9. Target monitor 选择策略

## 默认模式

用户主屏是**左侧显示器**。

如果：

```text
targetOutputName == ""
```

则：

```text
workspace.screens
    ↓
找 geometry.x 最小的 output
    ↓
作为 target monitor
```

如果 `x` 相同，再比较 `y`。

---

## 指定模式

允许用户填写：

```text
DP-1
HDMI-A-1
...
```

优先通过：

```text
Output.name
```

匹配。

不要保存：

```text
screen index 0 / 1
```

因为 index 在 hotplug 或重新登录后可能变化。

---

## 找不到指定 output

不能 crash。

建议：

```text
configured output not found
    ↓
fallback to leftmost monitor
```

并在 debug logging 开启时打印一次警告。

---

# 10. Geometry 的基本公式

假设 target output：

```text
screen = output.geometry
```

则 pseudo-maximize geometry：

```text
x = screen.x + gapLeft
y = screen.y + gapTop

width =
    screen.width
    - gapLeft
    - gapRight

height =
    screen.height
    - gapTop
    - gapBottom
```

即：

```text
                  gapTop

             ┌─────────────┐
             │             │
   gapLeft   │   Window    │   gapRight
             │             │
             └─────────────┘

                 gapBottom
```

---

# 11. 是否使用 `output.geometry` 或 `workspace.clientArea`

必须实际验证。

本项目的语义更接近：

> **相对于整个主屏创建人为 outer gaps。**

因此首选：

```text
output.geometry
```

而不是依赖 Panel strut 的：

```text
MaximizeArea
```

因为用户正希望：

```text
Dock 隐藏 / Dodge
```

不改变窗口预留空间。

但要检查当前顶部 Panel 是否会设置 strut，以及两种 geometry 在本机上的差异。

调试阶段同时打印：

```text
output.geometry
workspace.clientArea(KWin.MaximizeArea, window)
workspace.clientArea(KWin.FullScreenArea, window)
```

最终选择必须满足：

```text
Dock 显示/隐藏
    ↓
pseudo-maximize geometry 不变化
```

这条是硬要求。

---

# 12. 普通 maximize 和 Fullscreen 必须严格区分

## 普通 maximize

处理：

```text
maximizedAboutToChange
maximizedChanged
```

只针对：

```text
full horizontal + vertical maximize
```

不要把：

```text
仅垂直最大化
仅水平最大化
Quick Tile
```

误判为 full maximize。

---

## Fullscreen

必须忽略：

```text
window.fullScreen == true
```

例如：

- Firefox `F11`
- Zen `F11`
- 视频全屏
- mpv 全屏
- 游戏全屏

都应保持：

```text
true fullscreen
```

没有任何 gap。

---

# 13. 推荐状态机

每个窗口维护独立状态。

建议：

```text
WindowState {
    pseudoMaximized: bool
    restoreGeometry: QRect-like object
    pendingAction:
        null
        "enter"
        "leave"
    internalChange: bool
}
```

以：

```text
window.internalId
```

或当前 KWin API 中稳定的 window identity 作为 key。

窗口关闭后必须删除对应 state。

---

# 14. 为什么需要 `internalChange`

脚本自己会调用：

```text
window.setMaximize(...)
window.frameGeometry = ...
```

这些操作本身又可能产生：

```text
maximizedChanged
frameGeometryChanged
```

如果没有 guard：

```text
脚本改变状态
    ↓
signal
    ↓
再次执行脚本
    ↓
signal
    ↓
递归 / geometry 抖动
```

所以必须有：

```text
state.internalChange
```

或等价的 reentrancy guard。

---

# 15. 推荐的 pseudo-maximize 流程

直接让窗口一直保持 KWin native maximized state，然后强改：

```text
frameGeometry
```

可能导致 KWin 后续重新把窗口拉回 `MaximizeArea`。

因此优先采用：

```text
用户请求 Maximize
        ↓
捕获 full maximize
        ↓
记录当前 restoreGeometry
        ↓
让 KWin 完成/开始 maximize
        ↓
取消 native maximize state
        ↓
设置自定义 frameGeometry
        ↓
pseudoMaximized = true
```

即：

```js
window.setMaximize(false, false);
window.frameGeometry = targetGeometry;
```

具体 signal 时序必须根据当前 KWin 版本实际测试。

---

# 16. Restore 行为

用户再次点击标题栏 maximize 按钮时：

```text
pseudoMaximized == true
```

应该：

```text
取消刚触发的 native maximize
        ↓
恢复 restoreGeometry
        ↓
pseudoMaximized = false
```

最终：

```text
第一次点击 □
→ Niri maximize

第二次点击 □
→ 恢复进入 Niri maximize 前的窗口大小和位置
```

---

# 17. 一个必须明确验证的 UI 问题

由于 pseudo-maximize 内部可能：

```text
KWin maximized = false
```

标题栏按钮可能一直显示：

```text
□ maximize
```

而不是 native maximized 状态下的：

```text
❐ restore
```

V1 可以接受这个行为，但：

1. 必须在 README 说明；
2. 必须验证再次点击按钮仍能正确 restore；
3. Codex 要调查是否存在**不破坏 KWin geometry 的情况下保留 maximize decoration state**的更好方法；
4. 如果不能可靠实现，不要为了图标状态引入不稳定 hack。

稳定性优先。

---

# 18. 用户手动移动/Resize 后的行为

如果窗口处于：

```text
pseudoMaximized
```

然后用户主动：

```text
拖标题栏移动
或
拖边框 resize
```

建议：

```text
退出 pseudoMaximized state
```

并且：

```text
不要突然跳回旧 restoreGeometry
```

用户已经开始手动操作时，当前 geometry 应成为新的普通窗口状态。

可以监听：

```text
interactiveMoveResizeStarted()
```

---

# 19. Window 跨屏行为

这是重要场景。

## 主屏 → 副屏

如果一个 pseudo-maximized 窗口被移动到副屏：

```text
pseudo state 清除
```

不要在副屏继续强制 outer gaps。

副屏之后使用：

```text
KDE 原生窗口行为
```

---

## 副屏 → 主屏

普通窗口拖到主屏时：

```text
不自动 pseudo-maximize
```

只有用户主动点击 maximize 时才进入。

不要因为：

```text
outputChanged
```

自动放大窗口。

---

# 20. 副屏必须保持完全原生

以下测试必须通过：

```text
副屏普通窗口
    ↓
点击 maximize
    ↓
KDE native maximize
```

且：

```text
无 gap
```

副屏 SSH 终端不能因为主屏脚本失去可用空间。

---

# 21. Dialog / Special Window 过滤

默认只处理：

```text
normalWindow
```

忽略：

```text
plasmashell
krunner
desktop
dock
notification
tooltip
popup
OSD
lock screen
特殊窗口
不可 resize 的窗口
```

Dialog 默认：

```text
includeDialogs = false
```

设置打开后才处理可 resize 的 dialog。

---

# 22. Quick Tile 不属于本任务

例如：

```text
Meta + Left
Meta + Right
```

产生的 half tile：

```text
不应该自动改成 full pseudo-maximize
```

V1 不要求给 quarter/half tiles 加 gaps。

本任务只处理：

```text
full maximize
```

后续如果喜欢，再另开功能做 niri-style tiled gaps。

---

# 23. 可选全局快捷键

建议注册：

```text
Meta + Ctrl + M
```

名称：

```text
CC Niri Maximize
```

行为：

```text
对 activeWindow 直接 toggle pseudo maximize
```

这个快捷键是：

- 测试用 fallback；
- 即使标题栏 maximize signal 在个别应用上异常，也可以手动使用。

不要覆盖 KDE 默认 `Meta+PgUp` 等快捷键。

---

# 24. Hotplug / Geometry Change

监听：

```text
workspace.screensChanged()
```

以及目标 output 的：

```text
geometryChanged()
```

如果 target screen：

- 分辨率变化；
- scale 变化；
- 位置变化；

当前所有 pseudo-maximized 窗口要重新计算 geometry。

---

## 副屏拔掉

不能 crash。

由于 auto target 是 leftmost：

- 如果主屏仍然存在，则继续正常；
- 如果 output list 发生变化，重新 resolve target。

---

# 25. Dock 显示 / 隐藏测试

这是这个脚本存在的核心。

底部 Dock 使用：

```text
Dodge Windows
```

测试：

### Dock 显示

```text
Window
────────────
64px area
   Dock
```

### Dock 隐藏

```text
Window
────────────
64px wallpaper
```

**窗口 geometry 必须完全不改变。**

如果 Dock hide/show 会让 pseudo-maximized window 自动变高/变矮，说明实现依赖了错误的 `MaximizeArea` 或 Panel strut，需要修正。

---

# 26. 推荐初始尺寸

先使用：

```text
gapTop    = 42
gapBottom = 64
gapLeft   = 10
gapRight  = 10
```

但不要把这些值写死。

当前 UI 风格：

- 顶部 Floating islands 较薄；
- Bottom Dock 大约 46~50 px；
- 希望 Dock 周围还能看到少量壁纸。

因此 Bottom 预留略大于 Dock 高度是合理的。

后续根据截图微调。

---

# 27. 配置界面

使用：

```text
contents/config/main.xml
contents/ui/config.ui
```

配置页面建议：

```text
CC Niri Maximize

Target monitor
┌────────────────────────────────┐
│ Output name: [              ]  │
│ Empty = leftmost monitor       │
└────────────────────────────────┘

Outer gaps
                  Top
                 [ 42 ]

        Left               Right
        [ 10 ]             [ 10 ]

                 Bottom
                 [ 64 ]

☐ Include dialog windows
☐ Debug logging
```

设置应保存到 KWin Script config。

如果当前 KWin generic scripted KCM 对字符串或 UI widget 有兼容性问题，先确保数字 gap 配置稳定，再解决 screen selector。

---

# 28. Screen selector V2 改进

V1 可以是：

```text
QLineEdit output name
```

但 Codex 如果实现成本合理，最好升级为：

```text
ComboBox
```

显示：

```text
Auto — leftmost monitor
DP-1 — Dell ...
HDMI-A-1 — ...
```

如果 generic KWin Script config UI 无法方便动态枚举 output，则：

> V1 保持空字符串=自动 + 手动 output name。

不要为了动态 ComboBox 引入复杂 native plugin。

---

# 29. Debug logging

提供：

```text
debug = false
```

开启时打印：

```text
[cc-niri-maximize] loaded
target = DP-1
screen geometry = ...
gaps = T/R/B/L

ENTER <window caption>
restore = ...
target = ...

LEAVE <window caption>
restore = ...

output changed ...
fullscreen enter/leave ...
```

不要默认刷日志。

官方 KWin Script 日志可查看：

```bash
journalctl -f QT_CATEGORY=js QT_CATEGORY=kwin_scripting
```

必要时提示用户打开 `kdebugsettings` 中的 KWin Scripting debug。

---

# 30. 安装脚本

提供：

```bash
./install.sh
```

要求：

1. 不使用 sudo；
2. 检查 `kpackagetool6`；
3. 如果已安装，执行 update；
4. 否则 install；
5. enable plugin；
6. 触发 KWin reconfigure；
7. 不修改任何 Plasma Panel。

参考：

```bash
kpackagetool6 --type=KWin/Script -i package/
```

Enable：

```bash
kwriteconfig6 \
    --file kwinrc \
    --group Plugins \
    --key cc-niri-maximizeEnabled \
    true
```

然后通过当前系统可用的：

```text
qdbus6
或
qdbus
```

调用 KWin reconfigure。

---

# 31. 卸载

`uninstall.sh`：

```text
disable plugin
remove only cc-niri-maximize
reconfigure KWin
```

严禁删除：

```text
其他用户 KWin scripts
系统 KWin scripts
kwinrc 其他内容
```

---

# 32. 不允许自动修改的内容

Codex **禁止**自动修改：

```text
~/.config/plasma-org.kde.plasma.desktop-appletsrc
```

禁止重建：

```text
顶部 Panel
底部 Dock
System Tray
HTML Clock
```

这些已经由用户配置好。

本任务唯一责任：

```text
窗口 maximize geometry
```

---

# 33. 不修改 `/usr/share`

禁止：

```bash
sudo cp ...
sudo vim /usr/share/kwin/...
```

只能使用：

```text
用户级 KWin Script
```

正常安装后位于：

```text
~/.local/share/kwin/scripts/
```

---

# 34. 不要先实现“完美架构”，先做 POC

Codex 严格按以下阶段执行。

## Phase 1：环境检查

确认：

```text
KWin version
outputs
geometry
API
```

---

## Phase 2：Interactive Console POC

优先使用：

```bash
plasma-interactiveconsole --kwin
```

先验证：

```text
workspace.activeWindow
window.output
output.geometry
window.frameGeometry
window.setMaximize(false, false)
```

做一个最小试验：

```text
active window
    ↓
取消 maximize
    ↓
手工设成
x+10
y+42
w-20
h-106
```

确认主屏效果正确。

只有 POC PASS 才开始 packaging。

---

## Phase 3：Shortcut toggle

先实现：

```text
Meta+Ctrl+M
```

实现可靠的：

```text
normal ↔ pseudo maximize
```

并正确恢复 geometry。

这一阶段不要拦截标题栏 maximize。

验收：

```text
Meta+Ctrl+M
→ gap maximize

Meta+Ctrl+M
→ restore
```

---

## Phase 4：接管普通 maximize

在 shortcut 完全稳定后，再接：

```text
maximizedAboutToChange
maximizedChanged
```

目标：

```text
标题栏 □
```

和 shortcut 完全同样的行为。

---

## Phase 5：Fullscreen

验证：

```text
F11
```

不受影响。

---

## Phase 6：双屏

验证：

```text
左屏受影响
右屏不受影响
```

---

## Phase 7：Dock

验证：

```text
Dock 显示/隐藏
```

不会改变 pseudo-max window geometry。

---

## Phase 8：Config + Packaging

最后再做：

```text
config.ui
install.sh
uninstall.sh
README
```

---

# 35. 自动测试无法覆盖的内容

这是 window manager 行为，Codex 不能只做静态 lint 就宣布完成。

需要真实 GUI 测试。

至少应由 Codex执行：

```text
启动测试窗口
点击/触发 maximize
检查 geometry
切换 fullscreen
跨屏
dock hide/show
```

如果 Codex 当前环境不能操作 GUI：

> 明确写出哪些测试未能自动执行，并给用户一组最短手工验收步骤。

不要声称“全部测试通过”而实际上只检查了 JS syntax。

---

# 36. 手工验收矩阵

## T01：主屏普通最大化

```text
主屏 Firefox
点击 maximize
```

期望：

```text
top gap
bottom gap
left/right gap
```

PASS。

---

## T02：Restore

再次点击 maximize。

期望：

```text
回到进入 pseudo maximize 前的 geometry
```

PASS。

---

## T03：不同应用

测试：

```text
Firefox / Zen
Dolphin
Konsole
VS Code
```

都应一致。

---

## T04：F11

浏览器：

```text
F11
```

期望真正覆盖完整主屏。

退出 F11 后，如果进入 F11 前是 pseudo-maximized：

```text
恢复 pseudo-maximized geometry
```

---

## T05：副屏 maximize

把 Konsole 放在副屏：

```text
maximize
```

期望：

```text
正常 KDE 最大化，无人为 gap
```

---

## T06：主屏 → 副屏

pseudo-maximized window 跨到副屏。

期望：

```text
不继续强制主屏 gap geometry
```

---

## T07：副屏 → 主屏

普通窗口拖回主屏。

期望：

```text
保持普通窗口
```

直到主动 maximize。

---

## T08：Dock Dodge

主屏 pseudo-maximized。

让 Bottom Dock：

```text
显示
隐藏
显示
```

期望：

```text
window.frameGeometry 始终不变
```

---

## T09：手动 Move

pseudo-maximized 后手动拖标题栏。

期望：

```text
退出 pseudo-max state
```

窗口不能突然跳回旧位置。

---

## T10：手动 Resize

同 T09。

---

## T11：热插拔

如果方便测试：

```text
副屏断开 → 接回
```

脚本不能 crash。

---

## T12：Restart KWin/Session

重新登录后：

```text
script enabled
config persisted
behavior correct
```

---

# 37. 需要特别关注的 race / signal 问题

KWin maximize 流程可能是：

```text
maximizedAboutToChange
↓
内部 geometry 更新
↓
maximizedChanged
↓
frameGeometryChanged
```

脚本再次：

```text
setMaximize(false, false)
↓
又产生 maximize signals
```

这是本项目最大风险。

必须通过状态机解决：

```text
pendingAction
internalChange
```

不要靠：

```text
setTimeout 100ms
```

作为主同步机制。

如果只能通过 `callDBus`、timer 等 workaround 才稳定，要先调查 KWin 当前 API signal sequencing。

---

# 38. 不推荐持续监听 `frameGeometryChanged` 强制覆盖

不要写成：

```text
frameGeometryChanged
    ↓
每次都强制设置 target geometry
```

这很容易导致：

- move 卡住；
- resize 卡住；
- animation jitter；
- KWin 与脚本互相抢 geometry；
- 高 CPU / signal storm。

应基于：

```text
状态变化事件
```

来设置 geometry。

只有 screen geometry 改变等明确场景才 reapply。

---

# 39. 可以参考的已有项目

可研究：

```text
Plasma-Deckery/maximized-window-gaps
```

尤其关注它为什么：

```text
遇到原生 maximized geometry
→ setMaximize(false, false)
→ 再调整 frameGeometry
```

但不要直接复制全部逻辑。

该项目还处理：

```text
tile grid
quarter
half
offset
include/exclude apps
```

这些对本任务都不是必须。

`cc-niri-maximize` 应比它更简单：

```text
只处理：
main monitor
+
full maximize
+
outer gap
+
restore
+
true fullscreen passthrough
```

---

# 40. V1 不需要做的功能

不要 scope creep。

V1 不做：

```text
自动 tiling
scrolling layout
niri column layout
窗口动画重写
blur
rounded window corners
taskbar integration
panel integration
per-application gap profile
half-tile gap
quarter-tile gap
多个 gap preset
```

本项目只是：

> **Niri-style maximize geometry**

---

# 41. 最终 README 至少说明

README 包含：

```text
功能
支持的 Plasma/KWin version
安装方法
启用方法
配置方法
默认 gap
快捷键
双屏逻辑
Fullscreen 行为
pseudo-maximize 的 button icon 限制（如果存在）
调试日志
卸载方法
```

---

# 42. Codex 最终交付内容

完成后输出：

```text
1. 环境侦察结果
2. 采用的 KWin API
3. 状态机设计
4. 修改/新增文件
5. 安装方法
6. 测试结果
7. 未测试项目
8. 已知限制
9. 下一步可改进项
```

不要只说：

```text
implemented
```

---

# 43. 完成定义（Definition of Done）

以下全部满足才算完成 V1：

- [ ] 安装为独立 `cc-niri-maximize` KWin Script。
- [ ] 不需要 root。
- [ ] 不修改 KDE 系统文件。
- [ ] 不修改 Plasma Panels。
- [ ] 默认只作用于左侧主屏。
- [ ] 可通过 output name 指定 target monitor。
- [ ] 主屏 full maximize 变为带 outer gaps 的 pseudo-maximize。
- [ ] 默认 gap 可配置。
- [ ] 第二次 maximize 可以恢复原 geometry。
- [ ] 主屏 F11 真全屏不受 gap 限制。
- [ ] 副屏 maximize 保持 KDE 原生行为。
- [ ] Dock 显示/隐藏不会改变 pseudo-max window geometry。
- [ ] 手动 move/resize 可以合理退出 pseudo state。
- [ ] 跨屏不会把主屏 gap 强加给副屏。
- [ ] screen geometry 改变后可以重新计算。
- [ ] 无持续 `frameGeometry` 抖动。
- [ ] 无持续 KWin scripting error。
- [ ] 不使用轮询。
- [ ] 不依赖 X11 工具。
- [ ] 有安装、卸载和调试文档。

---

# 44. 给 Codex 的执行要求

**现在开始实现，不要先问用户设计问题。**

先：

```text
检查机器
→ 阅读本机 KWin API/脚本
→ Interactive Console POC
→ Shortcut toggle
→ maximize interception
→ 双屏/fullscreen/dock 验证
→ packaging
```

如果遇到 API 与本文不同：

> **优先服从当前机器实际 KWin 版本，而不是强行照本文 API 名称实现。**

如果实现方向开始变成：

```text
外部 daemon
反复 polling
D-Bus 每 100ms 查窗口
X11 compatibility hack
```

说明方向错误，应退回 KWin Script 原生事件驱动方案。

最终目标非常简单：

```text
主屏：

        wallpaper / top islands

    ┌──────────────────────┐
    │                      │
    │    maximized app     │
    │                      │
    └──────────────────────┘

        wallpaper / Dock


副屏：

    ┌──────────────────────┐
    │                      │
    │   maximized SSH      │
    │                      │
    └──────────────────────┘
```

**主屏像 niri 一样留出 breathing room；副屏继续保持高效、完整的 SSH 工作空间。**
