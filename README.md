# pw-accounts（pwa）

基于 Playwright 的多账号调试环境：每个测试账号由你**人工登录一次**，登录态保存在独立的浏览器 profile 中，之后 Claude / Codex 直接以该身份打开页面调试，无需重复登录、过验证码，也不再依赖 chrome-devtools MCP。

> 本文面向人阅读。agent 侧的调用约定见 `skill/SKILL.md`，由 `pwa setup` 安装到 `~/.claude/skills` 与 `~/.codex/skills`。

---

## 1. 安装

前置条件：Node.js 20.12 及以上；Linux / WSL 需要图形界面（WSLg，`echo $DISPLAY` 有值），用于登录时弹出浏览器窗口。

> 目前只在 WSL2（Ubuntu）上验证过。macOS 与 Windows 原生环境理论上可用，遇到问题欢迎提 issue。

```bash
npm i -g @zerolinkspace/pw-accounts
pwa
```

第一次执行 `pwa` 会提示完成安装（等同于执行 `pwa setup`），它会：

- 下载 Playwright 自带的 Chromium（约 120 MB，放在 `~/.cache/ms-playwright`，与日常使用的 Chrome 互不影响）
- 把 agent skill 安装到 `~/.claude/skills/pw-accounts/`（存在 `~/.codex` 时也会安装到那里）
- 在全局 gitignore 中加入 `.playwright/` 与 `.playwright-cli/`

之后随时可以用 `pwa doctor` 检查环境。

**升级**：`npm i -g @zerolinkspace/pw-accounts@latest`，然后执行一次 `pwa`。新版本的 agent skill 有变化时会提示重新安装。

## 2. 快速开始

```bash
cd ~/workspace/frontend/xxx-web
pwa
```

第一次在项目里执行 `pwa` 会进入初始化向导：选择项目目录、确认登录页地址特征、添加第一个账号，然后可以直接登录。

登录时会弹出浏览器窗口，在里面完成账号密码、验证码登录即可。页面离开登录页并稳定几秒后会**自动保存**并关闭窗口；如果登录后页面地址没有变化，回到终端按回车保存。

之后就可以让 agent 调试，例如告诉 Claude / Codex：「用 test-admin 看一下 /system/user 页面的表格显示」。

## 3. 交互菜单

在项目里执行 `pwa`（不带参数）进入菜单：

| 菜单项 | 说明 |
|---|---|
| 查看账号 | 账号列表、是否有登录态、会话是否在运行 |
| 登录账号 | 弹出浏览器窗口人工登录。已有登录态时可选择直接打开（SSO 有效时会自动跳回），或清空后重新登录 |
| 添加 / 修改 / 删除账号 | 维护 `.playwright/accounts.json`；删除账号会一并删除其登录态 |
| 打开浏览器旁观 | 以有界面方式打开账号，可以看着 agent 操作 |
| 关闭会话 | 正常关闭正在运行的浏览器（登录态随之落盘） |
| 清理无用的登录态 | 找出项目已删除、已重新初始化或账号已移除的 profile，勾选后删除 |
| 环境检查 | 同 `pwa doctor`，有问题时可以直接执行 `pwa setup` 修复 |

## 4. 命令参考

agent 使用下面这些命令，你也可以直接用：

| 命令 | 谁来执行 | 说明 |
|---|---|---|
| `pwa` | 你 | 交互菜单 |
| `pwa setup` / `pwa doctor` | 你 | 安装 / 检查环境 |
| `pwa init` | 你 | 在当前目录创建 `.playwright/accounts.json`（菜单里的初始化向导做的是同一件事） |
| `pwa list` | 任何人 | 列出账号、是否有登录态、会话是否打开 |
| `pwa login <账号>` | **只能是你** | 有界面打开入口人工登录。需要交互式终端，agent 调用会被拒绝 |
| `pwa open <账号> [路径\|URL] [--headed]` | agent / 你 | 无界面打开；会话已打开时只做跳转。相对路径会拼接到账号入口的 origin 上。`--headed` 以有界面方式打开 |
| `pwa <账号> <playwright-cli 命令...>` | agent / 你 | 透传到该账号的会话，如 `snapshot`、`click e15`、`screenshot`、`console`、`requests` |
| `pwa close <账号>` | agent / 你 | 正常关闭会话 |
| `pwa reset <账号>` | 你 | 删除该账号的登录态 |

`pwa` 从当前目录逐级向上找最近的 `.playwright/` 目录作为项目根，因此在项目任意子目录下执行都可以。

退出码：`0` 成功；`1` 一般错误（找不到配置、账号不存在、尚未登录过、会话未打开等）；`3` 页面落在登录页，登录态已失效，需要重新登录。

## 5. 配置文件

`.playwright/accounts.json`（一般通过菜单维护，也可以手工编辑）：

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

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 初始化时自动生成（项目目录名 + 随机后缀），决定登录态存放在 `~/.pw-accounts/<id>/`。不要修改，改了相当于全部账号未登录 |
| `loginPattern` | 否 | JavaScript 正则，匹配当前页面 URL；命中即判定「未登录 / 登录态失效」，也用于登录时自动保存。为空则不检测 |
| `accounts.<名称>.url` | 是 | 账号入口地址，同时决定该账号登录态所属的 origin |
| `accounts.<名称>.desc` | 否 | 说明文字 |
| `accounts.<名称>.loginPattern` | 否 | 覆盖顶层 `loginPattern` |

- `loginPattern` 写在 JSON 里时反斜杠需要转义：匹配字面点号写成 `\\.`。它应能匹配登录页**跳转后**的地址；登录走统一 SSO 时，匹配 SSO 域名即可（如 `sso\\.`）。
- 账号名建议用 `<环境>-<角色>` 的形式，如 `test-admin`、`local-supplier`。不能与子命令同名。

