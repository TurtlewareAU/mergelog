import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { loadConfig, type Agent } from './config.js';
import { JournalDatabase } from './database.js';
import { buildMcpServer } from './mcp.js';

const config = loadConfig();
const database = new JournalDatabase(config.databasePath);

function actorForAuthorization(header: string | undefined): Agent | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  const supplied = Buffer.from(header.slice(7));
  for (const [token, actor] of config.tokens) {
    const expected = Buffer.from(token);
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return actor;
  }
  return undefined;
}

const handler = createMcpHandler(({ requestInfo }) => {
  const actor = actorForAuthorization(requestInfo?.headers.get('authorization') ?? undefined);
  if (!actor) throw new Error('Authenticated actor was not available to MCP handler');
  return buildMcpServer(database, actor);
}, { onerror: (error) => console.error(JSON.stringify({ level: 'error', message: error.message })) });
const handleMcp = toNodeHandler(handler, { onerror: (error) => console.error(error) });
const validateHost = hostHeaderValidation(config.allowedHosts);
const validateOrigin = originValidation(config.allowedHosts);

function json(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

async function serveWebAsset(pathname: string, response: import('node:http').ServerResponse, headOnly = false): Promise<boolean> {
  if (pathname !== '/' && !pathname.startsWith('/assets/')) return false;
  const relativePath = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^[/\\]+/, '');
  const filePath = join(config.webDistPath, relativePath);
  try {
    const contents = await readFile(filePath);
    const immutable = relativePath.startsWith('assets/');
    response.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'content-security-policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(headOnly ? undefined : contents);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(error);
    json(response, 404, { error: 'not_found' });
  }
  return true;
}

const httpServer = createServer(async (request, response) => {
  let url: URL;
  try {
    url = new URL(request.url ?? '/', 'http://localhost');
  } catch {
    json(response, 400, { error: 'invalid_request_target' });
    return;
  }
  if (url.pathname === '/healthz') {
    json(response, 200, { status: 'ok' });
    return;
  }
  if (!validateHost(request, response)) return;
  if (request.method === 'GET' && url.pathname === '/api/projects') {
    json(response, 200, { projects: database.listProjects() });
    return;
  }
  const journalMatch = request.method === 'GET' && url.pathname.match(/^\/api\/projects\/([^/]+)\/journal$/);
  if (journalMatch) {
    try {
      const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);
      const actor = url.searchParams.get('actor') as Agent | null;
      if (actor && !['codex', 'claude', 'human'].includes(actor)) {
        json(response, 400, { error: 'invalid_actor' });
        return;
      }
      json(response, 200, database.getJournal(decodeURIComponent(journalMatch[1]), limit, url.searchParams.get('repository') ?? undefined, actor ?? undefined));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read journal';
      json(response, message.startsWith('unknown project:') ? 404 : 400, { error: 'journal_read_failed', message });
    }
    return;
  }
  if ((request.method === 'GET' || request.method === 'HEAD') && await serveWebAsset(url.pathname, response, request.method === 'HEAD')) return;
  if (url.pathname !== '/mcp') {
    json(response, 404, { error: 'not_found' });
    return;
  }
  if (!validateOrigin(request, response)) return;
  if (!actorForAuthorization(request.headers.authorization)) {
    response.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
    response.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  await handleMcp(request, response);
});

httpServer.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ level: 'info', message: 'project journal listening', host: config.host, port: config.port, databasePath: config.databasePath }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ level: 'info', message: 'shutting down', signal }));
  httpServer.close(() => { handler.close(); database.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
