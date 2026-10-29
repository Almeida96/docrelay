import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { chunkDocument, hash, type Chunk } from './chunk.js';

export type Passage = Chunk & { citation: string; documentHash: string; score: number };
export const INDEX_VERSION = '1.0';
const ignored = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage']);
const extensions = new Set(['.md', '.mdx', '.txt']);
const stopWords = new Set('a an and are as at be by can do does for from how i in is it of on or that the this to was what when where which who why with'.split(' '));

export function queryTerms(query: string): string[] {
  if (!query.trim() || query.length > 1000) throw new Error('Query must contain 1–1,000 characters');
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter(t => !stopWords.has(t)))].slice(0, 24);
}

export class DocumentIndex {
  readonly db: DatabaseSync;
  constructor(readonly filename: string, options: { create?: boolean } = {}) {
    if (!options.create && !existsSync(filename)) throw new Error('Index not found. Run docrelay ingest first.');
    if (options.create) mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename, { readOnly: !options.create });
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    if (options.create) {
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS documents (path TEXT PRIMARY KEY, hash TEXT NOT NULL, text TEXT NOT NULL, lines INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, path TEXT NOT NULL REFERENCES documents(path) ON DELETE CASCADE, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, heading TEXT NOT NULL, text TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
        CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts5(id UNINDEXED, path, heading, text, tokenize='unicode61 remove_diacritics 2');
      `);
    }
    const version = this.meta('version');
    if (version && version !== INDEX_VERSION) { this.close(); throw new Error(`Unsupported index version: ${version}`); }
  }
  close(): void { this.db.close(); }
  private meta(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }
  private setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(key, value);
  }

  async ingest(directory: string): Promise<{ added: number; updated: number; unchanged: number; removed: number; skipped: number; revision: string }> {
    const root = await realpath(directory);
    if (!(await stat(root)).isDirectory()) throw new Error('The document root must be a directory');
    if (this.meta('root') && this.meta('root') !== root) throw new Error('This index belongs to another root. Use a different --db path.');
    const files: { path: string; hash: string; text: string; chunks: Chunk[] }[] = [];
    let bytes = 0;
    let skipped = 0;
    const walk = async (dir: string): Promise<void> => {
      const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || ignored.has(entry.name) || entry.isSymbolicLink()) { skipped++; continue; }
        const full = resolve(dir, entry.name);
        const canonical = await realpath(full);
        const rel = relative(root, canonical);
        if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('Document escapes the selected root');
        if (entry.isDirectory()) { await walk(full); continue; }
        if (!entry.isFile() || !extensions.has(extname(entry.name).toLowerCase())) { skipped++; continue; }
        if (files.length >= 2000) throw new Error('Document limit exceeded (2,000 files)');
        const info = await stat(full);
        if (info.size > 1024 * 1024) throw new Error(`File exceeds 1 MiB: ${rel}`);
        bytes += info.size;
        if (bytes > 20 * 1024 * 1024) throw new Error('Corpus exceeds 20 MiB');
        const buffer = await readFile(full);
        if (buffer.length !== info.size) throw new Error(`File changed during ingestion: ${rel}; retry ingestion`);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        if (text.includes('\0')) throw new Error(`Binary content in ${rel}`);
        const path = relative(root, full).split(sep).join('/');
        if (path.length > 500) throw new Error('Indexed relative paths must contain at most 500 characters');
        files.push({ path, text, hash: hash(text), chunks: [] });
      }
    };
    await walk(root);
    // Stage and validate before opening a write transaction; readers see the last complete snapshot.
    const revision = hash(INDEX_VERSION + '\n' + files.map(f => `${f.path}\0${f.hash}`).sort().join('\n'));
    const counts = { added: 0, updated: 0, unchanged: 0, removed: 0, skipped, revision };
    const stagedHashes = new Map((this.db.prepare('SELECT path, hash FROM documents').all() as { path: string; hash: string }[]).map(r => [r.path, r.hash]));
    for (const f of files) if (stagedHashes.get(f.path) !== f.hash) f.chunks = chunkDocument(f.path, f.text);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.meta('root') && this.meta('root') !== root) throw new Error('This index belongs to another root. Use a different --db path.');
      const current = new Map((this.db.prepare('SELECT path, hash FROM documents').all() as { path: string; hash: string }[]).map(r => [r.path, r.hash]));
      const remove = (path: string) => {
        this.db.prepare('DELETE FROM passages WHERE path = ?').run(path);
        this.db.prepare('DELETE FROM documents WHERE path = ?').run(path);
      };
      for (const f of files) {
        const old = current.get(f.path);
        current.delete(f.path);
        if (old === f.hash) { counts.unchanged++; continue; }
        if (stagedHashes.get(f.path) === f.hash) f.chunks = chunkDocument(f.path, f.text);
        if (old) { counts.updated++; remove(f.path); } else counts.added++;
        this.db.prepare('INSERT INTO documents VALUES (?, ?, ?, ?)').run(f.path, f.hash, f.text.replace(/\r\n?/g, '\n'), f.text.replace(/\r\n?/g, '\n').split('\n').length);
        for (const c of f.chunks) {
          this.db.prepare('INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?)').run(c.id, c.path, c.startLine, c.endLine, c.heading, c.text);
          this.db.prepare('INSERT INTO passages VALUES (?, ?, ?, ?)').run(c.id, c.path, c.heading, c.text);
        }
      }
      for (const path of current.keys()) { remove(path); counts.removed++; }
      this.setMeta('version', INDEX_VERSION);
      this.setMeta('root', root);
      this.setMeta('revision', revision);
      this.setMeta('indexedAt', new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return counts;
  }

  search(query: string, limit = 5, pathPrefix?: string): { revision: string | null; passages: Passage[] } {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Limit must be an integer between 1 and 10');
    const terms = queryTerms(query);
    if (!terms.length) return { revision: this.meta('revision') ?? null, passages: [] };
    const expression = terms.map(t => `"${t.replaceAll('"', '""')}"`).join(' OR ');
    // Parameters contain literal FTS tokens, never caller-supplied FTS syntax.
    this.db.exec('BEGIN');
    try {
    const rows = this.db.prepare(`SELECT c.id, c.path, c.start_line AS startLine, c.end_line AS endLine, c.heading, c.text, d.hash AS documentHash,
        bm25(passages, 0, 1, 3, 1) AS score
      FROM passages JOIN chunks c ON passages.id = c.id JOIN documents d ON d.path = c.path
      WHERE passages MATCH ? AND (? = '' OR substr(c.path, 1, length(?)) = ?)
      ORDER BY score, c.path, c.start_line LIMIT ?`).all(expression, pathPrefix ?? '', pathPrefix ?? '', pathPrefix ?? '', limit) as unknown as (Chunk & { documentHash: string; score: number })[];
    return { revision: this.meta('revision') ?? null, passages: rows.map(r => ({ ...r, citation: `[${r.path}:${r.startLine}-${r.endLine}]` })) };
    } finally { this.db.exec('COMMIT'); }
  }

  read(path: string, startLine = 1, endLine?: number, expectedHash?: string): { path: string; startLine: number; endLine: number; text: string; documentHash: string; citation: string } {
    const doc = this.db.prepare('SELECT text, hash, lines FROM documents WHERE path = ?').get(path) as { text: string; hash: string; lines: number } | undefined;
    if (!doc) throw new Error('Document is not in the index');
    if (expectedHash && expectedHash !== doc.hash) throw new Error('Document changed. Search again to get a current citation.');
    const end = endLine ?? Math.min(doc.lines, startLine + 59);
    if (!Number.isInteger(startLine) || !Number.isInteger(end) || startLine < 1 || end < startLine || end > doc.lines || end - startLine >= 120) throw new Error('Invalid line range (maximum 120 lines, within the document)');
    const text = doc.text.split('\n').slice(startLine - 1, end).join('\n');
    if (text.length > 16000) throw new Error('Requested context exceeds 16,000 characters; request fewer lines');
    return { path, startLine, endLine: end, text, documentHash: doc.hash, citation: `[${path}:${startLine}-${end}]` };
  }

  list(offset = 0, limit = 50): { documents: { path: string; hash: string; lines: number }[]; nextOffset: number | null } {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid pagination');
    const rows = this.db.prepare('SELECT path, hash, lines FROM documents ORDER BY path LIMIT ? OFFSET ?').all(limit + 1, offset) as { path: string; hash: string; lines: number }[];
    return { documents: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }

  status(): { revision: string | null; indexedAt: string | null; documents: number; chunks: number; search: string } {
    const count = (table: 'documents' | 'chunks') => (this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    return { revision: this.meta('revision') ?? null, indexedAt: this.meta('indexedAt') ?? null, documents: count('documents'), chunks: count('chunks'), search: 'SQLite FTS5 / BM25 (lexical)' };
  }
}
