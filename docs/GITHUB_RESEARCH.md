# 英文词典与单词本网站：GitHub 调研

调研日期：2026-10-10（北京时间）  
需求：搜索英文单词，查看多种含义、中英双语释义与近义词；自动记录查过的词，整理成单词本，再根据单词本学习。先完成基础网页，部署安排在后续阶段。

## 1. 调研结论

**有相似项目，但本次候选中，没有一个经过验证可以直接满足全部需求。建议独立构建轻量网页，参考现有项目的功能和交互，复用有明确来源的数据。**

- 功能流程最接近的是 **Lexicon**：查词、建立词单、根据词单测验都有现成设计，但技术栈较旧，且没有实现单词掌握度与间隔复习。
- 查词页面可参考 **dictionary-web-app-react-ts**：体量较小，技术栈接近拟采用的 React + TypeScript + Vite，但需要增加双语词典、单词本与学习模块。
- 学习交互可参考 **Qwerty Learner**：拼写、音标、发音与练习反馈比较贴合后续学习功能。
- **Dictionariez** 可参考查词历史与导出流程；它是浏览器扩展，不适合直接作为独立网站的基础。
- **VocabGen** 已包含查词、数据管理与闪卡学习，但依赖 LLM 服务配置，更适合作为扩展功能参考。

以上是根据仓库说明、部分源码和当前提交信息作出的选型判断；本轮没有安装或运行这些项目，也没有验证其线上演示。

## 2. 候选项目对比

最新提交日期按 GitHub 默认分支最近一次提交计算，转换为北京时间；不等同于功能发布或安全维护日期。

