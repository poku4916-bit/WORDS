export interface WordnetSynset { id: string; offset: string; type: 'n' | 'v' | 'a' | 's' | 'r'; words: string[]; definition: string; examples: string[] }
export interface WordnetIndex { word: string; pos: 'n' | 'v' | 'a' | 'r'; offsets: string[] }
export function parseSynset(line: string): WordnetSynset;
export function parseIndex(line: string): WordnetIndex;
