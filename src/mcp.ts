import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Agent } from './config.js';
import { JournalDatabase } from './database.js';

const slug = z.string().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const shortText = z.string().trim().min(1).max(500);
const notes = z.array(z.string().trim().min(1).max(1000)).max(20).default([]);

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

export function buildMcpServer(database: JournalDatabase, actor: Agent): McpServer {
  const server = new McpServer({ name: 'project-journal', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.registerTool('project_create', {
    title: 'Create project',
    description: 'Create a journal project and attach its GitHub repositories.',
    inputSchema: z.object({ slug, name: shortText, repositories: z.array(z.string().min(3).max(300)).min(1).max(20) }),
  }, async (input) => { try { return result(database.createProject(input, actor)); } catch (error) { return failure(error); } });

  server.registerTool('project_list', {
    title: 'List projects',
    description: 'List journal projects and their attached GitHub repositories.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => result({ projects: database.listProjects() }));

  server.registerTool('pr_update_record', {
    title: 'Record PR update',
    description: 'Create or find a pull-request thread and append an attributed journal message.',
    inputSchema: z.object({
      projectSlug: slug,
      repository: z.string().min(3).max(300),
      prNumber: z.number().int().positive(),
      prUrl: z.url().max(500),
      title: shortText,
      summary: z.string().trim().min(1).max(5000),
      mergeSha: z.string().regex(/^[a-f0-9]{7,64}$/i).optional(),
      mergedAt: z.iso.datetime().optional(),
      decisions: notes,
      followUps: notes,
      idempotencyKey: z.string().min(8).max(200),
    }),
  }, async (input) => { try { return result(database.recordPrUpdate(input, actor)); } catch (error) { return failure(error); } });

  server.registerTool('pr_message_amend', {
    title: 'Amend PR message',
    description: 'Correct a journal message while preserving an audit record of the previous value.',
    inputSchema: z.object({
      messageId: z.uuid(),
      summary: z.string().trim().min(1).max(5000),
      decisions: notes,
      followUps: notes,
      reason: z.string().trim().min(3).max(500),
    }),
  }, async ({ messageId, summary, decisions, followUps, reason }) => {
    try { return result(database.amendMessage(messageId, summary, decisions, followUps, reason, actor)); } catch (error) { return failure(error); }
  });

  server.registerTool('project_journal_get', {
    title: 'Get project journal',
    description: 'Read recent project journal entries with optional repository and actor filters.',
    inputSchema: z.object({
      projectSlug: slug,
      limit: z.number().int().min(1).max(200).default(50),
      repository: z.string().min(3).max(300).optional(),
      actor: z.enum(['codex', 'claude', 'human']).optional(),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ projectSlug, limit, repository, actor: actorFilter }) => {
    try { return result(database.getJournal(projectSlug, limit, repository, actorFilter)); } catch (error) { return failure(error); }
  });

  return server;
}
