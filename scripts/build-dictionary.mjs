import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import { normalizeKey, shardIndex } from '../src/dictionary/core.mjs';
import { sources } from './dictionary-sources.mjs';
import { parseIndex, parseSynset } from './parse-wordnet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache/dictionary');
const output = path.join(root, 'public/dictionary');
const licenseOutput = path.join(root, 'public/licenses');
const dataVersion = 'ecdict-bc015ed2-wn3.0-v1';
const bucketCount = 512;
const digest = value => createHash('sha256').update(value).digest('hex');
async function verify(file, expected) {
  let bytes;
  try { bytes = await readFile(path.join(cache, file)); }
  catch { throw new Error(`Missing ${file}. Run node scripts/download-dictionary.mjs first.`); }
  if (digest(bytes) !== expected) throw new Error(`Source checksum mismatch: ${file}`);
  return bytes;
}
await verify(sources.ecdict.file, sources.ecdict.sha256);
await verify(sources.wordnet.file, sources.wordnet.sha256);
const ecdictLicense = await verify(sources.ecdict.licenseFile, sources.ecdict.licenseSha256);
const wordnetLicense = await verify(sources.wordnet.licenseFile, sources.wordnet.licenseSha256);
for (const [file, sha256] of Object.entries(sources.wordnet.databaseFiles)) await verify(`wordnet/${file}`, sha256);
await mkdir(output, { recursive: true });
await mkdir(licenseOutput, { recursive: true });
await writeFile(path.join(licenseOutput, 'ECDICT-LICENSE.txt'), ecdictLicense);
await writeFile(path.join(licenseOutput, 'WORDNET-LICENSE.txt'), wordnetLicense);

const stats = {
  ecdictRows: 0, ecdictDuplicateKeys: 0, ecdictEmptyKeys: 0, ecdictNoDefinitionRows: 0,
  malformedCsvRecords: 0, malformedWordnetRecords: 0, wordnetSynsets: 0,
  wordnetIndexRecords: 0, wordnetAddedEntries: 0,
  entries: 0, missingChinese: 0, missingEnglish: 0, bilingual: 0, missingPhonetics: 0,
  entriesWithWordnet: 0, entriesWithNoSynonyms: 0, englishSenses: 0, englishSensesWithNoSynonyms: 0,
  oversizedQueryKeys: 0, maxGzipBytes: 0, totalJsonBytes: 0, totalGzipBytes: 0,
};
const anomalies = [];
function anomaly(kind, location, message) {
  if (anomalies.length < 100) anomalies.push({ kind, location, message });
}
const entries = new Map();
const makeEntry = (word, normalizedWord) => ({
  id: `en:${normalizedWord}`, word, normalizedWord, phonetics: [], chineseGlosses: [],
  englishSenses: [], sources: [], dataVersion, contentStatus: { chinese: false, english: false },
});
const decode = value => String(value || '').replaceAll('\\n', '\n').trim();
const knownPos = /^(n|v|vt|vi|a|adj|ad|adv|pron|prep|conj|interj|int|num|art|aux|abbr)\./i;
function addUnique(array, values, key = value => JSON.stringify(value)) {
  const existing = new Set(array.map(key));
  for (const value of values) if (!existing.has(key(value))) { existing.add(key(value)); array.push(value); }
}

