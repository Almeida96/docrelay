import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentIndex } from '../dist/index.js';
import { evaluate } from '../dist/evaluate.js';

test('retrieval evaluation checks actual evidence spans and reports misses', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'docrelay-eval-'));
  const index = new DocumentIndex(join(temp, 'index.db'), { create: true });
  try {
    await index.ingest('examples/runbooks');
    const cases = JSON.parse(await readFile('examples/questions.json', 'utf8'));
    const report = evaluate(index, cases, 5);
    assert.equal(report.cases, 24); assert.ok(report.recallAtK >= 0.8);
    const miss = evaluate(index, [{ id: 'miss', query: 'xyzzymissingterm', relevant: [{ path: 'queue.md', startLine: 16, endLine: 16 }] }]);
    assert.equal(miss.recallAtK, 0); assert.equal(miss.mrrAtK, 0);
    assert.throws(() => evaluate(index, [{ id: 'bad', query: 'retry', relevant: [{ path: 'missing.md', startLine: 1, endLine: 1 }] }]), /not in the index/);
  } finally { index.close(); await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});
