import { normalizeKey } from './core.mjs';

export type DictionaryErrorCode = 'INVALID_QUERY' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'DATA_ERROR';

export class DictionaryError extends Error {
  readonly code: DictionaryErrorCode;
  constructor(code: DictionaryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DictionaryError';
    this.code = code;
  }
}

export function normalizeQuery(query: string): string {
  if (typeof query !== 'string') throw new DictionaryError('INVALID_QUERY', '请输入英文单词。');
  const key = normalizeKey(query);
  if (!key || key.length > 80 || /[\u0000-\u001f\u007f]/.test(key) || !/[a-z]/.test(key)) {
    throw new DictionaryError('INVALID_QUERY', '请输入含英文字母的单词或词库短语，最多 80 个字符。');
  }
  return key;
}
