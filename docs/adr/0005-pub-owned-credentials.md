# 登录态归 PUB，官方 CLI 只是回退

读 `~/.dsh` 会把 PUB 绑到 DSH 的 home 和账号文件，没装官方 CLI 的人也拿不到进度。

决定：设置里粘贴各 Provider 的 token，写到 `credentials.json`。Engine 先读这份，再回退官方 CLI home（`~/.claude`、`~/.codex`、`~/.config/cursor/auth.json`、`~/.grok`）和 `OLLAMA_API_KEY`。不读 DSH home。
