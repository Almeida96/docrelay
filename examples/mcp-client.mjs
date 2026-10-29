import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DocumentIndex } from '../dist/index.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const db = resolve(project, '.docrelay/demo.db');
const index = new DocumentIndex(db, { create: true });
try { await index.ingest(resolve(project, 'examples/runbooks')); } finally { index.close(); }
const client = new Client({ name: 'docrelay-example', version: '0.1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(project, 'dist/cli.js'), 'serve', '--db', db], stderr: 'inherit' }));
  const tools = (await client.listTools()).tools;
  console.log('Connected through MCP. Available tools:', tools.map(t => t.name).join(', '));
  const result = await client.callTool({ name: 'search_documents', arguments: { query: process.argv.slice(2).join(' ') || 'dead-letter queue replay rate', limit: 3, pathPrefix: null } });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  for (const passage of result.structuredContent.passages) console.log(`\n${passage.citation}\n${passage.text}`);
} finally { await client.close(); }
