# W0 Virtual Desktop API 探针

`kwin-workspace-api-probe.js` 独立加载，只读取 API、连接信号和打印日志。
不修改 geometry、Desktop、Column、Adoption 或 Dock，也不注册快捷键。
`tools/build.js` 不打包此文件。

## 加载、查看、卸载

在仓库根目录运行（使用现有 KWin 会话）：

```bash
gdbus call --session --dest org.kde.KWin --object-path /Scripting \
  --method org.kde.kwin.Scripting.loadScript \
  "$PWD/poc/kwin-workspace-api-probe.js" cc-niri-workspace-api-probe
```

返回 `(N,)` 是 script ID。用实际 N 替换下面的 `ScriptN`，仅启动此探针：

```bash
gdbus call --session --dest org.kde.KWin --object-path /Scripting/ScriptN \
  --method org.kde.kwin.Script.run
journalctl --user -f -o cat | rg --line-buffered '\[cc-niri-workspace-api\]'
```

测试后卸载；重复加载前也先卸载，避免重复监听：

```bash
gdbus call --session --dest org.kde.KWin --object-path /Scripting \
  --method org.kde.kwin.Scripting.unloadScript cc-niri-workspace-api-probe
```

默认 targetOutput 是最左、再最上的输出，与 cc-niri 默认一致。
如果日用脚本显式指定其它输出，在 `kwinrc` 的
`[Script-cc-niri-workspace-api-probe]` 组配置 `TargetOutputName` 后重新加载。
此探针不会自动读取日用脚本的配置组。日志会报告配置输出缺失及回退。

## 日志解释

每行带标签和 JSON，包括 sequence、毫秒时间戳、event。

- `desktops`：workspace.desktops 原始顺序；order 是零起始列表序号，
  x11DesktopNumber 仅用于观察，id 才是未来 Workspace 主键。
- `current`：每个输出的 Desktop，source 说明是否使用 currentDesktopForScreen；
  缺失时明确标记 global fallback，不能据此认为逐屏 API 已通过。
- `currentDesktopChanged`：实际 argumentCount、previous/current/output，
  isTargetOutput 只作标记；副屏事件也打印，以验证未来过滤逻辑。
- `window` / `window.desktopsChanged`：UUID、caption、output、desktops[]、onAllDesktops。
  覆盖启动时已有窗口和随后新增窗口。
- `missing-signal` / `read-error`：API 验证未通过，先调查再进入 W1。

