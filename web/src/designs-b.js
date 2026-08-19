import './designs-b.css';

// Shared sample data for design studies 04–06. Mirrors the MergeLog domain:
// append-only PR threads carrying attributed messages from Codex, Claude and humans.
export const threads = [
  {
    pr: '#184', repo: 'turtlez/mergelog', title: 'Add idempotent journal writes',
    actor: 'Codex', time: 'Today, 10:42', sha: '4f8a1c2', kind: 'decision', notes: 4,
    summary: 'Client-scoped idempotency keys mean a retried update returns the original result instead of appending a duplicate note.',
    followups: ['Document key lifetime in the API reference'],
  },
  {
    pr: '#181', repo: 'turtlez/mergelog', title: 'Harden SQLite durability settings',
    actor: 'Claude', time: 'Yesterday, 16:08', sha: '9bd70e4', kind: 'storage', notes: 6,
    summary: 'WAL, foreign keys and a five-second busy timeout. Live state stays node-local; validated snapshots move off to NFS hourly.',
    followups: ['Assert restore path in the backup verifier'],
  },
  {
    pr: '#176', repo: 'turtlez/infra', title: 'Pin journal service to storage node',
    actor: 'Human', time: 'Aug 16, 09:31', sha: 'ca8d304', kind: 'swarm', notes: 3,
    summary: 'Deployment follows the SQLite durability boundary. Transparent relocation stays explicitly out of scope for the MVP.',
    followups: [],
  },
  {
    pr: '#171', repo: 'turtlez/mergelog', title: 'Markdown projection for each thread',
    actor: 'Codex', time: 'Aug 14, 13:55', sha: '2e19f7b', kind: 'export', notes: 5,
    summary: 'Every thread renders to a stable Markdown file so the journal stays readable without the service running.',
    followups: ['Decide on front-matter schema'],
  },
];

const avatar = (a) => `<span class="avatar avatar-${a.toLowerCase()}">${a === 'Human' ? 'TW' : a[0]}</span>`;

/* ── 04 · Strata ─────────────────────────────────────────────────────────
   Deep indigo slate. A quiet reading surface: repo rail on the left,
   wide stacked strata of merges, coral used only where it means something. */
