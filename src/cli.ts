#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DocumentIndex } from './index.js';
import { serveStdio } from './mcp.js';
import { serveHttp } from './http.js';
import { evaluate } from './evaluate.js';

const help = `DocRelay — local documentation for MCP agents

Usage:
  docrelay ingest --root ./docs [--db .docrelay/index.db]
  docrelay search "retry budget" [--limit 5] [--path-prefix operations/]
  docrelay status
  docrelay serve [--transport stdio|http] [--port 7331]
  docrelay ask "When should I roll back?" --model YOUR_MODEL
  docrelay evaluate --root examples/runbooks --cases examples/questions.json

All commands accept --db PATH. The default is .docrelay/index.db in the current
directory. HTTP requires DOCRELAY_TOKEN (24–256 characters) and binds to 127.0.0.1.
ask requires OPENAI_API_KEY and --model or OPENAI_MODEL; retrieved text is sent to
the configured OpenAI model. Search, MCP and evaluation run without API keys.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    root: { type: 'string' }, db: { type: 'string' }, limit: { type: 'string' }, 'path-prefix': { type: 'string' },
    transport: { type: 'string' }, port: { type: 'string' }, model: { type: 'string' }, cases: { type: 'string' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
  } });
  if (values.version) { console.log('0.1.0'); return; }
  const command = positionals[0];
  if (!command || values.help) { console.log(help); return; }
  if (!['ingest', 'search', 'status', 'serve', 'ask', 'evaluate'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const db = resolve(values.db ?? '.docrelay/index.db');
  if (command === 'ask') {
    const question = positionals.slice(1).join(' ');
    if (!question) throw new Error('Provide a question');
    if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY to use ask. Search and MCP do not need an API key.');
    const { openAIProvider, runAgent } = await import('./agent.js');
    const provider = openAIProvider(values.model ?? process.env.OPENAI_MODEL ?? '');
    const client = new Client({ name: 'docrelay-agent', version: '0.1.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(dirname(fileURLToPath(import.meta.url)), 'cli.js'), 'serve', '--db', db], stderr: 'inherit' });
    try {
      await client.connect(transport);
      const result = await runAgent(provider, async (name, args, signal) => {
        const result = await client.callTool({ name, arguments: args }, undefined, { signal });
        if (result.isError) throw new Error(JSON.stringify(result.content));
        return result.structuredContent;
      }, question);
      console.log(JSON.stringify(result, null, 2));
    } finally { await client.close(); }
    return;
  }
  const index = new DocumentIndex(db, { create: command === 'ingest' || command === 'evaluate' });
  let serving = false;
  try {
    const print = (data: unknown) => console.log(JSON.stringify(data, null, 2));
    if (command === 'ingest') {
      if (!values.root) throw new Error('ingest requires --root');
      print(await index.ingest(values.root));
    } else if (command === 'search') print(index.search(positionals.slice(1).join(' '), Number(values.limit ?? 5), values['path-prefix']));
    else if (command === 'status') print(index.status());
    else if (command === 'evaluate') {
      if (!values.cases || !values.root) throw new Error('evaluate requires --root and --cases');
      await index.ingest(values.root);
      print(evaluate(index, JSON.parse(await readFile(values.cases, 'utf8')), Number(values.limit ?? 5)));
    } else if (command === 'serve') {
      const transport = values.transport ?? 'stdio';
      if (!['stdio', 'http'].includes(transport)) throw new Error('Transport must be stdio or http');
      let close: () => Promise<void>;
      if (transport === 'http') {
        const http = await serveHttp(index, process.env.DOCRELAY_TOKEN ?? '', Number(values.port ?? 7331));
        console.error(`DocRelay listening at ${http.url}`);
        close = http.close;
      } else {
        const mcp = await serveStdio(index);
        close = () => mcp.close();
        process.stdin.once('end', () => { void shutdown(); });
      }
      serving = true;
      let stopped = false;
      async function shutdown() {
        if (stopped) return;
        stopped = true;
        await close(); index.close();
      }
      process.once('SIGINT', () => { void shutdown(); });
      process.once('SIGTERM', () => { void shutdown(); });
    }
  } finally { if (!serving) index.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Command failed'); process.exitCode = 1; });
