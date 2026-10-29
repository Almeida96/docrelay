import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

if (!process.env.DOCRELAY_TOKEN) throw new Error('Set DOCRELAY_TOKEN to the token used by the running HTTP server');
const client = new Client({ name: 'docrelay-http-example', version: '0.1.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:7331/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.DOCRELAY_TOKEN}` } },
  }));
  const result = await client.callTool({ name: 'search_documents', arguments: { query: process.argv.slice(2).join(' ') || 'dead-letter replay rate', limit: 3, pathPrefix: null } });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  console.log(JSON.stringify(result.structuredContent, null, 2));
} finally { await client.close(); }
