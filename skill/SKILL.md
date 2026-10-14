---
name: pw-accounts
description: 用已预先登录的账号调试项目页面（多账号 Playwright 会话）。当需要以某个已登录身份查看/操作/截图本项目界面、对比不同角色看到的页面、或用户说“用 xx 账号看一下页面”时使用；项目根目录存在 .playwright/accounts.json 时优先用它，而不是 chrome-devtools MCP。
---

# pw-accounts：多账号会话调试

`pwa` 封装了 `playwright-cli`：每个账号对应一个持久化浏览器 profile（存放在仓库外的 `~/.pw-accounts/<id>/<account>`），
登录由用户人工完成，agent 直接复用登录态，token 刷新会自动写回 profile。

## 使用流程

```bash
pwa list                              # 查看当前项目有哪些账号、是否有登录态、会话是否打开
pwa open <account> [path|url]         # 无界面打开；已打开则跳转。相对路径会拼到账号入口的 origin
pwa <account> snapshot                # 之后的命令都透传给 playwright-cli
pwa <account> click e15
pwa <account> screenshot
pwa <account> console                 # 其余命令见 playwright skill 或 pwa <account> --help
pwa close <account>                   # 调试结束必须用它正常关闭
```

会话名就是账号名，并且只在当前项目内可见。

## 规则

- **不要自己登录**：`pwa open` 返回退出码 3 或提示“尚未登录过”时，停下来请用户在自己的终端执行 `pwa login <account>`。不要尝试填写账号密码或验证码，也不要执行 `pwa login`（它需要交互式终端）。
- **只用 `pwa close` 关闭**，不要用 `playwright-cli kill-all` 或杀进程，否则可能丢失刚刷新的 token，导致账号掉线。
- **不要直接调用 `playwright-cli open`**，它不会带上账号的 profile。会话未打开时用 `pwa open`。
- **不要用 `pwa reset`**，除非用户明确要求清除登录态。
- **跨 origin 不共享登录态**：token 存放在 localStorage，按 协议+域名+端口 隔离。只用相对路径，或者与账号 `url` 同 origin 的地址；换端口、`localhost` 改成 `127.0.0.1` 都等于未登录。
- 同一账号同一时间只能有一个浏览器使用（profile 会被锁）。不同账号可以同时打开，用来对比不同角色看到的页面。
- 当前目录找不到 `.playwright/accounts.json`，或者需要的账号不存在时，告诉用户在终端执行 `pwa` 进行初始化、添加账号。不要自行编造账号入口地址，也不要自己修改 accounts.json。
- 优先用 `snapshot` / `find` 读取页面结构，只在需要看视觉效果时才 `screenshot`，以节省 token。

## 配置格式（`.playwright/accounts.json`）

```json
{
  "id": "xxx-web-k3f9x2",
  "loginPattern": "/login|/oauth|sso\\.",
  "accounts": {
    "test-admin": { "url": "https://test.example.com/", "desc": "test 环境集团管理员" },
    "local-admin": { "url": "http://localhost:5173/", "desc": "本地 dev server", "loginPattern": "/login" }
  }
}
```

- `id`：初始化时生成，决定 profile 存放目录，不要修改。
- `loginPattern`：JavaScript 正则，匹配当前 URL，命中即视为登录态失效。可以在账号级别覆盖。
