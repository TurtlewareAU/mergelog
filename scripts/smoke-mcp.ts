import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:3000/mcp');
const token = process.env.MCP_TOKEN ?? 'local-codex-token';
const client = new Client({ name: 'project-journal-smoke-test', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
});

await client.connect(transport);
const tools = await client.listTools();
console.log(JSON.stringify({ tools: tools.tools.map((tool) => tool.name) }, null, 2));

const slug = `smoke-${Date.now()}`;
const created = await client.callTool({ name: 'project_create', arguments: { slug, name: 'Smoke test', repositories: ['turtlez/mergelog'] } });
console.log(JSON.stringify({ projectCreate: created.structuredContent }, null, 2));

const recorded = await client.callTool({ name: 'pr_update_record', arguments: {
  projectSlug: slug, repository: 'turtlez/mergelog', prNumber: 1,
  prUrl: 'https://github.com/turtlez/mergelog/pull/1', title: 'MCP smoke test',
  summary: 'Verified the MCP transport and SQLite write path.', decisions: ['Use Streamable HTTP'],
  followUps: [], idempotencyKey: `smoke-${Date.now()}`,
} });
console.log(JSON.stringify({ prUpdate: recorded.structuredContent }, null, 2));

const journal = await client.callTool({ name: 'project_journal_get', arguments: { projectSlug: slug } });
console.log(JSON.stringify({ journal: journal.structuredContent }, null, 2));
await client.close();
