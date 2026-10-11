import type { WordEntry } from '../types';
import { DictionaryError, normalizeQuery } from '../dictionary/normalize';
import { shardIndex } from '../dictionary/core.mjs';

export { DictionaryError, normalizeQuery } from '../dictionary/normalize';
export type { DictionaryErrorCode } from '../dictionary/normalize';

export interface DictionaryShard {
  bucket: number;
  file: string;
  sha256: string;
  bytes: number;
  gzipBytes: number;
  entries: number;
  compression?: 'gzip';
}

export interface DictionarySource {
  name: string;
  version: string;
  url: string;
  sha256: string;
  distributor?: string;
  distributorCommit?: string;
  license: { name: string; file: string; sha256: string };
}

export interface DictionaryManifest {
  schemaVersion: 1;
  dataVersion: string;
  generatedAt: string;
  hashAlgorithm: 'fnv1a-32-utf8';
  bucketCount: number;
  maxQueryLength: number;
  shards: DictionaryShard[];
  sources: DictionarySource[];
  stats: {
    entries: number;
    missingChinese: number;
    missingEnglish: number;
    bilingual: number;
    maxGzipBytes: number;
    [key: string]: number;
  };
}

type ObjectRecord = Record<string, unknown>;
const object = (value: unknown): value is ObjectRecord => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const positiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const checksum = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const maxShardBytes = 4 * 1024 * 1024;

function assertManifest(value: unknown): asserts value is DictionaryManifest {
  if (!object(value) || value.schemaVersion !== 1 || value.hashAlgorithm !== 'fnv1a-32-utf8' ||
      typeof value.dataVersion !== 'string' || !value.dataVersion || typeof value.generatedAt !== 'string' ||
      !positiveInteger(value.bucketCount) || value.bucketCount < 1 || value.bucketCount > 8192 ||
      value.maxQueryLength !== 80 || !Array.isArray(value.shards) || value.shards.length !== value.bucketCount ||
      !object(value.stats) || !['entries', 'missingChinese', 'missingEnglish', 'bilingual', 'maxGzipBytes']
        .every(key => positiveInteger((value.stats as ObjectRecord)[key])) || !Array.isArray(value.sources) || !value.sources.length) {
    throw new DictionaryError('DATA_ERROR', '词典版本清单格式损坏。');
  }
  value.shards.forEach((shard, bucket) => {
    if (!object(shard) || shard.bucket !== bucket || typeof shard.file !== 'string' ||
        !(shard.compression === undefined ? /^shard-\d{3,5}-[a-f0-9]{16}\.json$/.test(shard.file) :
          shard.compression === 'gzip' && /^shard-\d{3,5}-[a-f0-9]{16}\.json\.gz$/.test(shard.file)) || !checksum(shard.sha256) ||
        !positiveInteger(shard.bytes) || shard.bytes > maxShardBytes || !positiveInteger(shard.gzipBytes) || !positiveInteger(shard.entries)) {
      throw new DictionaryError('DATA_ERROR', '词典分片映射损坏。');
    }
  });
  value.sources.forEach(source => {
    if (!object(source) || typeof source.name !== 'string' || typeof source.version !== 'string' ||
        typeof source.url !== 'string' || !source.url.startsWith('https://') || !checksum(source.sha256) ||
        !object(source.license) || typeof source.license.name !== 'string' || typeof source.license.file !== 'string' ||
        !/^licenses\/[A-Za-z0-9.-]+\.txt$/.test(source.license.file) || !checksum(source.license.sha256)) {
      throw new DictionaryError('DATA_ERROR', '词典来源记录损坏。');
    }
  });
}

export function isWordEntry(value: unknown, key?: string, version?: string): value is WordEntry {
  if (!object(value) || typeof value.normalizedWord !== 'string' || !value.normalizedWord ||
      (key !== undefined && value.normalizedWord !== key) || value.id !== `en:${value.normalizedWord}` ||
      typeof value.word !== 'string' || !value.word.trim() || !strings(value.phonetics) ||
      !strings(value.sources) || !value.sources.length || typeof value.dataVersion !== 'string' || !value.dataVersion ||
      (version !== undefined && value.dataVersion !== version) || !Array.isArray(value.chineseGlosses) ||
      !Array.isArray(value.englishSenses) || !object(value.contentStatus)) return false;
  if (!value.chineseGlosses.every(gloss => object(gloss) && typeof gloss.text === 'string' && !!gloss.text.trim() &&
      typeof gloss.source === 'string' && (gloss.pos === undefined || typeof gloss.pos === 'string'))) return false;
  if (!value.englishSenses.every(sense => object(sense) && typeof sense.id === 'string' && !!sense.id &&
      typeof sense.pos === 'string' && typeof sense.definition === 'string' && !!sense.definition.trim() &&
      typeof sense.source === 'string' && strings(sense.synonyms) && strings(sense.examples))) return false;
  const chinese = value.chineseGlosses.length > 0;
  const english = value.englishSenses.length > 0;
  return (chinese || english) && value.contentStatus.chinese === chinese && value.contentStatus.english === english;
}

