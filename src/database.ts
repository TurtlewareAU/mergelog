import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Agent } from './config.js';

export interface ProjectInput {
  slug: string;
  name: string;
  repositories: string[];
}

export interface PrUpdateInput {
  projectSlug: string;
  repository: string;
  prNumber: number;
  prUrl: string;
  title: string;
  summary: string;
  mergeSha?: string;
  mergedAt?: string;
  decisions: string[];
  followUps: string[];
  idempotencyKey: string;
}

type Row = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

export function normalizeRepository(value: string): string {
  const trimmed = value.trim().replace(/\.git$/i, '').replace(/\/$/, '');
  const match = trimmed.match(/^(?:https?:\/\/github\.com\/|git@github\.com:)?([^/\s]+)\/([^/\s]+)$/i);
  if (!match) throw new Error('repository must be a GitHub owner/name or GitHub URL');
  return `${match[1]}/${match[2]}`.toLowerCase();
}

export class JournalDatabase {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'github',
        normalized_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pr_threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        repository_id TEXT NOT NULL REFERENCES repositories(id),
        pr_number INTEGER NOT NULL,
        pr_url TEXT NOT NULL,
        title TEXT NOT NULL,
        merge_sha TEXT,
        merged_at TEXT,
        merge_status TEXT NOT NULL DEFAULT 'reported',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(repository_id, pr_number)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES pr_threads(id) ON DELETE CASCADE,
        actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        decisions_json TEXT NOT NULL DEFAULT '[]',
        follow_ups_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        amended_at TEXT
      );
      CREATE TABLE IF NOT EXISTS message_amendments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id),
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        client TEXT NOT NULL,
        key TEXT NOT NULL,
        operation TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(client, key)
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_threads_project_updated ON pr_threads(project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at);
    `);
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private audit(actor: Agent, action: string, entityType: string, entityId: string, detail: unknown): void {
    this.db.prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      randomUUID(), actor, action, entityType, entityId, JSON.stringify(detail), now(),
    );
  }

  createProject(input: ProjectInput, actor: Agent): object {
    return this.transaction(() => {
      const id = randomUUID();
      const createdAt = now();
      this.db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)').run(id, input.slug, input.name, actor, createdAt);
      const repositories = [...new Set(input.repositories.map(normalizeRepository))];
      const insertRepository = this.db.prepare('INSERT INTO repositories VALUES (?, ?, ?, ?, ?)');
      for (const repository of repositories) insertRepository.run(randomUUID(), id, 'github', repository, createdAt);
      const result = { id, slug: input.slug, name: input.name, repositories, createdAt };
      this.audit(actor, 'project.created', 'project', id, result);
      return result;
    });
  }

  listProjects(): object[] {
    const projects = this.db.prepare('SELECT id, slug, name, created_by, created_at FROM projects ORDER BY slug').all() as Row[];
    const repositoryQuery = this.db.prepare('SELECT normalized_name FROM repositories WHERE project_id = ? ORDER BY normalized_name');
    return projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      createdBy: project.created_by,
      createdAt: project.created_at,
      repositories: (repositoryQuery.all(project.id as string) as Row[]).map((row) => row.normalized_name),
    }));
  }

  recordPrUpdate(input: PrUpdateInput, actor: Agent): object {
    const existing = this.db.prepare('SELECT operation, result_json FROM idempotency_keys WHERE client = ? AND key = ?').get(actor, input.idempotencyKey) as Row | undefined;
    if (existing) {
      if (existing.operation !== 'pr_update_record') throw new Error('idempotency key was already used for a different operation');
      return { ...(JSON.parse(existing.result_json as string) as object), idempotentReplay: true };
    }

    return this.transaction(() => {
      const repository = normalizeRepository(input.repository);
      const project = this.db.prepare('SELECT id FROM projects WHERE slug = ? COLLATE NOCASE').get(input.projectSlug) as Row | undefined;
      if (!project) throw new Error(`unknown project: ${input.projectSlug}`);
      const projectId = project.id as string;
      const repositoryRow = this.db.prepare('SELECT id FROM repositories WHERE project_id = ? AND normalized_name = ? COLLATE NOCASE').get(projectId, repository) as Row | undefined;
      if (!repositoryRow) throw new Error(`repository ${repository} is not attached to project ${input.projectSlug}`);
      const repositoryId = repositoryRow.id as string;

      const timestamp = now();
      const existingThread = this.db.prepare('SELECT id FROM pr_threads WHERE repository_id = ? AND pr_number = ?').get(repositoryId, input.prNumber) as Row | undefined;
      const threadId = existingThread ? existingThread.id as string : randomUUID();
      let created = false;
      if (!existingThread) {
        this.db.prepare('INSERT INTO pr_threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          threadId, projectId, repositoryId, input.prNumber, input.prUrl, input.title,
          input.mergeSha ?? null, input.mergedAt ?? null, 'reported', timestamp, timestamp,
        );
        created = true;
      } else {
        this.db.prepare('UPDATE pr_threads SET pr_url=?, title=?, merge_sha=COALESCE(?, merge_sha), merged_at=COALESCE(?, merged_at), updated_at=? WHERE id=?').run(
          input.prUrl, input.title, input.mergeSha ?? null, input.mergedAt ?? null, timestamp, threadId,
        );
      }

      const messageId = randomUUID();
      this.db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run(
        messageId, threadId, actor, input.summary, JSON.stringify(input.decisions), JSON.stringify(input.followUps), timestamp,
      );
      const result = { threadId, messageId, created, projectSlug: input.projectSlug, repository, prNumber: input.prNumber, actor, recordedAt: timestamp };
      this.audit(actor, 'pr.update_recorded', 'pr_thread', threadId, result);
      this.db.prepare('INSERT INTO idempotency_keys VALUES (?, ?, ?, ?, ?)').run(actor, input.idempotencyKey, 'pr_update_record', JSON.stringify(result), timestamp);
      return result;
    });
  }

  amendMessage(messageId: string, summary: string, decisions: string[], followUps: string[], reason: string, actor: Agent): object {
    return this.transaction(() => {
      const message = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as Row | undefined;
      if (!message) throw new Error(`unknown message: ${messageId}`);
      const before = { summary: message.summary, decisions: JSON.parse(message.decisions_json as string), followUps: JSON.parse(message.follow_ups_json as string) };
      const after = { summary, decisions, followUps };
      const amendedAt = now();
      this.db.prepare('UPDATE messages SET summary=?, decisions_json=?, follow_ups_json=?, amended_at=? WHERE id=?').run(
        summary, JSON.stringify(decisions), JSON.stringify(followUps), amendedAt, messageId,
      );
      this.db.prepare('INSERT INTO message_amendments VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        randomUUID(), messageId, actor, reason, JSON.stringify(before), JSON.stringify(after), amendedAt,
      );
      this.audit(actor, 'message.amended', 'message', messageId, { reason, before, after });
      return { messageId, amendedAt, actor };
    });
  }

  getJournal(projectSlug: string, limit: number, repository?: string, actor?: Agent): object {
    const project = this.db.prepare('SELECT id, slug, name FROM projects WHERE slug = ? COLLATE NOCASE').get(projectSlug) as Row | undefined;
    if (!project) throw new Error(`unknown project: ${projectSlug}`);
    const clauses = ['t.project_id = ?'];
    const params: Array<string | number> = [project.id as string];
    if (repository) { clauses.push('r.normalized_name = ? COLLATE NOCASE'); params.push(normalizeRepository(repository)); }
    if (actor) { clauses.push('m.actor = ?'); params.push(actor); }
    params.push(limit);
    const rows = this.db.prepare(`
      SELECT t.id AS thread_id, t.pr_number, t.pr_url, t.title, t.merge_sha, t.merged_at, t.merge_status,
             r.normalized_name AS repository, m.id AS message_id, m.actor, m.summary,
             m.decisions_json, m.follow_ups_json, m.created_at, m.amended_at
      FROM messages m JOIN pr_threads t ON t.id=m.thread_id JOIN repositories r ON r.id=t.repository_id
      WHERE ${clauses.join(' AND ')} ORDER BY m.created_at DESC LIMIT ?
    `).all(...params) as Row[];
    return {
      project: { slug: project.slug, name: project.name },
      entries: rows.map((row) => ({
        threadId: row.thread_id, repository: row.repository, prNumber: row.pr_number, prUrl: row.pr_url,
        title: row.title, mergeSha: row.merge_sha, mergedAt: row.merged_at, mergeStatus: row.merge_status,
        message: { id: row.message_id, actor: row.actor, summary: row.summary, decisions: JSON.parse(row.decisions_json as string), followUps: JSON.parse(row.follow_ups_json as string), createdAt: row.created_at, amendedAt: row.amended_at },
      })),
    };
  }
}
