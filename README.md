# WORDS. 英文词典与单词本

根据 [产品设计](docs/DESIGN.md)、[前端设计](docs/FRONTEND_DESIGN.md) 和 [GitHub 调研](docs/GITHUB_RESEARCH.md) 独立实现的 React + TypeScript + Vite 静态网页。

## 运行

需要 Node.js 22.12+（开发环境使用 Node.js 24）。在项目目录中运行：

```powershell
npm.cmd ci
npm.cmd run dev
```

打开终端显示的本地地址，默认 `http://127.0.0.1:5173/`。Windows PowerShell 可使用 `npm.cmd`，避免 npm.ps1 的脚本执行策略限制；macOS / Linux 使用 `npm`。

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node scripts/check-budgets.mjs
npm.cmd run preview
```

生产预览默认为 `http://127.0.0.1:4173/`。构建产物位于 `dist/`，包含应用、完整词典分片与许可。Vite 配置相对 `base` 与 Hash 路由，可部署到子目录。线上配置、访问权限与发布流程见 [部署说明](docs/DEPLOYMENT.md)。

## 第一版功能

- 查词：中文释义汇总、英文多义项、音标、按 WordNet 义项区分的近义词和例句；已保存词条优先从本地读取。
- 收录：明确提交的成功查询自动加入“我的单词”；大小写与首尾空格去重，查询事件唯一；刷新词条页只恢复展示，不新增查询。
- 词本：创建、重命名、删除分类词本、多词本归属、笔记、筛选、排序、批量分类、暂停/恢复、删除与 12 秒撤销。
- 学习：翻卡、中文提示回忆英文、拼写、今日复习与自由练习；1 / 3 / 7 / 14 / 30 天间隔；忘记 10 分钟后到期，本轮可重练一次，重练不再次推进日程。
- 会话：固定队列、事务评分去重、刷新后恢复本轮、跨标签页重读；每轮最多 20 个不同词，今日队列最多补 10 个新词。
- 备份：JSON 导出、20 MiB 上限、导入预览与事务合并；事件去重、查询历史重算、较新进度优先、不同笔记保留、分类冲突重映射。
- 界面：中文界面、纸面与森林绿视觉、桌面/手机布局、语义化控件、原生 dialog 焦点管理、减少动画、可关闭的学习快捷键、IME 防误提交。

所有个人数据保存在当前浏览器 IndexedDB；少量偏好保存在 localStorage。没有账号或云同步。清理浏览器数据、换设备或换域名不会自动迁移词本，请先导出备份。

## 词库与复现

使用完整 ECDICT 固定提交与 Princeton WordNet 3.0：**772,845 条词条、512 个分片**。详见 [实际覆盖与来源报告](docs/DICTIONARY_REPORT.md)。整体双语覆盖约 29.97%；其余词可能缺少一种语言，界面明确提示；默认拼写题仅选有可靠双语内容的词。中文和英文义项分别来自不同数据源，不宣称逐条对齐。

已生成词库位于 `public/dictionary/`，普通构建不下载原始数据。需要重新生成时：

```powershell
node scripts/download-dictionary.mjs
npm.cmd run dictionary:build
```

下载脚本固定源版本与 SHA-256，原始数据缓存在被忽略的 `.cache/dictionary/`。WordNet 官方站点在当前环境无法直连，采用固定提交的 NLTK 原版 WordNet 3.0 分发包；报告注明传输来源与比对边界。许可证保留在 `public/licenses/`，字体使用 Newsreader / Inter，中文使用系统字体。

## 开发边界

开发服务另有 `http://127.0.0.1:5173/component-showcase.html` 内部检查页，展示按钮、空状态、错误反馈、弹窗焦点，以及真实 `light` 词条全部 48 条英文义项和明确标注的长笔记测试数据。该页只读词典、不写入个人数据，不进入产品导航，也不包含在默认生产构建中。

第一版的个人数据保存在浏览器；应用已打开且词条已保存时可以断网学习。尚未实现完整离线启动、Service Worker、云同步或在线增强 API。备份结构不合法时整体拒绝，避免部分导入造成关联破损；不自动恢复备份中的学习会话。

验收情况与未完成验证见 [实施与验证记录](docs/IMPLEMENTATION.md)。静态资源预算是 gzip 压缩后的构建测量，不能等同于实际托管后的 Core Web Vitals。
