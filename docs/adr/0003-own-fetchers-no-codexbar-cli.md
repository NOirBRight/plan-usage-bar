# v1 自己拉用量，不依赖 CodexBar CLI

若数据层壳一层 `codexbar usage`，用户还要装 CodexBar，产品和登录边界会再糊一次。本机已有 Claude / Codex / Cursor / Grok 的登录态文件，足够直接请求各家用量接口。

决定：v1 四个 Provider 由 PUB 自己的适配器读取现有登录态并拉 Plan Quota。后续 OpenCode Go、Command Code、Antigravity、Ollama Cloud 走同一适配器接口。不把 CodexBar 当运行时依赖。
