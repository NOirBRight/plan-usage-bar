# PUB

PUB (Plan Usage Bar) 监视各 coding Provider 的 Plan Quota，并在任务栏上并排显示。它不是 CodexHub，也不 fork CodexBar。

## Language

**PUB**:
一台机器上的 Plan Quota 监视器：Strip 上的 Control Icon 加 Pinned Meter，点开后是 Popover 里的 Overview / Detail。
_Avoid_: CodexBar, usage widget, tray app

**Strip**:
任务栏右侧那一条 PUB 区域：最左是常驻的 Control Icon，右边按用户顺序最多 6 个 Pinned Meter。点 Control Icon 或任一 Meter 打开同一扇 Popover；点 Meter 时 Overview 选中对应 Provider。
_Avoid_: 一排独立托盘图标, panel applet（实现用语）

**Control Icon**:
Strip 最左侧的 PUB 总标。左键打开 Popover；右键菜单含退出、设置（及开机自启等）。它不是某个 Provider，也不显示百分比。
_Avoid_: tray icon, app indicator, 主图标（口语可以）

**Enabled**:
会去拉取 Plan Quota 的 Provider 集合。不在其中的不抓、不出现在 Overview。
_Avoid_: installed, connected

**Pinned**:
Enabled 的子集，出现在 Strip 上当 Meter。未 Pinned 的 Enabled 只在 Overview 里。
_Avoid_: favorite, visible, 显示名单（口语可以）

**Account**:
某个 Provider 背后的一份登录身份。v1 每个 Provider 只用当前默认 Account 占一块 Meter；其余 Account 只出现在 Detail。
_Avoid_: user, profile, login

**Popover**:
从 Strip 向下展开的宽面板：左 Overview、右 Detail。点 Strip 或点外面关闭。不是常驻窗口，也不进应用列表。
_Avoid_: window, dashboard, dock

**Remaining**:
任务栏和 Overview 默认的百分比读法：还剩多少。可全局切成已用。同一时刻所有 Provider 只用一种读法。
_Avoid_: used（默认）, percent（没说方向）

**Provider**:
一个有名字的 coding 后端，至少暴露一个 Plan Quota。本机无限的本地推理不是 Provider。
_Avoid_: integration, plugin, source, backend

**Plan Quota**:
订阅或包含额度池里还剩多少。百分比来自某个 Quota Window。
_Avoid_: rate limit, status, credits（仅当对方以美元额度计价时再在 Detail 里出现，不代替本词）

**Quota Window**:
Plan Quota 的一次重置周期，例如 5 小时 Session、Weekly、Monthly。
_Avoid_: limit, bucket, lane

**Primary Window**:
该 Provider 出现在任务栏和 Overview 上的那一个 Quota Window。默认取最大总量（Weekly 或 Monthly），可改。
_Avoid_: overall usage, total, 整体用量

**Meter**:
Strip 上一个 Provider 的一块：图标、Primary Window 的 Remaining 百分比、一条进度条。
_Avoid_: chip, icon, indicator, tray item

**Overview**:
点开后的侧栏，列出全部 Enabled Provider。每一行只反映该 Provider 的 Primary Window。未 Pinned 的也在这里，方便对照，不占 Strip。
_Avoid_: sidebar, 总览（口语可以，模型里用 Overview）

**Detail**:
Overview 中选中某一 Provider 后，展示它全部 Quota Window 及重置时间等细节。
_Avoid_: dashboard, popup page

**Settings**:
Popover Overview 里单独的设置 Tab，管 Enabled、Pinned、顺序、Primary Window、Remaining/Used、登录自启，以及每个 Provider 的登录（粘贴 token，不经过 DSH，也不必装官方 CLI）。
_Avoid_: preferences window, 第二扇窗口

**Exit**:
Control Icon 右键「退出」：停止拉取并隐藏 Strip，直到再次启用。不是关掉 gnome-shell。
_Avoid_: quit process（PUB 的可见外壳是扩展，不是独立 GUI 进程）

**Snapshot**:
某一时刻全部 Enabled Provider 的 Plan Quota 画面。Strip 和 Popover 只读 Snapshot，不直接找各家接口。
_Avoid_: payload, usage JSON（实现用语）

**Ollama Cloud**:
Ollama 托管套餐，是 Provider。本机 `ollama` 进程不是。
_Avoid_: Ollama（单独使用时会把本地和 Cloud 混在一起）
