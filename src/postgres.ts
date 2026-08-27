import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import type { Agent } from './config.js';
import { normalizeRepository, type ProjectInput, type PrUpdateInput } from './database.js';
import type { JournalStore } from './store.js';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

export class PostgresJournalStore implements JournalStore {
  private readonly sql: Sql;
  private migrated?: Promise<void>;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, { max: 3, prepare: false, idle_timeout: 20 });
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  private migrate(): Promise<void> {
    if (!this.migrated) {
      this.migrated = this.runMigrations().catch((error) => {
        this.migrated = undefined;
        throw error;
      });
    }
    return this.migrated;
  }

  private async runMigrations(): Promise<void> {
    await this.sql.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('mergelog-schema-v1'))`;
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL);
        CREATE TABLE IF NOT EXISTS repositories (id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, provider text NOT NULL DEFAULT 'github', normalized_name text NOT NULL UNIQUE, created_at timestamptz NOT NULL);
        CREATE TABLE IF NOT EXISTS pr_threads (id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id), repository_id text NOT NULL REFERENCES repositories(id), pr_number integer NOT NULL, pr_url text NOT NULL, title text NOT NULL, merge_sha text, merged_at timestamptz, merge_status text NOT NULL DEFAULT 'reported', created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, UNIQUE(repository_id, pr_number));
        CREATE TABLE IF NOT EXISTS messages (id text PRIMARY KEY, thread_id text NOT NULL REFERENCES pr_threads(id) ON DELETE CASCADE, actor text NOT NULL, summary text NOT NULL, decisions_json jsonb NOT NULL DEFAULT '[]', follow_ups_json jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL, amended_at timestamptz);
        CREATE TABLE IF NOT EXISTS message_amendments (id text PRIMARY KEY, message_id text NOT NULL REFERENCES messages(id), actor text NOT NULL, reason text NOT NULL, before_json jsonb NOT NULL, after_json jsonb NOT NULL, created_at timestamptz NOT NULL);
        CREATE TABLE IF NOT EXISTS idempotency_keys (client text NOT NULL, key text NOT NULL, operation text NOT NULL, result_json jsonb NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY(client, key));
        CREATE TABLE IF NOT EXISTS audit_events (id text PRIMARY KEY, actor text NOT NULL, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, detail_json jsonb NOT NULL, created_at timestamptz NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_threads_project_updated ON pr_threads(project_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at);
      `);
    });
  }

  private async audit(sql: any, actor: Agent, action: string, entityType: string, entityId: string, detail: unknown): Promise<void> {
    await sql`INSERT INTO audit_events (id, actor, action, entity_type, entity_id, detail_json, created_at) VALUES (${randomUUID()}, ${actor}, ${action}, ${entityType}, ${entityId}, ${JSON.stringify(detail)}::jsonb, ${now()})`;
  }

  async createProject(input: ProjectInput, actor: Agent): Promise<object> {
    await this.migrate();
    return this.sql.begin(async (sql) => {
      const id = randomUUID(); const createdAt = now();
      await sql`INSERT INTO projects (id, slug, name, created_by, created_at) VALUES (${id}, ${input.slug}, ${input.name}, ${actor}, ${createdAt})`;
      const repositories = [...new Set(input.repositories.map(normalizeRepository))];
      for (const repository of repositories) await sql`INSERT INTO repositories (id, project_id, provider, normalized_name, created_at) VALUES (${randomUUID()}, ${id}, 'github', ${repository}, ${createdAt})`;
      const result = { id, slug: input.slug, name: input.name, repositories, createdAt };
      await this.audit(sql, actor, 'project.created', 'project', id, result);
      return result;
    });
  }

  async listProjects(): Promise<object[]> {
    await this.migrate();
    const rows = await this.sql<Row[]>`SELECT p.id, p.slug, p.name, p.created_by, p.created_at, COALESCE(json_agg(r.normalized_name ORDER BY r.normalized_name) FILTER (WHERE r.id IS NOT NULL), '[]') AS repositories FROM projects p LEFT JOIN repositories r ON r.project_id=p.id GROUP BY p.id ORDER BY p.slug`;
    return rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, createdBy: row.created_by, createdAt: row.created_at, repositories: row.repositories }));
  }

  async recordPrUpdate(input: PrUpdateInput, actor: Agent): Promise<object> {
    await this.migrate();
    const existing = (await this.sql<Row[]>`SELECT operation, result_json FROM idempotency_keys WHERE client=${actor} AND key=${input.idempotencyKey}`)[0];
    if (existing) {
      if (existing.operation !== 'pr_update_record') throw new Error('idempotency key was already used for a different operation');
      return { ...(existing.result_json as object), idempotentReplay: true };
    }
    return this.sql.begin(async (sql) => {
      const repository = normalizeRepository(input.repository);
      const project = (await sql<Row[]>`SELECT id FROM projects WHERE lower(slug)=lower(${input.projectSlug})`)[0];
      if (!project) throw new Error(`unknown project: ${input.projectSlug}`);
      const repositoryRow = (await sql<Row[]>`SELECT id FROM repositories WHERE project_id=${project.id as string} AND lower(normalized_name)=lower(${repository})`)[0];
      if (!repositoryRow) throw new Error(`repository ${repository} is not attached to project ${input.projectSlug}`);
      const timestamp = now();
      const existingThread = (await sql<Row[]>`SELECT id FROM pr_threads WHERE repository_id=${repositoryRow.id as string} AND pr_number=${input.prNumber}`)[0];
      const threadId = existingThread?.id as string | undefined ?? randomUUID();
      if (existingThread) await sql`UPDATE pr_threads SET pr_url=${input.prUrl}, title=${input.title}, merge_sha=COALESCE(${input.mergeSha ?? null}, merge_sha), merged_at=COALESCE(${input.mergedAt ?? null}, merged_at), updated_at=${timestamp} WHERE id=${threadId}`;
      else await sql`INSERT INTO pr_threads (id, project_id, repository_id, pr_number, pr_url, title, merge_sha, merged_at, merge_status, created_at, updated_at) VALUES (${threadId}, ${project.id as string}, ${repositoryRow.id as string}, ${input.prNumber}, ${input.prUrl}, ${input.title}, ${input.mergeSha ?? null}, ${input.mergedAt ?? null}, 'reported', ${timestamp}, ${timestamp})`;
      const messageId = randomUUID();
      await sql`INSERT INTO messages (id, thread_id, actor, summary, decisions_json, follow_ups_json, created_at) VALUES (${messageId}, ${threadId}, ${actor}, ${input.summary}, ${JSON.stringify(input.decisions)}::jsonb, ${JSON.stringify(input.followUps)}::jsonb, ${timestamp})`;
      const result = { threadId, messageId, created: !existingThread, projectSlug: input.projectSlug, repository, prNumber: input.prNumber, actor, recordedAt: timestamp };
      await this.audit(sql, actor, 'pr.update_recorded', 'pr_thread', threadId, result);
      await sql`INSERT INTO idempotency_keys (client, key, operation, result_json, created_at) VALUES (${actor}, ${input.idempotencyKey}, 'pr_update_record', ${JSON.stringify(result)}::jsonb, ${timestamp})`;
      return result;
    });
  }

  async amendMessage(messageId: string, summary: string, decisions: string[], followUps: string[], reason: string, actor: Agent): Promise<object> {
    await this.migrate();
    return this.sql.begin(async (sql) => {
      const message = (await sql<Row[]>`SELECT * FROM messages WHERE id=${messageId}`)[0];
      if (!message) throw new Error(`unknown message: ${messageId}`);
      const before = { summary: message.summary, decisions: message.decisions_json, followUps: message.follow_ups_json };
      const after = { summary, decisions, followUps }; const amendedAt = now();
      await sql`UPDATE messages SET summary=${summary}, decisions_json=${JSON.stringify(decisions)}::jsonb, follow_ups_json=${JSON.stringify(followUps)}::jsonb, amended_at=${amendedAt} WHERE id=${messageId}`;
      await sql`INSERT INTO message_amendments (id, message_id, actor, reason, before_json, after_json, created_at) VALUES (${randomUUID()}, ${messageId}, ${actor}, ${reason}, ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, ${amendedAt})`;
      await this.audit(sql, actor, 'message.amended', 'message', messageId, { reason, before, after });
      return { messageId, amendedAt, actor };
    });
  }

  async getJournal(projectSlug: string, limit: number, repository?: string, actor?: Agent): Promise<object> {
    await this.migrate();
    const project = (await this.sql<Row[]>`SELECT id, slug, name FROM projects WHERE lower(slug)=lower(${projectSlug})`)[0];
    if (!project) throw new Error(`unknown project: ${projectSlug}`);
    const normalized = repository ? normalizeRepository(repository) : null;
    const rows = await this.sql<Row[]>`SELECT t.id AS thread_id, t.pr_number, t.pr_url, t.title, t.merge_sha, t.merged_at, t.merge_status, r.normalized_name AS repository, m.id AS message_id, m.actor, m.summary, m.decisions_json, m.follow_ups_json, m.created_at, m.amended_at FROM messages m JOIN pr_threads t ON t.id=m.thread_id JOIN repositories r ON r.id=t.repository_id WHERE t.project_id=${project.id as string} AND (${normalized}::text IS NULL OR lower(r.normalized_name)=lower(${normalized})) AND (${actor ?? null}::text IS NULL OR m.actor=${actor ?? null}) ORDER BY m.created_at DESC LIMIT ${limit}`;
    const repositories = await this.sql<Row[]>`SELECT normalized_name FROM repositories WHERE project_id=${project.id as string} ORDER BY normalized_name`;
    return { project: { slug: project.slug, name: project.name, repositories: repositories.map((row) => row.normalized_name) }, entries: rows.map((row) => ({ threadId: row.thread_id, repository: row.repository, prNumber: row.pr_number, prUrl: row.pr_url, title: row.title, mergeSha: row.merge_sha, mergedAt: row.merged_at, mergeStatus: row.merge_status, message: { id: row.message_id, actor: row.actor, summary: row.summary, decisions: row.decisions_json, followUps: row.follow_ups_json, createdAt: row.created_at, amendedAt: row.amended_at } })) };
  }
}