console.log('Parsing complete ECDICT CSV with csv-parse…');
const parser = createReadStream(path.join(cache, sources.ecdict.file)).pipe(parse({
  bom: true, relax_column_count: true, skip_records_with_error: true, info: true,
  on_skip(error) { stats.malformedCsvRecords++; anomaly('csv', error.lines, error.message); },
}));
let header;
for await (const { record, info } of parser) {
  if (!header) {
    header = record;
    const required = ['word', 'phonetic', 'definition', 'translation'];
    if (!required.every(field => header.includes(field))) throw new Error('ECDICT CSV header is not recognized');
    continue;
  }
  stats.ecdictRows++;
  if (record.length !== header.length) {
    stats.malformedCsvRecords++; anomaly('csv', info.lines, `Expected ${header.length} columns, got ${record.length}`); continue;
  }
  const row = Object.fromEntries(header.map((field, index) => [field, record[index]]));
  const word = String(row.word).trim();
  const key = normalizeKey(word);
  if (!key) { stats.ecdictEmptyKeys++; continue; }
  const chinese = decode(row.translation);
  const english = decode(row.definition);
  if (!chinese && !english) { stats.ecdictNoDefinitionRows++; continue; }
  let entry = entries.get(key);
  if (entry) stats.ecdictDuplicateKeys++;
  else { entry = makeEntry(word, key); entries.set(key, entry); }
  // Preserve original Chinese lines and labels. Semicolons never invent new senses.
  if (chinese) addUnique(entry.chineseGlosses, chinese.split(/\r?\n/).filter(text => text.trim()).map(text => {
    const pos = text.match(knownPos)?.[1].toLowerCase();
    return { ...(pos ? { pos } : {}), text, source: 'ECDICT' };
  }));
  if (english) addUnique(entry.englishSenses, [{
    id: `ecdict:${sources.ecdict.version}:${digest(key + '\n' + english).slice(0, 16)}`,
    pos: english.match(knownPos)?.[1].toLowerCase() || 'unspecified', definition: english,
    synonyms: [], examples: [], source: 'ECDICT',
  }], sense => sense.id);
  const phonetic = decode(row.phonetic);
  if (phonetic) addUnique(entry.phonetics, [phonetic]);
  addUnique(entry.sources, ['ECDICT']);
  if (stats.ecdictRows % 200000 === 0) console.log(`  ECDICT: ${stats.ecdictRows.toLocaleString()} rows`);
}

console.log('Parsing all four WordNet POS databases and their ordered indexes…');
const posNames = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective satellite', r: 'adverb' };
for (const suffix of ['noun', 'verb', 'adj', 'adv']) {
  const synsets = new Map();
  let lineNumber = 0;
  for await (const line of createInterface({ input: createReadStream(path.join(cache, `wordnet/data.${suffix}`)), crlfDelay: Infinity })) {
    lineNumber++;
    if (!line || line.startsWith('  ')) continue;
    try { const synset = parseSynset(line); synsets.set(synset.offset, synset); stats.wordnetSynsets++; }
    catch (error) { stats.malformedWordnetRecords++; anomaly('wordnet-data', `${suffix}:${lineNumber}`, error.message); }
  }
  lineNumber = 0;
  for await (const line of createInterface({ input: createReadStream(path.join(cache, `wordnet/index.${suffix}`)), crlfDelay: Infinity })) {
    lineNumber++;
    if (!line || line.startsWith('  ')) continue;
    try {
      const index = parseIndex(line);
      const key = normalizeKey(index.word);
      let entry = entries.get(key);
      if (!entry) { entry = makeEntry(index.word, key); entries.set(key, entry); stats.wordnetAddedEntries++; }
      const senses = index.offsets.map(offset => {
        const synset = synsets.get(offset);
        if (!synset) throw new Error(`Index refers to missing synset ${offset}`);
        const synonyms = [];
        const seen = new Set([key]);
        for (const word of synset.words) {
          const normalized = normalizeKey(word);
          if (!seen.has(normalized)) { seen.add(normalized); synonyms.push(word); }
        }
        return { id: synset.id, pos: posNames[synset.type], definition: synset.definition,
          examples: synset.examples, synonyms, source: 'WordNet 3.0' };
      });
      // WordNet senses precede ECDICT supplemental English; sources stay distinct.
      entry.englishSenses = [...entry.englishSenses.filter(sense => sense.source !== 'ECDICT'), ...senses,
        ...entry.englishSenses.filter(sense => sense.source === 'ECDICT')];
      addUnique(entry.sources, ['WordNet 3.0']);
      stats.wordnetIndexRecords++;
    } catch (error) { stats.malformedWordnetRecords++; anomaly('wordnet-index', `${suffix}:${lineNumber}`, error.message); }
  }
  console.log(`  WordNet ${suffix}: ${synsets.size.toLocaleString()} synsets`);
}