API 参照：[KDE Plasma 6.7 WorkspaceWrapper 源码](https://github.com/KDE/kwin/blob/Plasma/6.7/src/scripting/workspace_wrapper.h)。
源码声明 currentDesktopChanged(previous, current, output)，以及
currentDesktopForScreen(output)；最终以目标机器日志为准。

## 人工验收（尚待实际交互）

准备至少两个已有 Desktop，记录动作和对应日志。不由探针创建或切换 Desktop。

| 动作 | 检查 |
| --- | --- |
| KDE Pager 切换并返回 | previous/current 稳定 ID、输出和 current 读数一致 |
| KDE 原生快捷键切换并返回 | 与 Pager 相同的信号语义；事件数量与时间戳 |
| Move Window to Desktop 并移回 | 同一 UUID 的 desktopsChanged；desktops[] 更新 |
| On All Desktops 开关 | onAllDesktops 与 desktops[] 的真实变化 |
| 开新窗口，再移动 Desktop | 新窗口自动接入监听，无重复监听 |
| 双屏分别切换（若 KDE 配置支持） | output 是否区分主副屏；各输出 current 是否独立 |

若 KDE 使用全局 Desktop 切换，记录其行为，不把输出为空或联动当作逐屏支持。
测试可能触发现有日用 cc-niri 的行为，建议在可控窗口环境进行。
只有实际信号行为确认可靠后进入 W1；Node mock 测试不代替此验收。

## 2026-09-30 验证记录

- 本机 `kwin-6.7.5-1.fc44.x86_64`：通过 loadScript + 单脚本 run 启动，
  journal 收到完整 startup 输出；随后 unloadScript 返回 true。
- 真实 API 暴露 currentDesktopForScreen；枚举到两个带稳定 ID 的 Desktop，
  当前输出 eDP-1、当前 Desktop 为桌面 1。
- 已有窗口可以读取 desktops[] / onAllDesktops；观察到 sticky surface 的
  desktops[] 为空且 onAllDesktops=true。未出现 missing-signal 或 read-error。
- `node tools/build.js`、`node tools/check.js --native` 通过：51 个测试文件，
  Bridge / Viewport clip / Plasmoid 三项本机 native 构建通过。生产 bundle 无变化。
- Pager、快捷键、Move to Desktop、sticky 切换、新窗口、双屏交互仍待人工验收；
  当前仅连接单输出，不能宣称双屏验证通过。远程 CI 未触发。

## 单内屏实测（2026-09-30，本轮结束）

用户确认当前仅笔记本内屏，双屏验收延后。
已重新加载只读探针，通过 KDE 原生 DBus setCurrentDesktop 完成 1 → 2 → 1，
并恢复原桌面 1。两次切换各收到一个 currentDesktopChanged，argumentCount=3，
previous/current ID 正确，output=eDP-1，isTargetOutput=true；
信号回调内 currentDesktopForScreen(eDP-1) 已返回目标 Desktop。
本次日志基线为 sequence 20；探针保留运行，继续观察人工操作。

待测：Pager、原生快捷键、窗口转移、Sticky 开关、新窗口。
上述 DBus 实测不替代 Pager/快捷键路径验收。

用户随后完成切换操作：sequence 22～61 共记录 12 次切换（6 次往返），
均为 argumentCount=3、output=eDP-1、isTargetOutput=true；
每次信号后的 currentDesktopForScreen 读数与 current ID 一致，无 API 错误，
最终返回桌面 1。按本轮提供的快捷键操作计为原生快捷键路径通过；
日志无法区分具体快捷键与 Pager，Pager 路径仍未单独确认。
下一项为窗口跨 Desktop 转移及移回；探针继续运行，日志基线 sequence 63。

窗口转移通过：Dolphin 同一 UUID 在 sequence 67 的 desktopsChanged 返回
仅桌面 2，sequence 73 返回仅桌面 1，两次 onAllDesktops=false。
对应 Desktop 切换 sequence 68/74 的输出与当前 Desktop 读数一致。
用户确认按步骤完成窗口移出、进入目标 Desktop 并移回。
下一项为 Sticky 开关；日志基线 sequence 77。

Sticky 开关通过：新 Dolphin UUID 在 sequence 79 首次被 windowAdded 监听，
初始仅属于桌面 1；sequence 82 的 desktopsChanged 为 desktops=[]、
onAllDesktops=true；sequence 97 恢复仅桌面 1、onAllDesktops=false。
期间 Desktop 往返信号与 per-output current 读数一致。
用户确认按步骤完成所有桌面可见性检查并恢复桌面 1。
这也实测验证了启动后新窗口自动接入监听，且随后能收到归属变化信号。
当前待确认仅为 Pager 路径；双屏按用户安排延后。日志基线 sequence 98。

用户确认当前面板没有 Pager，此项标记未测，不安装或调整面板。
本轮结束后 unloadScript 返回 true，已解除探针监听。

| 本轮验收项 | 结果 |
| --- | --- |
| 启动枚举及 currentDesktopForScreen(eDP-1) | 通过 |
| 原生 DBus Desktop 切换并返回 | 通过 |
| 用户原生快捷键往返切换 | 通过 |
| 窗口单 Desktop 转移并移回 | 通过 |
| Sticky 开关及恢复单 Desktop | 通过 |
| 新窗口接入并监听归属变化 | 通过 |
| Pager 点击路径 | 未测，当前无 Pager |
| 双屏及副屏 output 过滤 | 延后，当前仅内屏 |

结论：当前单屏环境所需的读取、切换和窗口归属信号已实测可用，
可以据此继续 W2。此结论不覆盖 Pager 路径或双屏行为；
双屏接入后仍需补测 output 过滤与逐屏 current 语义。
