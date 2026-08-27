import type { Agent } from './config.js';
import type { ProjectInput, PrUpdateInput } from './database.js';

export interface JournalStore {
  createProject(input: ProjectInput, actor: Agent): object | Promise<object>;
  listProjects(): object[] | Promise<object[]>;
  recordPrUpdate(input: PrUpdateInput, actor: Agent): object | Promise<object>;
  amendMessage(messageId: string, summary: string, decisions: string[], followUps: string[], reason: string, actor: Agent): object | Promise<object>;
  getJournal(projectSlug: string, limit: number, repository?: string, actor?: Agent): object | Promise<object>;
}
