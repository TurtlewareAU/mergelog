import './styles.css';
import { designFour } from './designs-b.js';

const app = document.querySelector('#app');

function appNav() {
  return `<nav class="gallery-nav app-nav" aria-label="Primary navigation">
    <a class="gallery-brand" href="/">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>MergeLog</span>
    </a>
    <span class="app-nav-title">PROJECT JOURNAL</span>
    <span class="prototype-pill"><i class="app-live"></i> READ-ONLY</span>
  </nav>`;
}

function statusView(title, detail) {
  return `<main class="design design-four">${appNav()}<section class="app-status">
    <span class="rail-label">MERGELOG</span><h1>${title}</h1><p>${detail}</p>
  </section></main>`;
}

async function loadJournal() {
  app.innerHTML = statusView('Loading the journal…', 'Reading the latest project history from SQLite.');
  try {
    const projectsResponse = await fetch('/api/projects');
    if (!projectsResponse.ok) throw new Error(`Projects request returned ${projectsResponse.status}`);
    const { projects } = await projectsResponse.json();
    if (!projects.length) {
      app.innerHTML = statusView('No projects recorded yet.', 'Create a project through the MergeLog MCP tools and its history will appear here.');
      return;
    }

    const requested = new URLSearchParams(location.search).get('project');
    const project = projects.find((item) => item.slug === requested) ?? projects[0];
    const journalResponse = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/journal?limit=100`);
    if (!journalResponse.ok) throw new Error(`Journal request returned ${journalResponse.status}`);
    const journal = await journalResponse.json();
    app.innerHTML = designFour(appNav(), { projects, journal });
  } catch (error) {
    console.error(error);
    app.innerHTML = statusView('The journal is unavailable.', 'The read service could not be reached. Check that the MergeLog server is running, then refresh this page.');
  }
}

loadJournal();
