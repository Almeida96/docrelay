import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DocumentIndex } from '../dist/index.js';
import { serveHttp } from '../dist/http.js';

async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'docrelay-mcp-')); const root = join(temp, 'docs'); await mkdir(root);
  await writeFile(join(root, 'queue.md'), '# Queue\nReplay at 20 messages per second.');
  const index = new DocumentIndex(join(temp, 'index.db'), { create: true }); await index.ingest(root);
  t.after(async () => { index.close(); await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  return index;
}
async function exercise(client) {
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(t => t.name).sort(), ['index_status', 'list_documents', 'read_document', 'search_documents']);
  assert.ok(tools.every(t => t.annotations.readOnlyHint));
  const search = await client.callTool({ name: 'search_documents', arguments: { query: 'replay', limit: 3, pathPrefix: null } });
  assert.equal(search.isError, undefined); const passage = search.structuredContent.passages[0];
  assert.equal(passage.path, 'queue.md');
  const read = await client.callTool({ name: 'read_document', arguments: { path: passage.path, startLine: passage.startLine, endLine: passage.endLine, expectedHash: passage.documentHash } });
  assert.match(read.structuredContent.text, /20 messages/);
  const bad = await client.callTool({ name: 'read_document', arguments: { path: '../secret.md', startLine: 1, endLine: null, expectedHash: null } });
  assert.equal(bad.isError, true);
  const invalid = await client.callTool({ name: 'search_documents', arguments: { query: 'x', limit: 99, pathPrefix: null } });
  assert.equal(invalid.isError, true);
  assert.equal((await client.listResources()).resources[0].uri, 'docrelay://index/status');
  assert.equal(JSON.parse((await client.readResource({ uri: 'docrelay://index/status' })).contents[0].text).documents, 1);
}
test('official MCP client completes initialize, tools and resources over stdio', async t => {
  const index = await fixture(t); const client = new Client({ name: 'test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'serve', '--db', index.filename], stderr: 'pipe' });
  try { await client.connect(transport); await exercise(client); } finally { await client.close(); }
});
test('official MCP client works over authenticated Streamable HTTP', async t => {
  const index = await fixture(t); const token = 'test-token-with-at-least-24-characters';
  const http = await serveHttp(index, token, 0); const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(http.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    await exercise(client);
  } finally { await client.close(); await http.close(); }
});
test('HTTP rejects unauthenticated, cross-origin, spoofed host and oversized requests', async t => {
  const index = await fixture(t); const token = 'test-token-with-at-least-24-characters'; const http = await serveHttp(index, token, 0);
  try {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(http.url, { method: 'POST' })).status, 401);
    assert.equal((await fetch(http.url, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' } })).status, 403);
    const spoofed = await new Promise((resolve, reject) => {
      const req = request(http.url, { method: 'POST', headers: { ...headers, Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end('{}');
    });
    assert.equal(spoofed, 403);
    assert.equal((await fetch(http.url, { headers })).status, 405);
    assert.equal((await fetch(http.url, { method: 'POST', headers, body: '{oops' })).status, 400);
    assert.equal((await fetch(http.url, { method: 'POST', headers, body: JSON.stringify({ data: 'x'.repeat(70000) }) })).status, 413);
  } finally { await http.close(); }
});
