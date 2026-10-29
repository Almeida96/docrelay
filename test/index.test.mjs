import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentIndex } from '../dist/index.js';
import { chunkDocument } from '../dist/chunk.js';

async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'docrelay-'));
  const root = join(temp, 'docs'); await mkdir(root);
  const index = new DocumentIndex(join(temp, 'index.db'), { create: true });
  t.after(async () => { index.close(); await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  return { root, index, temp, put: (p, text) => writeFile(join(root, p), text) };
}

test('ingests nested Markdown and returns exact original source lines', async t => {
  const f = await fixture(t); await mkdir(join(f.root, 'ops'));
  await f.put('ops/queue.md', '# Operations\r\n\r\n## Recovery\r\nReplay at 20 events per second.\r\n');
  await f.index.ingest(f.root);
  const result = f.index.search('replay events').passages[0];
  assert.equal(result.path, 'ops/queue.md'); assert.equal(result.startLine, 3);
  assert.equal(result.endLine, 5); assert.match(result.text, /Replay at 20/);
  assert.equal(f.index.read(result.path, result.startLine, result.endLine, result.documentHash).text, result.text);
});
test('unchanged ingestion preserves revision and chunk identifiers', async t => {
  const f = await fixture(t); await f.put('a.md', '# Policy\nRetry three times.');
  const first = await f.index.ingest(f.root); const id = f.index.search('retry').passages[0].id;
  const next = await f.index.ingest(f.root);
  assert.equal(next.unchanged, 1); assert.equal(next.added + next.updated + next.removed, 0);
  assert.equal(first.revision, next.revision); assert.equal(f.index.search('retry').passages[0].id, id);
});
test('updates replace old passages and reject stale hashes', async t => {
  const f = await fixture(t); await f.put('a.md', 'Obsolete zebra instruction'); await f.index.ingest(f.root);
  const old = f.index.search('zebra').passages[0];
  await f.put('a.md', 'Current otter instruction'); const result = await f.index.ingest(f.root);
  assert.equal(result.updated, 1); assert.equal(f.index.search('zebra').passages.length, 0);
  assert.equal(f.index.search('otter').passages.length, 1);
  assert.throws(() => f.index.read('a.md', 1, 1, old.documentHash), /changed/);
});
test('removed files disappear from document listing and search', async t => {
  const f = await fixture(t); await f.put('a.txt', 'Deleted zebra'); await f.index.ingest(f.root);
  await rm(join(f.root, 'a.txt')); assert.equal((await f.index.ingest(f.root)).removed, 1);
  assert.equal(f.index.status().documents, 0); assert.equal(f.index.search('zebra').passages.length, 0);
});
test('failed ingestion preserves the previous complete snapshot', async t => {
  const f = await fixture(t); await f.put('a.md', 'Stable instruction'); const before = await f.index.ingest(f.root);
  await f.put('a.md', 'Changed instruction'); await f.put('b.txt', Buffer.from([0xff, 0xfe]));
  await assert.rejects(f.index.ingest(f.root));
  assert.equal(f.index.status().revision, before.revision); assert.match(f.index.read('a.md').text, /Stable/);
});
test('read-only connections see a committed refresh', async t => {
  const f = await fixture(t); await f.put('a.md', 'Initial state'); await f.index.ingest(f.root);
  const reader = new DocumentIndex(f.index.filename);
  try {
  await f.put('a.md', 'Refreshed state'); await f.index.ingest(f.root);
  assert.match(reader.read('a.md').text, /Refreshed/);
  await assert.rejects(reader.ingest(f.root), /readonly|read-only/i);
  } finally { reader.close(); }
});
test('hidden files, dependencies, binaries and symlinks are excluded', async t => {
  const f = await fixture(t); await f.put('.secret.md', 'secret'); await f.put('data.json', '{}');
  await mkdir(join(f.root, 'node_modules')); await f.put('node_modules/readme.md', 'dependency');
  await f.put('public.md', 'public');
  try { await symlink(join(f.root, 'public.md'), join(f.root, 'link.md')); } catch (e) { if (!['EPERM', 'EACCES'].includes(e.code)) throw e; }
  await f.index.ingest(f.root); assert.deepEqual(f.index.list().documents.map(d => d.path), ['public.md']);
});
test('another root cannot replace an existing index', async t => {
  const f = await fixture(t); await f.index.ingest(f.root); await mkdir(join(f.temp, 'other'));
  await assert.rejects(f.index.ingest(join(f.temp, 'other')), /another root/);
});
test('path traversal cannot read a non-indexed file', async t => {
  const f = await fixture(t); await f.index.ingest(f.root);
  assert.throws(() => f.index.read('../index.db'), /not in the index/);
});
test('FTS syntax and SQL characters are treated as query text', async t => {
  const f = await fixture(t); await f.put('a.md', 'Retry policy'); await f.index.ingest(f.root);
  for (const q of ['" OR retry:*', "'; DROP TABLE documents;--", 'NEAR(retry, policy)', '*']) assert.doesNotThrow(() => f.index.search(q));
  assert.equal(f.index.status().documents, 1);
});
test('empty results, prefix filters, pagination and limits', async t => {
  const f = await fixture(t); await f.put('a.md', 'retry policy'); await f.put('b.md', 'retry deadline'); await f.index.ingest(f.root);
  assert.equal(f.index.search('galaxy').passages.length, 0); assert.equal(f.index.search('the and').passages.length, 0);
  assert.equal(f.index.search('retry', 5, 'b').passages[0].path, 'b.md');
  assert.equal(f.index.list(0, 1).nextOffset, 1); assert.equal(f.index.list(1, 1).nextOffset, null);
  for (const limit of [0, 11, 1.5, NaN]) assert.throws(() => f.index.search('retry', limit));
  assert.throws(() => f.index.search('')); assert.throws(() => f.index.search('x'.repeat(1001)));
  assert.throws(() => f.index.read('a.md', 0)); assert.throws(() => f.index.read('a.md', 1, 400));
});
test('code fences do not create false headings and large sections have bounded chunks', () => {
  const text = '# Real\n```bash\n# not a heading\n```\n' + Array.from({ length: 140 }, (_, n) => `line ${n}`).join('\n');
  const chunks = chunkDocument('code.md', text);
  assert.ok(chunks.length >= 3); assert.ok(chunks.every(c => c.heading === 'Real' && c.endLine - c.startLine < 60));
  for (const c of chunks) assert.equal(c.text, text.split('\n').slice(c.startLine - 1, c.endLine).join('\n'));
});
test('oversized documents and binary text fail without indexing partial data', async t => {
  const f = await fixture(t); await f.put('big.txt', 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(f.index.ingest(f.root), /1 MiB/); await f.put('big.txt', 'x\0x');
  await assert.rejects(f.index.ingest(f.root), /Binary/); assert.equal(f.index.status().documents, 0);
});
