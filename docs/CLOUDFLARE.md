# WORDS 个人版免费部署与同步

使用 Cloudflare Workers Static Assets、D1 和 GitHub OAuth。现有 React/Vite 页面与完整压缩词典保留。只有 `ALLOWED_GITHUB_ID` 对应的 GitHub 用户可访问个人数据；当前配置为 poku4916-bit 的固定账号 ID `266625893`。账号改名不会改变此 ID。

当前网站：[WORDS](https://words-notebook.words-notebook.workers.dev)。2026-10-12 已完成 D1 迁移、生产部署和 GitHub OAuth 配置，真实登录回调成功，页面显示“已同步”。在线查询 interaction 后，已核验其个人单词、初始进度和查询事件自动写入 D1。两台独立设备的数据合并、离线编辑及断线重试由自动化测试验证，尚未进行真实手机与电脑之间的同时操作验收。

## 第一次配置

需要 Node.js 22.12+、GitHub 账号和 Cloudflare 免费账号。无需购买域名、服务器、短信或邮件服务。

```powershell
npm.cmd ci
npx.cmd wrangler login
npm.cmd run cloudflare:setup
npm.cmd run build
npx.cmd wrangler deploy
```

`cloudflare:setup` 优先复用名称为 `words-personal` 的 D1 数据库，缺少时创建，并将平台返回的真实数据库 ID 写入 `wrangler.jsonc`，然后应用迁移。不要把数据库 ID 随意替换成示例值。首次部署时登录尚未启用，个人同步接口拒绝访问，本机功能可继续使用。

在 GitHub 的 **Settings → Developer settings → OAuth Apps → New OAuth App** 创建登录应用：

- Application name：WORDS Personal
- Homepage URL：首次部署返回的完整 HTTPS 网站地址
- Authorization callback URL：网站地址加 `/api/auth/callback`
- 不启用 Device Flow

创建后，分别通过终端交互写入 Cloudflare Secrets；输入值不进入 Git、前端代码或命令行参数。也可在 Cloudflare 控制台设置同名加密 Secrets：

```powershell
npx.cmd wrangler secret put GITHUB_CLIENT_ID
npx.cmd wrangler secret put GITHUB_CLIENT_SECRET
npm.cmd run cloudflare:deploy
```

登录仅请求公开账号身份，不申请仓库读写权限。令牌交换在 Worker 完成，GitHub 令牌只用于取得账号 ID，不持久保存；浏览器使用 HttpOnly、Secure、SameSite=Lax 的随机会话 Cookie，D1 只保留其 SHA-256 摘要。写接口检查请求 Origin。OAuth 的一次性 state 与短期 Cookie 必须匹配。

## 日常使用

点击“账户与同步”登录。登录成功会自动拉取云端数据，与本机已有数据合并，再上传本地变更。已登录设备打开页面、重新联网或回到页面时同步；编辑后约 1.5 秒上传，打开的可见页面每 30 秒检查变化。状态显示“同步中”“已同步”“待同步”或错误信息。

同步范围：个人单词、词本、分类归属、笔记、暂停状态、复习日程、查询与复习事件、学习时区/词数/快捷键。词典释义仍从静态分片下载缓存，不上传整个词典；新设备下载已收藏单词所需的词典分片，不新增查询事件。当前练习会话不跨设备同步。

旧 ChatGPT Site、localhost 和新 Cloudflare 地址各有独立的 IndexedDB。先在旧地址“设置 → 备份恢复”导出 JSON，再到新网站导入一次。不要在验证迁移前清除旧站数据。

## 同步与冲突规则

- 本地版本 1 数据库升级到版本 2，保留既有表，只增加云端基线、待上传队列和同步元数据。
- 每条记录单独同步。删除是持久的 tombstone；已观察到删除后重新收录是新的显式操作，旧离线编辑不会复活删除的记录。
- 每个操作有随机 ID 和预期云端版本。D1 在事务内校验版本并记录操作；重试不会重复写入，旧请求不能回滚新版本。请求丢失确认时，队列和本地变更保留。
- 字段使用三方合并。双方修改的不同笔记保留在 `[同步冲突笔记]` 下。超出笔记上限时暂停该同步、保留待传数据并提示处理。
- 并发复习的不同事件全部保留，日程采用较晚的评估（以设备时间为依据），计数至少包含全部独立的计划复习事件。因此设备时间应正常校准。
- 本地写入和上传确认之间发生的新编辑会重新排队。浏览器 Web Locks 协调多个标签页；不支持该 API 的浏览器提示升级而不会冒险同步。
- 查询统计从去重后的事件重算。删除单词/词本会清理本地关联与未完成练习队列。退出登录不清除当前设备的数据；使用自己的设备，备份功能继续可用。
- 同步采用分页与小批写入；不会反复上传整个 JSON 备份。完整云端变化日志用于幂等和恢复，不主动清除。长期大量记录可能接近数据库免费额度，需要查看控制台用量。

## 更新与验证

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run cloudflare:deploy
```

本机全栈预览：`npm.cmd run cloudflare:dev`，访问 `http://127.0.0.1:8787`。若测试真实 OAuth，将 `.dev.vars.example` 复制为 `.dev.vars` 并配置单独的 localhost 回调应用。该文件被 Git 忽略，不能提交。生产 Secrets 与本地值分别配置。

GitHub 源码仓库可以公开，D1 个人数据和 Secrets 不属于源码。`.openai/hosting.json` 保留旧 Sites 项目身份，Cloudflare 部署使用独立的 `wrangler.jsonc`。部署到 Cloudflare 不会修改、关闭或公开旧 Site。

免费额度参考：静态资源访问免费，Worker 每日 10 万次请求；D1 每日 500 万行读取、10 万行写入，免费单库 500 MB、账户合计 5 GB。免费额度耗尽会影响服务；个人正常使用预计在额度内。不要启用付费计划作为部署前提。

官方资料：[Workers 计费](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)、[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)。
