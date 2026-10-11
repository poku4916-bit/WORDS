# 词典转换与覆盖报告

数据版本：`ecdict-bc015ed2-wn3.0-v1`。本报告由 `node scripts/build-dictionary.mjs` 根据完整数据生成，核查日期：2026-10-11（北京时间）。

## 固定来源与复现

- [ECDICT 固定提交](https://github.com/skywind3000/ECDICT/tree/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b)，完整 `ecdict.csv`（65,933,428 字节），SHA-256：`1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf`。
- [Princeton WordNet 3.0](https://wordnet.princeton.edu/)，数据库遵循[官方格式](https://wordnet.princeton.edu/documentation/wndb5wn)。当前环境直连 Princeton 下载站超时，使用 [NLTK 固定提交的原版 WordNet 3.0 分发包](https://github.com/nltk/nltk_data/blob/96f9b3252457a2b97e52aec64c3dfceeb5c312d5/packages/corpora/wordnet.zip)，包 SHA-256：`cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59`。这是原版数据的重新打包，未宣称对 Princeton 原 tar.gz 进行逐字节比对。
- 原始许可逐字节复制至 `public/licenses`；ECDICT 许可 SHA-256：`f8552dd246f61a4e064569eae6194a01c6b3d63b03bf27c6ca863593c549ed0f`；WordNet 许可 SHA-256：`7731175a77952e259390b496fab905e57118b8d19ad3a8383c67eee724ff443f`。每个分片同时带有两份完整许可文本。
- 下载与转换：`node scripts/download-dictionary.mjs` 后执行 `npm run dictionary:build`。下载脚本与转换脚本均强制 SHA-256 校验；8 个 WordNet 索引/数据文件分别锁定校验和，保存于 `scripts/dictionary-sources.mjs` 和 manifest。普通 `npm run build` 直接包含已生成分片，无需下载原始词库。

## 整体覆盖

| 指标 | 实测结果 |
| --- | ---: |
| ECDICT CSV 数据行 | 770,611 |
| 合并后的有效词条 | 772,845 |
| 中文、英文均有内容 | 231,610（29.97%） |
| 缺中文 | 4,106（0.53%） |
| 缺英文 | 537,129（69.50%） |
| 缺音标 | 554,780 |
| 有 WordNet 义项 | 147,306 |
| 所有英文义项都没有其他同义成员 | 662,455 |
| 英文义项 / 无近义词义项 | 367,825 / 224,759 |
| WordNet synset / 索引记录 | 117,659 / 155,287 |
| WordNet 增补词条 | 2,234 |
| ECDICT 重复规范键（合并保留内容） | 0 |
| ECDICT 空键 / 无任何释义行 | 0 / 0 |
| CSV / WordNet 格式异常 | 0 / 0 |
| 超出界面 80 字符查询限制的保留词键 | 2 |
| 分片数量 | 512 |
| 最大分片 gzip（level 9） | 128.54 KiB（目标 ≤ 300 KiB） |
| JSON 合计 / gzip 合计 | 325.40 / 57.82 MiB |

覆盖率表示字段存在，并非释义质量或所有词义完备性的保证。完整 CSV 含大量专业术语、词形、短语、专名，整体双语率不能代表常用词覆盖率。超过查询长度的词键保留在数据中并计数，界面明确拒绝超长查询。

## 30 个常用词核查

核查 30 / 30 词均含中文和英文，且来自真实词库。下表列出完整义项数；并在后表保留源内容样本供人工复核。转换使用 WordNet 每个词性索引的义项顺序，义项 ID 带版本、POS 和字节偏移，近义词只来自相同 synset；`bank` 的金融机构和河岸分别归属不同义项，未把词级近义词混到一起。

| 词 | 中文原文行 | WordNet 义项 | 有近义词的义项 | 例句 |
| --- | ---: | ---: | ---: | ---: |
| bank | 2 | 18 | 6 | 19 |
| light | 5 | 47 | 27 | 93 |
| run | 6 | 57 | 36 | 93 |
| spring | 4 | 11 | 7 | 11 |
| book | 3 | 15 | 8 | 14 |
| right | 6 | 36 | 20 | 62 |
| set | 5 | 45 | 32 | 68 |
| take | 3 | 44 | 32 | 100 |
| make | 3 | 51 | 28 | 107 |
| get | 4 | 37 | 29 | 98 |
| work | 3 | 34 | 21 | 86 |
| love | 3 | 10 | 6 | 17 |
| good | 2 | 27 | 20 | 74 |
| happy | 1 | 4 | 3 | 8 |
| learn | 1 | 6 | 6 | 13 |
| study | 3 | 16 | 11 | 20 |
| read | 4 | 12 | 6 | 20 |
| write | 3 | 10 | 6 | 13 |
| speak | 2 | 5 | 4 | 9 |
| word | 3 | 11 | 7 | 12 |
| time | 4 | 15 | 6 | 22 |
| water | 4 | 10 | 5 | 12 |
| home | 4 | 17 | 7 | 33 |
| food | 2 | 3 | 3 | 1 |
| friend | 2 | 5 | 4 | 6 |
| child | 2 | 4 | 3 | 8 |
| school | 3 | 10 | 5 | 16 |
| computer | 2 | 2 | 2 | 0 |
| beautiful | 1 | 2 | 0 | 6 |
| change | 2 | 20 | 9 | 36 |

| 词 | 首条中文原文 | 首条英文义项 | 该英文义项近义词 |
| --- | --- | --- | --- |
| bank | n. 银行, 堤, 岸 | sloping land (especially the slope beside a body of water) | 该义项无其他同义成员 |
| light | n. 光, 光亮, 灯, 日光, 发光体, 光源, 杰出人物, 火花, 眼光 | (physics) electromagnetic radiation that can produce a visual sensation | visible light, visible radiation |
| run | n. 跑, 赛跑, 奔跑, 奔跑的路程, 趋向, 流出, 运转时间, 连续 | a score in baseball made by a runner touching all four bases safely | tally |
| spring | n. 春天, 弹簧, 跳跃, 弹性, 活力, 泉, 源泉 | the season of growth | springtime |
| book | n. 书, 书籍, 帐簿, 名册, 工作簿 | a written work or composition that has been published (printed on pages bound together) | 该义项无其他同义成员 |
| right | n. 权利, 右边, 正义, 右派, 公正 | an abstract idea of that which is due to a person or governmental body by law or tradition or nature; "Certain rights can never be granted to the government but must be kept in the hands of the people"- Eleanor Roosevelt | 该义项无其他同义成员 |
| set | n. 日落, 同伙, 组合, 集合, 装置 | a group of things of the same kind that belong together and are so used | 该义项无其他同义成员 |
| take | vt. 拿, 取, 抓, 带领, 获得, 就座, 接受, 吃, 吸引, 采取, 乘, 需要, 花费 | the income or profit arising from such transactions as the sale of land or other property | return, issue, takings, proceeds, yield, payoff |
| make | vt. 制造, 安排, 创造, 构成, 使得, 产生, 造成, 整理, 布置, 引起, 到达, 进行 | a recognizable kind | brand |
| get | vt. 得到, 获得, 变成, 使得, 收获, 接通, 抓住, 染上 | a return on a shot that seemed impossible to reach and would normally have resulted in a point for the opponent | 该义项无其他同义成员 |
| work | n. 工作, 劳动, 职业, 行为, 功, 作品, 成果, 产品, 工程 | activity directed toward making or doing something | 该义项无其他同义成员 |
| love | n. 爱, 恋爱, 爱情, 爱好, 性爱 | a strong positive emotion of regard and affection | 该义项无其他同义成员 |
| good | n. 善行, 好处, 利益 | benefit | 该义项无其他同义成员 |
| happy | a. 快乐的, 幸福的, 愉快的, 恰当的 | enjoying or showing or marked by joy or pleasure | 该义项无其他同义成员 |
| learn | vt. 学习；认识到；得知 | gain knowledge or skills | larn, acquire |
| study | n. 学习, 研究, 学科, 论文, 求学, 书房, 试作 | a detailed critical inspection | survey |
| read | v. 读, 阅读, 理解 | something that is read | 该义项无其他同义成员 |
| write | vt. 书写, 著述, 写, 写满, 写信给 | produce a literary work | compose, pen, indite |
| speak | vi. 说, 说话, 演说, 发言 | express in speech | talk, utter, mouth, verbalize, verbalise |
| word | n. 话, 消息, 词, 诺言, 命令 | a unit of language that native speakers can identify | 该义项无其他同义成员 |
| time | n. 时间, 时侯, 时机, 时期, 期限, 次数, 节拍, 暂停, 规定时间 | an instance or single occasion for some event | clip |
| water | n. 水, 雨水, 海水, 水位, 水面, 流水 | binary compound that occurs at room temperature as a clear colorless odorless tasteless liquid; freezes into ice below 0 degrees centigrade and boils above 100 degrees centigrade; widely used as a solvent | H2O |
| home | n. 家, 避难所, 故乡 | where you live at a particular time | place |
| food | n. 食物, 养料 | any substance that can be metabolized by an animal to give energy and build tissue | nutrient |
| friend | n. 朋友, 支持者, 赞助者 | a person you know well and regard with affection and trust | 该义项无其他同义成员 |
| child | n. 孩子, 产物, 追随者 | a young person of either sex | kid, youngster, minor, shaver, nipper, small fry, tiddler, tike, tyke, fry, nestling |
| school | n. 学校, 鱼群, 门派, 学派 | an educational institution | 该义项无其他同义成员 |
| computer | n. 电脑, 电子计算机 | a machine for performing calculations automatically | computing machine, computing device, data processor, electronic computer, information processing system |
| beautiful | a. 美丽的 | delighting the senses or exciting intellectual or emotional admiration | 该义项无其他同义成员 |
| change | n. 变化, 找回的零钱, 找头, 更换 | an event that occurs when something passes from one state or phase to another | alteration, modification |

## 数据规则与边界

CSV 使用 `csv-parse` 解析引号、逗号、换行，列数与解析错误独立报告，未通过简单逗号切分读取。ECDICT 中文只按原字段中的换行展示，保留原文与明确词性标签；英文保留为来源明确的补充释义，不按中文数组位置配对。WordNet 保留 noun、verb、adjective、adjective satellite、adverb，`s` 与 `a` 使用不同稳定 ID；下划线还原为空格，去除形容词位置标记，去掉当前词本身并去重同义成员。只提取完整引号例句段，定义中的内嵌引用保留。

所有词采用同一 UTF-8 FNV-1a 无符号 32 位哈希分配至 512 桶。manifest 保存文件字节长度、gzip 测量、SHA-256 与内容版本；文件名带内容摘要。加载器遵循 Vite BASE_URL，对 manifest 与词条结构做运行时校验，支持浏览器 SHA-256 时还验证分片完整性。查询区分输入无效、查无词、网络失败、数据损坏；不截取词尾猜原型，也不把查询文本拼入资源路径。

已保存的词条快照由存储层保留，断网学习不要求重新加载词库；尚未保存的分片查询需要网络。当前不实现 Service Worker 或整库离线启动。

格式异常样本（最多 100 条）：`[]`。
