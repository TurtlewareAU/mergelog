import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Agent = 'codex' | 'claude' | 'human';

export interface Config {
  host: string;
  port: number;
  databasePath: string;
  tokens: Map<string, Agent>;
  allowedHosts: string[];
  webDistPath: string;
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
  if (env.MCP_TOKENS && env.MCP_TOKENS_FILE) throw new Error('Set only one of MCP_TOKENS or MCP_TOKENS_FILE');

  let tokenValue = env.MCP_TOKENS ?? 'codex:local-codex-token';
  if (env.MCP_TOKENS_FILE) {
    try {
      tokenValue = readFileSync(resolve(env.MCP_TOKENS_FILE), 'utf8').trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read MCP_TOKENS_FILE: ${message}`);
    }
  }

  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    databasePath: resolve(env.DATABASE_PATH ?? './data/journal.sqlite'),
    webDistPath: resolve(env.WEB_DIST_PATH ?? './web/dist'),
    tokens: parseTokens(tokenValue),
    allowedHosts: (env.ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  };
}