const buckets = Array.from({ length: bucketCount }, () => Object.create(null));
for (const [key, entry] of entries) {
  entry.contentStatus.chinese = entry.chineseGlosses.length > 0;
  entry.contentStatus.english = entry.englishSenses.length > 0;
  if (!entry.contentStatus.chinese && !entry.contentStatus.english) continue;
  stats.entries++;
  if (!entry.contentStatus.chinese) stats.missingChinese++;
  if (!entry.contentStatus.english) stats.missingEnglish++;
  if (entry.contentStatus.chinese && entry.contentStatus.english) stats.bilingual++;
  if (!entry.phonetics.length) stats.missingPhonetics++;
  if (entry.sources.includes('WordNet 3.0')) stats.entriesWithWordnet++;
  if (!entry.englishSenses.some(sense => sense.synonyms.length)) stats.entriesWithNoSynonyms++;
  if (key.length > 80) stats.oversizedQueryKeys++;
  stats.englishSenses += entry.englishSenses.length;
  stats.englishSensesWithNoSynonyms += entry.englishSenses.filter(sense => !sense.synonyms.length).length;
  buckets[shardIndex(key, bucketCount)][key] = entry;
}
const shards = [];
const licenses = { ECDICT: ecdictLicense.toString('utf8'), 'WordNet 3.0': wordnetLicense.toString('utf8') };
for (let bucket = 0; bucket < buckets.length; bucket++) {
  const json = Buffer.from(JSON.stringify({ schemaVersion: 1, dataVersion, bucket, licenses, entries: buckets[bucket] }));
  const sha256 = digest(json);
  const gzipBytes = gzipSync(json, { level: 9 }).length;
  const file = `shard-${String(bucket).padStart(3, '0')}-${sha256.slice(0, 16)}.json`;
  await writeFile(path.join(output, file), json);
  shards.push({ bucket, file, sha256, bytes: json.length, gzipBytes, entries: Object.keys(buckets[bucket]).length });
  stats.maxGzipBytes = Math.max(stats.maxGzipBytes, gzipBytes);
  stats.totalJsonBytes += json.length;
  stats.totalGzipBytes += gzipBytes;
}
if (stats.maxGzipBytes > 300 * 1024) throw new Error(`Shard exceeds gzip size target: ${stats.maxGzipBytes}; increase bucket count.`);
const sourceMetadata = [
  { ...sources.ecdict, license: { name: 'MIT', file: 'licenses/ECDICT-LICENSE.txt', sha256: sources.ecdict.licenseSha256 } },
  { ...sources.wordnet, license: { name: 'Princeton WordNet 3.0', file: 'licenses/WORDNET-LICENSE.txt', sha256: sources.wordnet.licenseSha256 } },
];
const auditWords = ['bank', 'light', 'run', 'spring', 'book', 'right', 'set', 'take', 'make', 'get',
  'work', 'love', 'good', 'happy', 'learn', 'study', 'read', 'write', 'speak', 'word',
  'time', 'water', 'home', 'food', 'friend', 'child', 'school', 'computer', 'beautiful', 'change'];
