# Upstream basis

This applet is a minimal fork of KDE Plasma Desktop's Task Manager applet at
tag `v6.7.5` (`43f55fff3480c6eb5f60133f045bfc74b9c67d84`). Its original SPDX
headers and GPL-2.0-or-later licensing are preserved. CC-specific state,
Bridge IPC, logical order, Presentation commands, and active-task appearance
live under `qml/cc/`; upstream-derived files retain only thin controller calls
and visual bindings.
