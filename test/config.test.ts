import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

test('loads agent tokens from a secret file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mergelog-config-'));
  const secretPath = join(directory, 'mcp_tokens');
  try {
    writeFileSync(secretPath, 'codex:production-codex-token\nclaude:production-claude-token'.replace('\n', ','));
    const config = loadConfig({ MCP_TOKENS_FILE: secretPath });
    assert.equal(config.tokens.get('production-codex-token'), 'codex');
    assert.equal(config.tokens.get('production-claude-token'), 'claude');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects ambiguous inline and file token configuration', () => {
  assert.throws(
    () => loadConfig({ MCP_TOKENS: 'codex:inline-token', MCP_TOKENS_FILE: '/run/secrets/mcp_tokens' }),
    /Set only one/,
  );
});

test('fails closed when the configured secret file is unavailable', () => {
  assert.throws(
    () => loadConfig({ MCP_TOKENS_FILE: '/definitely/missing/mcp_tokens' }),
    /Unable to read MCP_TOKENS_FILE/,
  );
});
