# PUB UI prototype (throwaway)

Question: can a GNOME extension look as good as the CodexBar macOS popover, while using PUB's Strip + Overview + Detail information architecture?

Three structurally different variants, switch with `?variant=A|B|C` or the bottom bar.

```bash
python3 -m http.server 4173 --directory prototype --bind 127.0.0.1
```

Then open http://127.0.0.1:4173/?variant=A

## Round 2: `redesign.html` (GNOME-native, 2026-09-15)

Question: which information architecture reads best inside GNOME Shell, and where do Settings live?
Colours follow a fake Shell theme (dark/light toggle in the badge) instead of hard-coded light values.
Data is the real `~/.cache/pub/snapshot.json` from 2026-09-14 (Claude was HTTP 429 at the time).

- `?variant=A` List · Strip 单行数字；Popover 列表 Overview，点行推入 Detail；Enabled/Pinned/顺序在 Popover，登录去 prefs 窗口
- `?variant=B` Board · Strip 只有图标+细条；Popover 一屏铺开全部 Provider 与全部 Window；Settings 全部去 prefs 窗口
- `?variant=C` Ring · Strip 圆环+数字；Popover 2 列仪表网格，点 tile 就地展开；Pinned/顺序在 Popover 编辑模式

Verdict (2026-09-15): variant A of `redesign.html` won and is implemented on `main`. B and C are kept here for reference only.

Deep-link a state for screenshots: `&s=page:detail`, `s=page:settings`, `s=selected:codex,page:provider`, `s=selected:claude,page:provider,login:waiting`, `s=signedout:claude,selected:claude,page:provider`, `s=theme:light`, `s=edit:1`, `s=pop:0,ctx:1`, `s=mode:used`.

2026-09-15 决定：Strip 与 Popover 都用 A。A 的设置页第二版：Provider 列表行显示登录状态 + Pin 图标 + 拖动排序；点行进入 Provider 页（登录卡片按凭据类型分 CLI 浏览器授权 / 打开页面粘贴，监视、固定、Primary Window）。B、C 仅留作对照。

http://127.0.0.1:4173/redesign.html?variant=A