export function designFour(nav, data) {
  const live = Boolean(data);
  const journal = data?.journal;
  const rawEntries = journal?.entries ?? threads.map((thread) => ({
    repository: thread.repo, prNumber: Number(thread.pr.slice(1)), prUrl: '#', title: thread.title,
    mergeSha: thread.sha, mergedAt: null, mergeStatus: 'reported',
    message: { actor: thread.actor.toLowerCase(), summary: thread.summary, decisions: [thread.kind], followUps: thread.followups, createdAt: new Date().toISOString() },
  }));
  const grouped = new Map();
  for (const entry of rawEntries) {
    const key = `${entry.repository}#${entry.prNumber}`;
    const current = grouped.get(key) ?? { ...entry, messages: [] };
    current.messages.push(entry.message);
    grouped.set(key, current);
  }
  const displayThreads = [...grouped.values()];
  const repositories = [...new Set((journal?.project?.repositories ?? data?.projects?.flatMap((p) => p.repositories) ?? displayThreads.map((t) => t.repository)))];
  const repos = repositories.map((repo, index) => [repo, displayThreads.filter((t) => t.repository === repo).length, index === 0]);
  const actorCounts = { codex: 0, claude: 0, human: 0 };
  rawEntries.forEach((entry) => { if (entry.message.actor in actorCounts) actorCounts[entry.message.actor] += 1; });
  const latest = rawEntries[0]?.message?.createdAt;
  const dateLabel = latest ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(latest)) : 'All history';
  const when = (value) => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'Reported';
  const actorName = (value) => value.charAt(0).toUpperCase() + value.slice(1);
  return `<main class="design design-four">${nav}
  <div class="strata-shell">
    <aside class="strata-rail">
      <div class="rail-block">
        <span class="rail-label">REPOSITORIES</span>
        <ul class="repo-list">${repos.map(([r, n, on]) => `<li class="${on ? 'on' : ''}"><span>${r}</span><b>${n}</b></li>`).join('') || '<li class="on"><span>No repositories</span><b>0</b></li>'}</ul>
      </div>
      <div class="rail-block">
        <span class="rail-label">ATTRIBUTED TO</span>
        <ul class="actor-list">
          <li>${avatar('Codex')}<span>Codex</span><b>${live ? actorCounts.codex : 14}</b></li>
          <li>${avatar('Claude')}<span>Claude</span><b>${live ? actorCounts.claude : 7}</b></li>
          <li>${avatar('Human')}<span>Humans</span><b>${live ? actorCounts.human : 3}</b></li>
        </ul>
      </div>
      <div class="rail-block rail-health">
        <span class="rail-label">DURABILITY</span>
        <div class="health-row"><i class="ok"></i>SQLite · WAL</div>
        <div class="health-row"><i class="ok"></i>Snapshot 09:00</div>
        <div class="health-row"><i class="warn"></i>1 follow-up open</div>
      </div>
    </aside>
    <section class="strata-main">
      <header class="strata-head">
        <div>
          <span class="rail-label">PROJECT JOURNAL</span>
          <h1>Merged work, <em>kept in context.</em></h1>
        </div>
        <div class="strata-actions">
          <button class="ghost">${dateLabel} ⌄</button>
          <button class="coral">Export Markdown ↓</button>
        </div>
      </header>
      <div class="strata-list">
        ${displayThreads.map((t, i) => { const message = t.messages[0]; const stamp = live ? when(message.createdAt).split(', ') : threads[i]?.time.split(','); const followUps = t.messages.flatMap((item) => item.followUps ?? []); const decisions = t.messages.flatMap((item) => item.decisions ?? []); const actor = actorName(message.actor); return `<article class="stratum">
          <div class="stratum-when"><b>${live ? stamp[0] : stamp[0]}</b><small>${live ? (stamp[1] ?? '') : (stamp[1] || '').trim()}</small></div>
          <div class="stratum-edge"></div>
          <div class="stratum-body">
            <div class="stratum-meta"><code>${t.repository}</code><a class="pr" href="${t.prUrl}" target="_blank" rel="noreferrer">#${t.prNumber}</a>${decisions[0] ? `<span class="chip chip-decision">decision</span>` : ''}<span class="merged">${t.mergeStatus === 'reported' ? 'reported merged' : t.mergeStatus}</span></div>
            <h2>${t.title}</h2>
            <p>${message.summary}</p>
            ${decisions.map((item) => `<div class="decision">DECISION · ${item}</div>`).join('')}
            ${followUps.map((item) => `<div class="followup">FOLLOW-UP · ${item}</div>`).join('')}
            <div class="stratum-foot">${avatar(actor)}<strong>${actor}</strong><span>${t.messages.length} ${t.messages.length === 1 ? 'note' : 'notes'} on thread</span><span class="sha">${t.mergeSha ?? 'SHA pending'}</span></div>
          </div>
          <div class="stratum-index">${String(displayThreads.length - i).padStart(2, '0')}</div>
        </article>` }).join('') || '<div class="empty-journal"><h2>No journal entries yet.</h2><p>The first recorded pull request will appear here.</p></div>'}
      </div>
    </section>
  </div></main>`;
}

/* ── 05 · Ledger ─────────────────────────────────────────────────────────
   Warm charcoal-green. Split view: an index of threads on the left, the
   selected thread read as a conversation on the right. */
