import { timingSafeEqual } from 'node:crypto';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { agents, type Agent } from '../src/config.js';
import { buildMcpServer } from '../src/mcp.js';
import { PostgresJournalStore } from '../src/postgres.js';

function parseTokens(value: string | undefined): Map<string, Agent> {
  if (!value) throw new Error('MCP_TOKENS is required');
  const result = new Map<string, Agent>();
  for (const entry of value.split(',').map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    const actor = entry.slice(0, separator) as Agent;
    const token = entry.slice(separator + 1);
    if (separator < 1 || !agents.includes(actor) || token.length < 32) throw new Error('MCP_TOKENS must contain supported agent:token pairs with tokens of at least 32 characters');
    result.set(token, actor);
  }
  return result;
}

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('POSTGRES_URL or DATABASE_URL is required');
const store = new PostgresJournalStore(connectionString);
const tokens = parseTokens(process.env.MCP_TOKENS);

function actorFor(request: Request): Agent | undefined {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const supplied = Buffer.from(authorization.slice(7));
  for (const [token, actor] of tokens) {
    const expected = Buffer.from(token);
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return actor;
  }
}

const mcp = createMcpHandler(({ requestInfo }) => {
  const authorization = requestInfo?.headers.get('authorization');
  const actor = authorization ? actorFor(new Request('https://merge.turtlez.au/mcp', { headers: { authorization } })) : undefined;
  if (!actor) throw new Error('Authenticated actor was not available to MCP handler');
  return buildMcpServer(store, actor);
}, { onerror: (error) => console.error(JSON.stringify({ level: 'error', message: error.message })) });

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/^\/api(?=\/|$)/, '');
  if (pathname === '/healthz') return json({ status: 'ok' });

  if (request.method === 'GET' && pathname === '/projects') return json({ projects: await store.listProjects() });
  const journal = request.method === 'GET' && pathname.match(/^\/projects\/([^/]+)\/journal$/);
  if (journal) {
    const actor = url.searchParams.get('actor') as Agent | null;
    if (actor && !agents.includes(actor)) return json({ error: 'invalid_actor' }, 400);
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);
    try {
      return json(await store.getJournal(decodeURIComponent(journal[1]), limit, url.searchParams.get('repository') ?? undefined, actor ?? undefined));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read journal';
      return json({ error: 'journal_read_failed', message }, message.startsWith('unknown project:') ? 404 : 400);
    }
  }

  if (pathname !== '/mcp') return json({ error: 'not_found' }, 404);
  if (!actorFor(request)) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' } });
  const origin = request.headers.get('origin');
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'https://merge.turtlez.au').split(',').map((value) => value.trim());
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'forbidden_origin' }, 403);
  return mcp.fetch(request);
}
