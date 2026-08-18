import { resolve } from 'node:path';

export type Agent = 'codex' | 'claude' | 'human';

export interface Config {
  host: string;
  port: number;
  databasePath: string;
  tokens: Map<string, Agent>;
  allowedHosts: string[];
}

function parseTokens(value: string): Map<string, Agent> {
  const tokens = new Map<string, Agent>();
  for (const entry of value.split(',').map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    if (separator < 1 || separator === entry.length - 1) {
      throw new Error('MCP_TOKENS must use agent:token pairs separated by commas');
    }
    const agent = entry.slice(0, separator);
    const token = entry.slice(separator + 1);
    if (!['codex', 'claude', 'human'].includes(agent)) {
      throw new Error(`Unsupported MCP_TOKENS agent: ${agent}`);
    }
    if (token.length < 8) throw new Error('MCP tokens must be at least 8 characters');
    tokens.set(token, agent as Agent);
  }
  if (tokens.size === 0) throw new Error('At least one MCP token is required');
  return tokens;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');

  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    databasePath: resolve(env.DATABASE_PATH ?? './data/journal.sqlite'),
    tokens: parseTokens(env.MCP_TOKENS ?? 'codex:local-codex-token'),
    allowedHosts: (env.ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  };
}
