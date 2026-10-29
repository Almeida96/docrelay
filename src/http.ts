import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp.js';
import type { DocumentIndex } from './index.js';

export async function serveHttp(index: DocumentIndex, token: string, port = 7331): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  if (token.length < 24 || token.length > 256) throw new Error('DOCRELAY_TOKEN must contain 24–256 characters');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const secret = Buffer.from(`Bearer ${token}`);
  let addressPort = port;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const allowedHosts = [`127.0.0.1:${addressPort}`, `localhost:${addressPort}`];
    if (!allowedHosts.includes(req.headers.host ?? '') || (req.headers.origin && !allowedHosts.map(h => `http://${h}`).includes(req.headers.origin))) {
      res.writeHead(403).end('Forbidden origin or host'); return;
    }
    const auth = Buffer.from(req.headers.authorization ?? '');
    if (auth.length !== secret.length || !timingSafeEqual(auth, secret)) { res.writeHead(401).end('Bearer token required'); return; }
    if (req.url !== '/mcp') { res.writeHead(404).end('Not found'); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end('Use POST for stateless MCP requests'); return; }
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) { res.writeHead(415).end('Expected application/json'); return; }
    const mcp = createMcpServer(index);
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void mcp.close(); });
    try {
      let length = 0;
      const buffers: Buffer[] = [];
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk as Uint8Array);
        length += buffer.length;
        if (length > 65536) { res.writeHead(413).end('Request exceeds 64 KiB'); return; }
        buffers.push(buffer);
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(buffers).toString('utf8')); }
      catch { res.writeHead(400).end('Invalid JSON'); return; }
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(500).end('Request failed');
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  addressPort = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${addressPort}/mcp`, close: () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }) };
}
