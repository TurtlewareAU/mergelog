import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JournalDatabase, normalizeRepository } from '../src/database.js';

test('normalizes supported GitHub repository identifiers', () => {
  assert.equal(normalizeRepository('Turtlez/MergeLog'), 'turtlez/mergelog');
  assert.equal(normalizeRepository('https://github.com/Turtlez/MergeLog.git'), 'turtlez/mergelog');
  assert.equal(normalizeRepository('git@github.com:Turtlez/MergeLog.git'), 'turtlez/mergelog');
});

test('creates projects, records updates, and replays idempotently', () => {
  const database = new JournalDatabase(':memory:');
  try {
    database.createProject({ slug: 'mergelog', name: 'MergeLog', repositories: ['Turtlez/MergeLog'] }, 'codex');
    const input = {
      projectSlug: 'mergelog', repository: 'turtlez/mergelog', prNumber: 12,
      prUrl: 'https://github.com/turtlez/mergelog/pull/12', title: 'Initial server',
      summary: 'Added the first MCP server.', decisions: ['Use SQLite'], followUps: ['Add timeline'],
      idempotencyKey: 'test-key-0001',
    };
    const first = database.recordPrUpdate(input, 'codex') as Record<string, unknown>;
    const replay = database.recordPrUpdate(input, 'codex') as Record<string, unknown>;
    assert.equal(first.messageId, replay.messageId);
    assert.equal(replay.idempotentReplay, true);
    const journal = database.getJournal('mergelog', 50) as { entries: unknown[] };
    assert.equal(journal.entries.length, 1);
  } finally {
    database.close();
  }
});

test('amendments change the message and preserve audit history', () => {
  const database = new JournalDatabase(':memory:');
  try {
    database.createProject({ slug: 'mergelog', name: 'MergeLog', repositories: ['turtlez/mergelog'] }, 'codex');
    const update = database.recordPrUpdate({
      projectSlug: 'mergelog', repository: 'turtlez/mergelog', prNumber: 1,
      prUrl: 'https://github.com/turtlez/mergelog/pull/1', title: 'Test', summary: 'Before',
      decisions: [], followUps: [], idempotencyKey: 'test-key-0002',
    }, 'codex') as { messageId: string };
    database.amendMessage(update.messageId, 'After', ['Keep audit'], [], 'Improve accuracy', 'codex');
    const journal = database.getJournal('mergelog', 50) as { entries: Array<{ message: { summary: string; amendedAt: string } }> };
    assert.equal(journal.entries[0].message.summary, 'After');
    assert.ok(journal.entries[0].message.amendedAt);
    const count = database.db.prepare('SELECT count(*) AS count FROM message_amendments').get() as { count: number };
    assert.equal(count.count, 1);
  } finally {
    database.close();
  }
});
