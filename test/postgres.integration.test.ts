import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PostgresJournalStore } from '../src/postgres.js';

const connectionString = process.env.TEST_POSTGRES_URL;

test('PostgreSQL creates, records, and reads a journal entry', { skip: !connectionString }, async () => {
  const store = new PostgresJournalStore(connectionString!);
  const suffix = randomUUID().slice(0, 8);
  const slug = `integration-${suffix}`;
  const repository = `turtlez/mergelog-test-${suffix}`;
  try {
    await store.createProject({ slug, name: `Integration ${suffix}`, repositories: [repository] }, 'codex');
    const input = {
      projectSlug: slug,
      repository,
      prNumber: 1,
      prUrl: `https://github.com/${repository}/pull/1`,
      title: 'Vercel PostgreSQL integration',
      summary: 'Verified the serverless persistence path.',
      decisions: ['Use PostgreSQL'],
      followUps: [],
      idempotencyKey: `integration-${randomUUID()}`,
    };
    const [first, second] = await Promise.all([
      store.recordPrUpdate(input, 'opencode'),
      store.recordPrUpdate(input, 'opencode'),
    ]) as Array<{ messageId: string; idempotentReplay?: boolean }>;
    const journal = await store.getJournal(slug, 10) as { entries: Array<{ message: { id: string; actor: string } }> };
    assert.equal(first.messageId, second.messageId);
    assert.equal([first.idempotentReplay, second.idempotentReplay].filter(Boolean).length, 1);
    assert.equal(journal.entries.length, 1);
    assert.equal(journal.entries[0].message.id, first.messageId);
    assert.equal(journal.entries[0].message.actor, 'opencode');
  } finally {
    await store.close();
  }
});
