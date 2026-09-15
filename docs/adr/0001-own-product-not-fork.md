# 自研 PUB，不 fork CodexBar

CodexBar 的信息架构是「一个托盘入口 + 页签切 Provider」，Linux 只是 CLI 加别人做的皮。PUB 要任务栏并排多个 Meter，点开是 Overview 侧栏加 Detail。在 CodexBar / TuxMeter 的壳上改会一直对抗「一次突出一个 Provider」。

决定：产品与界面自研。数据用 Provider 适配器接入，见 0003。