export function designFive(nav) {
  const messages = [
    { who: 'Codex', time: '10:42', role: 'SUMMARY', body: 'Writes now carry a client-scoped idempotency key. A replay of the same key returns the stored result verbatim rather than appending a second note to the thread.' },
    { who: 'Claude', time: '11:07', role: 'DECISION', body: 'Keys expire after 24h. Longer retention would make the table the largest thing in the database for no recall benefit.' },
    { who: 'Human', time: '11:20', role: 'NOTE', body: 'Agreed. Anything older than a day is a new intent, not a retry.' },
    { who: 'Codex', time: '11:44', role: 'FOLLOW-UP', body: 'Document key lifetime in the API reference before this ships to the LAN timeline.', open: true },
  ];
  return `<main class="design design-five">${nav}
  <div class="ledger-shell">
    <section class="ledger-index">
      <header class="ledger-index-head">
        <div><b>JOURNAL</b><span>4 threads · August</span></div>
        <button class="round-ghost" aria-label="Filter">⌕</button>
      </header>
      <div class="ledger-filters"><button class="on">All</button><button>Decisions</button><button>Open</button></div>
      ${threads.map((t, i) => `<button class="ledger-item ${i === 0 ? 'active' : ''}">
        <div class="li-top"><span class="pr">${t.pr}</span><span>${t.repo.split('/')[1]}</span><small>${t.time.split(',')[0]}</small></div>
        <strong>${t.title}</strong>
        <div class="li-foot">${avatar(t.actor)}<span>${t.notes} notes</span>${t.followups.length ? '<i class="open-dot"></i>' : ''}</div>
      </button>`).join('')}
    </section>
    <section class="ledger-thread">
      <header class="thread-head">
        <div class="thread-crumbs"><code>github</code>›<code>turtlez/mergelog</code>›<code>#184</code></div>
        <h1>Add idempotent journal writes</h1>
        <div class="thread-facts">
          <div><span>MERGED</span><b>19 Aug 2026 · 10:41 AEST</b></div>
          <div><span>COMMIT</span><b>4f8a1c2</b></div>
          <div><span>THREAD</span><b>append-only · 4 messages</b></div>
          <div><span>STATE</span><b class="open">1 follow-up open</b></div>
        </div>
      </header>
      <div class="thread-body">
        ${messages.map((m) => `<article class="msg ${m.open ? 'msg-open' : ''}">
          <div class="msg-rail">${avatar(m.who)}<span class="msg-line"></span></div>
          <div class="msg-card">
            <div class="msg-meta"><strong>${m.who}</strong><span class="role role-${m.role.toLowerCase().replace('-', '')}">${m.role}</span><time>${m.time}</time></div>
            <p>${m.body}</p>
          </div>
        </article>`).join('')}
        <div class="thread-end">END OF THREAD · APPEND-ONLY · AMENDMENTS AUDITED</div>
      </div>
    </section>
  </div></main>`;
}

/* ── 06 · Constellation ──────────────────────────────────────────────────
   Deep aubergine. A denser operations view: stat tiles up top, then the
   journal split into agent lanes so attribution reads at a glance. */
export function designSix(nav) {
  const lanes = [
    ['Codex', ['Add idempotent journal writes', 'Markdown projection for each thread', 'Normalise repository identity']],
    ['Claude', ['Harden SQLite durability settings', 'Bearer-token write auth']],
    ['Human', ['Pin journal service to storage node']],
  ];
  const stats = [['24', 'merges captured', '+6 this week'], ['31', 'attributed notes', 'across 4 repos'], ['6', 'decisions retained', 'exported to MD'], ['1', 'follow-up open', 'needs an owner']];
  return `<main class="design design-six">${nav}
  <div class="const-shell">
    <header class="const-head">
      <div>
        <span class="const-eyebrow">MERGELOG · READ-ONLY LAN TIMELINE</span>
        <h1>Project memory,<br><span>at a glance.</span></h1>
      </div>
      <div class="const-status">
        <div class="status-card"><i class="live"></i>SERVICE HEALTHY<small>single replica · storage node</small></div>
        <div class="status-card"><i class="sync"></i>BACKUP VALIDATED<small>hourly · NFS · 09:00 AEST</small></div>
      </div>
    </header>
    <section class="const-stats">
      ${stats.map(([n, l, s]) => `<div class="stat-tile"><strong>${n}</strong><span>${l}</span><small>${s}</small></div>`).join('')}
    </section>
    <section class="const-board">
      <div class="board-head"><b>BY AUTHOR</b><div class="board-tabs"><button class="on">Lanes</button><button>Timeline</button><button>Table</button></div></div>
      <div class="lanes">
        ${lanes.map(([who, items]) => `<div class="lane lane-${who.toLowerCase()}">
          <header>${avatar(who)}<strong>${who}</strong><b>${items.length}</b></header>
          ${items.map((title, i) => `<article class="lane-card">
            <div class="lc-top"><span>${threads[i] ? threads[i].repo : 'turtlez/mergelog'}</span><code>#${184 - i * 3}</code></div>
            <h3>${title}</h3>
            <div class="lc-foot"><span class="dot"></span>merged<span class="lc-sha">${(threads[i] || threads[0]).sha}</span></div>
          </article>`).join('')}
        </div>`).join('')}
      </div>
    </section>
    <footer class="const-foot"><span>SQLITE AUTHORITATIVE</span><span>MARKDOWN + TIMELINE ARE PROJECTIONS</span><span>MERGELOG v0.1</span></footer>
  </div></main>`;
}
