# 可见外壳是 GNOME 扩展

GNOME 顶栏里要画 Control Icon 加多个带文字的 Meter。AppIndicator 每个进程只能挂一个图标，做不到并排 Meter。再做一条 layer-shell 顶栏会和系统栏重复。

决定：PUB 的可见外壳就是 GNOME Shell 扩展。右键退出 = 禁用扩展（Strip 消失、停止拉取）。`pub` 与登录自启 = 启用扩展。不进应用列表，不做 Qt/托盘窗口。设置留在 Popover 里。