| 项目 | 与需求相关的已有能力 | 技术方案 | 主要缺口 / 采用方式 | 仓库许可证 | 最新提交日期 |
| --- | --- | --- | --- | --- | --- |
| [dbodow/lexicon](https://github.com/dbodow/lexicon) | 词典搜索、词单管理、按词单测验；README 说明当前只支持近义词题 | Rails 5、PostgreSQL、React/Redux | 最适合参考完整流程；双语和间隔复习需要补充，基础架构偏重 | GitHub 未识别出许可证，本轮未找到根目录许可证 | 2018-02-23 |
| [ucod3/dictionary-web-app-react-ts](https://github.com/ucod3/dictionary-web-app-react-ts) | 查词、释义、近义词、发音、响应式与主题切换 | React、TypeScript、Vite、SWR | 可参考查词界面；没有在已核查内容中看到单词本与学习流程 | MIT | 2026-07-19 |
| [RealKai42/qwerty-learner](https://github.com/RealKai42/qwerty-learner) | 词库、键盘拼写、音标发音、默写与正确率反馈 | React、TypeScript、Vite；依赖中包含 Dexie | 可参考学习交互；以已有词库练习为主，需要新增自由查词到个人词本的流程 | GPL-3.0 | 2026-09-08 |
| [pnlpal/dictionariez](https://github.com/pnlpal/dictionariez) | 多词典查词、历史、发音、Anki 导出 | 浏览器扩展；AngularJS 等 | 可参考历史和词条整理；扩展架构与当前网站目标不同 | GPL-2.0 | 2026-10-08 |
| [npozs77/VocabGen](https://github.com/npozs77/VocabGen) | 网页查词、批量处理、闪卡、自评、数据管理 | Go、SQLite、LLM 服务接入 | 可参考闪卡与导入导出；第一版引入 LLM 会增加配置和运行成本 | MIT | 2026-10-01 |

功能描述来源于各项目 README；技术方案另核对了适用项目的 package.json 或 go.mod。许可证名称按仓库当前声明记录，具体复用时以所复制文件对应的许可证为准。

### 查词项目源码中值得避免的问题

在已核查的 [useSearchWord.tsx](https://github.com/ucod3/dictionary-web-app-react-ts/blob/f7d9c0ca9ad888bee524ee0cad6d6347645f8f83/src/hooks/useSearchWord.tsx) 中：

- API 返回数组后只取 `data[0]`。我们的适配器应保留所有返回词条，防止多词条信息被丢弃。
- 所有非成功状态都被转为 `No Definitions Found`。我们的页面应区分查无此词、断网、超时与服务异常。
- 直接拼接查询文本。我们的查询需要统一规范化，并正确编码 URL 参数。

这些是对所查看源码的具体判断，不代表该项目的全部质量。

### 为什么优先独立实现

第一版范围明确，只有查词、词本、学习三个主要模块。直接改造 Rails 项目、浏览器扩展或 LLM 服务端，会引入额外系统；简单词典页面又缺少整个学习模块。独立实现可以统一数据模型、中文界面和自动入本规则。

如果后续决定复制 MIT 项目中的代码，应保留相应版权和许可文本。当前方案只参考交互与结构，不计划复制 GPL 项目的代码。Lexicon 先作为功能参考，不将其代码纳入新项目。

## 3. 词典数据与近义词来源

| 来源 | 可以提供什么 | 第一版用途 | 已知限制 |
| --- | --- | --- | --- |
| [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT) | 英文释义、中文释义、音标、词形等字段 | 基础双语词条，构建时转成静态分片 | 字段完整度不一致；中文与英文不是逐义项对齐的数据 |
| [Princeton WordNet](https://wordnet.princeton.edu/) | 按含义组织的英文释义、近义词集合及部分例句 | 补充英文多义项与按义项区分的近义词 | 不提供中文；官方项目已停止开发，不保证新词覆盖 |
| [meetDeveloper/freeDictionaryAPI](https://github.com/meetDeveloper/freeDictionaryAPI) / [官方接口说明](https://dictionaryapi.dev/) | 英文词条、释义、音标、发音等字段 | 后续按需补充在线内容 | 本轮一次实测失败；不能承担基础查词的唯一数据源 |
| [Datamuse](https://www.datamuse.com/api/) | `rel_syn` 查询近义词，也提供拼写建议 | 后续在线扩展，第一版不强依赖 | 结果不直接对应我们的义项 ID，且接口使用规则即将变化 |

### ECDICT 核查

仓库最近提交为 2025-03-28，当前声明为 [MIT](https://github.com/skywind3000/ECDICT/blob/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/LICENSE)。GitHub 文件元数据中，`ecdict.csv` 为 **65,933,428 字节，约 62.9 MiB**。这是原始 CSV 大小，不是最终网站下载大小。

核查了 [CSV 样本](https://github.com/skywind3000/ECDICT/blob/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/ecdict.mini.csv)，可见英文释义缺失等情况。因此需要数据清洗与完整度报告；`ecdict.mini.csv` 只是小样本，不能作为实际词库。网站应保留原始释义和来源，不能凭分号或行号把中英文强行配对。

WordNet 的近义词以 synset（表达一个含义的词集合）组织，可以避免把不同含义下的近义词混成一组。使用其数据时随网站保留 [官方许可与版权声明](https://wordnet.princeton.edu/license-and-commercial-use)，并注明数据版本。

### 在线接口实测与变化

2026-10-10 从当前开发环境进行了两次请求：

| 请求 | 本次结果 | 对设计的影响 |
| --- | --- | --- |
| `https://api.dictionaryapi.dev/api/v2/entries/en/bank` | HTTP 522 | 以静态词库提供基础查词；服务异常不显示成“查无此词” |
| `https://api.datamuse.com/words?rel_syn=happy&max=5` | HTTP 200；返回 5 项，响应允许本次测试 Origin | 后续可接入，但还需在正式域名上验证 |

单次请求只能说明本轮观测，不能推断服务长期可用性。

[Datamuse 官方页面](https://www.datamuse.com/api/) 顶部公告写明：从 **2027-02-01** 起请求需要 API Key，每 Key 每日限制 100,000 次。页面下方仍有“至 2027-01-01 可免 Key 使用”的描述，存在日期不一致。接入或部署前应重新核查；如需密钥，通过服务端代理调用，不能打包进浏览器代码。

## 4. 采用建议

第一版采用以下组合：

1. 自建 React + TypeScript + Vite 网页。
2. ECDICT 为中文和基础英文释义来源，WordNet 为英文义项与近义词来源。
3. 词典在构建阶段清洗、分片，运行时从网站同源读取；不向浏览器一次下载整个 CSV。
4. IndexedDB 保存查词历史、词本和学习进度。
5. 后续再接入在线词典、账号同步和部署。

双语展示的第一版边界是：**中文释义按词汇汇总，英文含义与对应近义词按义项展示**。不能自动断言两个不同词典的第 N 条释义对应同一个意思。逐义项中英对照可通过后续增加有可靠对齐关系的数据实现。

完整功能、页面和数据设计见 [DESIGN.md](./DESIGN.md)。

## 5. 调研快照

以下提交用于让调研结果可追溯；不代表已决定使用其全部代码。

| 仓库 | 调研时默认分支提交 |
| --- | --- |
| Lexicon | [fd57e9f](https://github.com/dbodow/lexicon/commit/fd57e9fa1197244a9968eb841a3e4ee8c828debb) |
| dictionary-web-app-react-ts | [f7d9c0c](https://github.com/ucod3/dictionary-web-app-react-ts/commit/f7d9c0ca9ad888bee524ee0cad6d6347645f8f83) |
| Qwerty Learner | [1182426](https://github.com/RealKai42/qwerty-learner/commit/1182426f2bd0a28c95302c33f9e19136b1262a70) |
| Dictionariez | [784408c](https://github.com/pnlpal/dictionariez/commit/784408cfac4c3765d59665a33d86d9deba674791) |
| VocabGen | [1646c07](https://github.com/npozs77/VocabGen/commit/1646c078fd62ba039376ac65125af0df14944ee1) |
| Free Dictionary API | [4f274a8](https://github.com/meetDeveloper/freeDictionaryAPI/commit/4f274a853dd7a352aa2a349d1b92624ff18a36a8) |
| ECDICT | [bc015ed](https://github.com/skywind3000/ECDICT/commit/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b) |

本轮验证：GitHub 仓库说明、许可证声明、最新提交、选定源码、数据样本与两个在线接口请求。未完成：项目运行验证、完整词库转换、词条覆盖统计、最终网页实现与部署。