**共享账号清单**：配置里只有入口地址和说明，不含任何凭据。团队仓库可以用 `git add -f .playwright/accounts.json` 提交，同事拉取后执行 `pwa` → 登录账号即可，各自的登录态仍只保存在自己机器上。外部客户的仓库不要提交。

## 6. 常见场景

**对比不同角色看到的页面**：不同账号可以同时打开，互不影响。

```bash
pwa open test-admin /order/list
pwa open test-supplier /order/list
pwa test-admin screenshot
pwa test-supplier screenshot
```

**旁观 agent 的操作**：菜单里选「打开浏览器旁观」，或者 `pwa open test-admin /order/list --headed`。会话已经以无界面方式打开时 `--headed` 不会生效，菜单会提示先关闭再重新打开。

**登录态失效**：agent 执行 `pwa open` 得到退出码 3 时会停下来提醒你，在自己的终端执行 `pwa login test-admin`（或在菜单里选「登录账号」）。

**本地 dev server 与 test 环境**：两者是不同的 origin，登录态不共享，需要配置成两个账号并分别登录。

## 7. 隔离与安全

- **项目之间**：配置在各自项目内；登录态按 `id` 分目录存放；`playwright-cli` 的会话按项目隔离，不同项目的同名账号互不冲突。
- **不入库**：`.playwright/` 已加入全局 gitignore，不会误提交到任何仓库。
- **权限**：`~/.pw-accounts` 与各账号目录权限为 `700`。profile 中保存的是**有效登录态**，等同于账号凭据，不要拷贝、打包或分享。
- **只放测试账号**：不要为生产账号创建登录态。
- 项目结束后用菜单里的「清理无用的登录态」删除对应 profile，或直接 `rm -rf ~/.pw-accounts/<id>`。

## 8. 注意事项

1. **入口 origin 要固定。** token 存放在 localStorage，按「协议 + 域名 + 端口」隔离。换端口、`localhost` 与 `127.0.0.1` 互换，都相当于未登录。本地 dev server 建议固定端口（如 vite 设置 `server.strictPort: true`）。
2. **用 `pwa close` 正常关闭。** Chromium 写 localStorage 是延迟落盘的，强杀进程可能丢失最近一次刷新的 token；如果 refresh token 是轮换式的，账号会因此掉线。
3. **同一账号同一时间只能有一个浏览器使用。** profile 目录会被 Chromium 锁定。登录前会先关闭该账号已打开的会话。不同账号之间没有这个限制。
4. **`pwa login` 必须在独立终端中执行。** 在 Claude Code 中用 `!` 前缀执行无法回车确认。
5. **`.playwright-cli/` 会在当前目录生成。** 里面是 snapshot、截图和日志文件，可随时删除，已被全局 gitignore 忽略。
6. **用 fnm / nvm 管理 Node 时**，全局安装的包跟着 Node 版本走，切换 Node 版本后需要重新 `npm i -g @zerolinkspace/pw-accounts`。

## 9. 故障排查

| 现象 | 处理 |
|---|---|
| `npm i -g` 装不到刚发布的版本 | 使用 npmmirror 等镜像源时需要等几分钟同步，或加 `--registry=https://registry.npmjs.org/` |
| `Chromium 未安装` | 执行 `pwa setup` |
| `未找到 .playwright/accounts.json` | 当前目录不在已初始化的项目内，在项目根目录执行 `pwa` |
| `尚未登录过` | 该账号还没有登录态，执行 `pwa login <账号>` |
| `会话 xxx 未打开` | 透传命令前需要先 `pwa open <账号>` |
| 登录时没有弹出窗口 | `pwa doctor` 检查图形界面；WSLg 异常时在 Windows 侧执行 `wsl --shutdown` 后重开终端 |
| 打开时报 profile 被占用 | 该账号已有浏览器在使用（可能在另一个终端或同项目的另一份副本中），先 `pwa close <账号>` |
| 刚登录完又提示失效 | 检查 `loginPattern` 是否过宽，误匹配了正常业务页面的 URL |
| 一直提示失效 | 菜单里「登录账号」→「清空后重新登录」 |

## 10. 卸载

```bash
npm rm -g @zerolinkspace/pw-accounts
rm -rf ~/.claude/skills/pw-accounts ~/.codex/skills/pw-accounts
rm -rf ~/.pw-accounts                      # 删除所有登录态
# 从全局 gitignore（一般是 ~/.config/git/ignore）删除 .playwright/ 与 .playwright-cli/ 两行
```

如需把登录态放在其他位置，可设置环境变量 `PWA_HOME`（默认 `~/.pw-accounts`）。

## 11. 发布新版本（维护者）

发布到 npmjs 的 `@zerolinkspace` 组织，`publishConfig` 已锁定 npmjs 地址与 public 访问权限，默认源是镜像时也不会发错地方。

```bash
npm login                  # 需要是 @zerolinkspace 组织成员，账号务必开启 2FA
npm version patch          # 或 minor / major
npm publish                # 开启 2FA 时会要求输入一次性验证码
```

使用者机器上保存着有效登录态，包一旦被篡改后果严重，所以发布账号必须开启 2FA，也不要在 CI 里存放长期有效的发布 token。

改动了 `skill/SKILL.md` 的版本，使用者升级后执行 `pwa` 会被提示重新安装 skill。`@playwright/cli` 的版本是锁死的，升级它会改变 Chromium 版本，需要使用者重新执行 `pwa setup` 下载浏览器（同样会被自动提示）。