const audits = auditWords.map(word => {
  const entry = entries.get(word);
  if (!entry?.contentStatus.chinese || !entry?.contentStatus.english) throw new Error(`Audit word lacks bilingual content: ${word}`);
  return { word, chineseLines: entry.chineseGlosses.length,
    wordnetSenses: entry.englishSenses.filter(sense => sense.source === 'WordNet 3.0').length,
    sensesWithSynonyms: entry.englishSenses.filter(sense => sense.synonyms.length).length,
    exampleCount: entry.englishSenses.reduce((sum, sense) => sum + sense.examples.length, 0),
    chineseSample: entry.chineseGlosses[0].text,
    englishSample: entry.englishSenses[0].definition,
    firstSenseSynonyms: entry.englishSenses[0].synonyms,
  };
});
const manifest = { schemaVersion: 1, dataVersion, generatedAt: new Date().toISOString(),
  hashAlgorithm: 'fnv1a-32-utf8', normalization: 'NFKC + trim + curly/modifier/fullwidth apostrophe to ASCII + lowercase',
  bucketCount, maxQueryLength: 80, shards, sources: sourceMetadata, stats, audit: audits, anomalies };
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(path.join(licenseOutput, 'SOURCES.json'), JSON.stringify(sourceMetadata, null, 2) + '\n');