interface ServiceOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxCachedShards?: number;
}

/** Only same-site static assets are read; callers explicitly record successful searches. */
export class DictionaryService {
  private readonly assetBase: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxCachedShards: number;
  private manifestPromise?: Promise<DictionaryManifest>;
  private readonly shards = new Map<number, Promise<Record<string, WordEntry>>>();

  constructor(options: ServiceOptions = {}) {
    const base = options.baseUrl ?? import.meta.env.BASE_URL;
    this.assetBase = `${base.endsWith('/') ? base : base + '/'}dictionary/`;
    this.fetcher = options.fetcher ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.maxCachedShards = Math.max(1, options.maxCachedShards ?? 6);
  }

  private async download(file: string): Promise<ArrayBuffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.assetBase + file, { signal: controller.signal });
      if (!response.ok) throw new DictionaryError('NETWORK_ERROR', '词典资源下载失败，请重试。');
      return await response.arrayBuffer();
    } catch (error) {
      if (error instanceof DictionaryError) throw error;
      throw new DictionaryError('NETWORK_ERROR', '无法连接词典，请检查网络后重试。', { cause: error });
    } finally { clearTimeout(timeout); }
  }

  private parse(bytes: ArrayBuffer): unknown {
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch (error) { throw new DictionaryError('DATA_ERROR', '词典资源无法解析。', { cause: error }); }
  }

  async getManifest(): Promise<DictionaryManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.download('manifest.json').then(bytes => {
        const manifest = this.parse(bytes);
        assertManifest(manifest);
        return manifest;
      }).catch(error => { this.manifestPromise = undefined; throw error; });
    }
    return this.manifestPromise;
  }

  private async readShard(manifest: DictionaryManifest, bucket: number): Promise<Record<string, WordEntry>> {
    const metadata = manifest.shards[bucket];
    let bytes = await this.download(metadata.file);
    const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
    // Fetch may already decode Content-Encoding: gzip. Only a remaining gzip header needs decoding.
    if (metadata.compression === 'gzip' && header[0] === 0x1f && header[1] === 0x8b) {
      if (bytes.byteLength !== metadata.gzipBytes) throw new DictionaryError('DATA_ERROR', '词典压缩分片长度不匹配。');
      bytes = await this.decompressShard(bytes, metadata.bytes);
    }
    if (bytes.byteLength !== metadata.bytes) throw new DictionaryError('DATA_ERROR', '词典分片长度不匹配。');
    if (globalThis.crypto?.subtle) {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== metadata.sha256) throw new DictionaryError('DATA_ERROR', '词典分片校验失败。');
    }
    const shard = this.parse(bytes);
    if (!object(shard) || shard.schemaVersion !== 1 || shard.dataVersion !== manifest.dataVersion || shard.bucket !== bucket ||
        !object(shard.entries) || Object.keys(shard.entries).length !== metadata.entries ||
        !Object.entries(shard.entries).every(([key, entry]) => shardIndex(key, manifest.bucketCount) === bucket && isWordEntry(entry, key, manifest.dataVersion))) {
      throw new DictionaryError('DATA_ERROR', '词典分片内容损坏。');
    }
    return shard.entries as Record<string, WordEntry>;
  }

  private async decompressShard(bytes: ArrayBuffer, expectedBytes: number): Promise<ArrayBuffer> {
    if (typeof globalThis.DecompressionStream !== 'function') {
      throw new DictionaryError('DATA_ERROR', '当前浏览器无法解压词典资源，请更新浏览器后重试。');
    }
    const output = new Uint8Array(expectedBytes);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
      let offset = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (offset + chunk.value.byteLength > expectedBytes) {
          throw new DictionaryError('DATA_ERROR', '词典分片解压长度超过版本清单。');
        }
        output.set(chunk.value, offset);
        offset += chunk.value.byteLength;
      }
      if (offset !== expectedBytes) throw new DictionaryError('DATA_ERROR', '词典分片长度不匹配。');
      return output.buffer;
    } catch (error) {
      await reader?.cancel().catch(() => undefined);
      if (error instanceof DictionaryError) throw error;
      throw new DictionaryError('DATA_ERROR', '词典压缩分片损坏，请重试。', { cause: error });
    } finally { reader?.releaseLock(); }
  }

  async lookup(query: string): Promise<WordEntry> {
    const key = normalizeQuery(query);
    const manifest = await this.getManifest();
    const bucket = shardIndex(key, manifest.bucketCount);
    let promise = this.shards.get(bucket);
    if (promise) { this.shards.delete(bucket); this.shards.set(bucket, promise); }
    else {
      promise = this.readShard(manifest, bucket).catch(error => { this.shards.delete(bucket); throw error; });
      this.shards.set(bucket, promise);
      while (this.shards.size > this.maxCachedShards) this.shards.delete(this.shards.keys().next().value!);
    }
    const entries = await promise;
    if (!Object.hasOwn(entries, key)) throw new DictionaryError('NOT_FOUND', `词库未收录“${key}”。`);
    return structuredClone(entries[key]);
  }
}

export const dictionaryService = new DictionaryService();
