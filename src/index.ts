import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
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

const httpServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (url.pathname !== '/mcp') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  if (!validateHost(request, response) || !validateOrigin(request, response)) return;
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