const percentage = count => `${(count / stats.entries * 100).toFixed(2)}%`;
const number = value => value.toLocaleString('en-US');
const escapeCell = text => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
const table = audits.map(row => `| ${row.word} | ${row.chineseLines} | ${row.wordnetSenses} | ${row.sensesWithSynonyms} | ${row.exampleCount} |`).join('\n');
const examples = audits.map(row => `| ${row.word} | ${escapeCell(row.chineseSample)} | ${escapeCell(row.englishSample)} | ${row.firstSenseSynonyms.join(', ') || '该义项无其他同义成员'} |`).join('\n');
const report = `# 词典转换与覆盖报告

数据版本：\`${dataVersion}\`。本报告由 \`node scripts/build-dictionary.mjs\` 根据完整数据生成，核查日期：2026-10-11（北京时间）。

## 固定来源与复现

- [ECDICT 固定提交](${sources.ecdict.url})，完整 \`ecdict.csv\`（65,933,428 字节），SHA-256：\`${sources.ecdict.sha256}\`。
- [Princeton WordNet 3.0](${sources.wordnet.url})，数据库遵循[官方格式](https://wordnet.princeton.edu/documentation/wndb5wn)。当前环境直连 Princeton 下载站超时，使用 [NLTK 固定提交的原版 WordNet 3.0 分发包](https://github.com/nltk/nltk_data/blob/${sources.wordnet.distributorCommit}/packages/corpora/wordnet.zip)，包 SHA-256：\`${sources.wordnet.sha256}\`。这是原版数据的重新打包，未宣称对 Princeton 原 tar.gz 进行逐字节比对。
- 原始许可逐字节复制至 \`public/licenses\`；ECDICT 许可 SHA-256：\`${sources.ecdict.licenseSha256}\`；WordNet 许可 SHA-256：\`${sources.wordnet.licenseSha256}\`。每个分片同时带有两份完整许可文本。
- 下载与转换：\`node scripts/download-dictionary.mjs\` 后执行 \`npm run dictionary:build\`。下载脚本与转换脚本均强制 SHA-256 校验；8 个 WordNet 索引/数据文件分别锁定校验和，保存于 \`scripts/dictionary-sources.mjs\` 和 manifest。普通 \`npm run build\` 直接包含已生成分片，无需下载原始词库。

## 整体覆盖

| 指标 | 实测结果 |
| --- | ---: |
| ECDICT CSV 数据行 | ${number(stats.ecdictRows)} |
| 合并后的有效词条 | ${number(stats.entries)} |
| 中文、英文均有内容 | ${number(stats.bilingual)}（${percentage(stats.bilingual)}） |
| 缺中文 | ${number(stats.missingChinese)}（${percentage(stats.missingChinese)}） |
| 缺英文 | ${number(stats.missingEnglish)}（${percentage(stats.missingEnglish)}） |
| 缺音标 | ${number(stats.missingPhonetics)} |
| 有 WordNet 义项 | ${number(stats.entriesWithWordnet)} |
| 所有英文义项都没有其他同义成员 | ${number(stats.entriesWithNoSynonyms)} |
| 英文义项 / 无近义词义项 | ${number(stats.englishSenses)} / ${number(stats.englishSensesWithNoSynonyms)} |
| WordNet synset / 索引记录 | ${number(stats.wordnetSynsets)} / ${number(stats.wordnetIndexRecords)} |
| WordNet 增补词条 | ${number(stats.wordnetAddedEntries)} |
| ECDICT 重复规范键（合并保留内容） | ${number(stats.ecdictDuplicateKeys)} |
| ECDICT 空键 / 无任何释义行 | ${number(stats.ecdictEmptyKeys)} / ${number(stats.ecdictNoDefinitionRows)} |
| CSV / WordNet 格式异常 | ${number(stats.malformedCsvRecords)} / ${number(stats.malformedWordnetRecords)} |
| 超出界面 80 字符查询限制的保留词键 | ${number(stats.oversizedQueryKeys)} |
| 分片数量 | ${bucketCount} |
| 最大分片 gzip（level 9） | ${(stats.maxGzipBytes / 1024).toFixed(2)} KiB（目标 ≤ 300 KiB） |
| JSON 合计 / gzip 合计 | ${(stats.totalJsonBytes / 1048576).toFixed(2)} / ${(stats.totalGzipBytes / 1048576).toFixed(2)} MiB |

覆盖率表示字段存在，并非释义质量或所有词义完备性的保证。完整 CSV 含大量专业术语、词形、短语、专名，整体双语率不能代表常用词覆盖率。超过查询长度的词键保留在数据中并计数，界面明确拒绝超长查询。

## 30 个常用词核查

核查 30 / 30 词均含中文和英文，且来自真实词库。下表列出完整义项数；并在后表保留源内容样本供人工复核。转换使用 WordNet 每个词性索引的义项顺序，义项 ID 带版本、POS 和字节偏移，近义词只来自相同 synset；\`bank\` 的金融机构和河岸分别归属不同义项，未把词级近义词混到一起。

| 词 | 中文原文行 | WordNet 义项 | 有近义词的义项 | 例句 |
| --- | ---: | ---: | ---: | ---: |
${table}

| 词 | 首条中文原文 | 首条英文义项 | 该英文义项近义词 |
| --- | --- | --- | --- |
${examples}

## 数据规则与边界

CSV 使用 \`csv-parse\` 解析引号、逗号、换行，列数与解析错误独立报告，未通过简单逗号切分读取。ECDICT 中文只按原字段中的换行展示，保留原文与明确词性标签；英文保留为来源明确的补充释义，不按中文数组位置配对。WordNet 保留 noun、verb、adjective、adjective satellite、adverb，\`s\` 与 \`a\` 使用不同稳定 ID；下划线还原为空格，去除形容词位置标记，去掉当前词本身并去重同义成员。只提取完整引号例句段，定义中的内嵌引用保留。

所有词采用同一 UTF-8 FNV-1a 无符号 32 位哈希分配至 512 桶。manifest 保存文件字节长度、gzip 测量、SHA-256 与内容版本；文件名带内容摘要。加载器遵循 Vite BASE_URL，对 manifest 与词条结构做运行时校验，支持浏览器 SHA-256 时还验证分片完整性。查询区分输入无效、查无词、网络失败、数据损坏；不截取词尾猜原型，也不把查询文本拼入资源路径。

已保存的词条快照由存储层保留，断网学习不要求重新加载词库；尚未保存的分片查询需要网络。当前不实现 Service Worker 或整库离线启动。

格式异常样本（最多 100 条）：\`${JSON.stringify(anomalies)}\`。
`;
await writeFile(path.join(root, 'docs/DICTIONARY_REPORT.md'), report);
console.log(JSON.stringify(stats, null, 2));
console.log('30 common-word audits passed; manifest, 512 shards, original licenses, and report written.');
