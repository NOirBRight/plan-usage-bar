# GJS 画外壳，无界面 Engine 出 Snapshot

GNOME 扩展适合画 Strip 和 Popover，不适合在 GJS 里读 Cursor 的 SQLite、刷四家 HTTP、刷新 token。再挂托盘或 Qt 窗口会破坏「扩展就是外壳」。

决定：扩展只读 Snapshot、只负责界面和启用/退出。无界面 Engine 按 Enabled 列表拉取并打印 JSON。默认 5 分钟一次，打开 Popover 时加拉一次。Remaining ≤20% 警告色，≤5% 危险色；v1 不做桌面通知。Engine 用 TypeScript，不把 Node 嵌进 gnome-shell。
