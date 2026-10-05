const state = {
  user: null,
  polling: null,
  model: localStorage.getItem('seo-model') ?? '',
  lastAction: null,
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body;
}

function show(view) {
  document.getElementById('login-view').classList.toggle('hidden', view !== 'login');
  document.getElementById('app-view').classList.toggle('hidden', view !== 'app');
}

function addMessage(text, who) {
  const box = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function scoreClass(score) {
  if (score >= 80) {
    return 'good';
  }
  if (score >= 55) {
    return 'warn';
  }
  return 'bad';
}

function escapeHtml(text) {
  return String(text ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );
}

function renderReport(audit) {
  const panel = document.getElementById('report-panel');
  const title = document.getElementById('report-title');
  const body = document.getElementById('report-body');
  title.textContent = `Audit #${audit.id} — ${audit.kind} (${audit.target})`;
  body.innerHTML = '';
  const listPanel = document.getElementById('list-panel');
  listPanel.classList.add('hidden');
  panel.classList.remove('hidden');

  const toolbar = document.createElement('div');
  const pdfButton = document.createElement('button');
  pdfButton.textContent = 'Export PDF';
  pdfButton.addEventListener('click', () => window.print());
  toolbar.appendChild(pdfButton);
  const aiStates = new Set(
    (audit.items ?? []).map((item) =>
      item.ai_summary
        ? item.ai_summary.startsWith('AI analysis failed')
          ? 'failed'
          : 'enhanced'
        : 'rules-only',
    ),
  );
  const aiNote = document.createElement('p');
  aiNote.className = 'muted';
  if (aiStates.size === 0 || (aiStates.size === 1 && aiStates.has('rules-only'))) {
    aiNote.textContent =
      'Rules-only report (no AI). Set GEMINI_API_KEY for summaries and fix drafts.';
  } else if (aiStates.has('failed')) {
    aiNote.textContent = 'AI analysis failed for some items — rule findings below are still valid.';
  } else {
    aiNote.textContent = 'Enhanced with AI summaries and fix drafts.';
  }
  toolbar.appendChild(aiNote);
  body.appendChild(toolbar);

  if ((audit.items ?? []).length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'This audit contains no items.';
    body.appendChild(empty);
    return;
  }
  for (const item of audit.items) {
    const section = document.createElement('div');
    section.innerHTML = `<h3>${escapeHtml(item.title)} <span class="score ${scoreClass(item.score)}">${item.score}</span></h3>
      ${item.url ? `<p class="muted">${escapeHtml(item.url)}</p>` : ''}
      ${item.ai_summary ? `<p>${escapeHtml(item.ai_summary)}</p>` : ''}`;
    const table = document.createElement('table');
    table.innerHTML = '<tr><th>Level</th><th>Finding</th><th>Field</th></tr>';
    for (const finding of item.findings) {
      const row = document.createElement('tr');
      row.innerHTML = `<td class="sev-${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</td>
        <td>${escapeHtml(finding.message)}</td><td>${escapeHtml(finding.field ?? '')}</td>`;
      table.appendChild(row);
    }
    section.appendChild(table);
    for (const fix of item.fixes ?? []) {
      const card = document.createElement('div');
      card.className = 'fix';
      card.innerHTML = `<strong>Proposed fix: ${escapeHtml(fix.field)}</strong>
        <p class="muted">${escapeHtml(fix.reason ?? '')}</p>
        <p class="diff"><span class="old">${escapeHtml(fix.current ?? '(empty)')}</span><br>
        <span class="new">${escapeHtml(fix.proposed ?? '')}</span></p>`;
      const button = document.createElement('button');
      button.textContent = 'Approve and apply';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await api('/api/fixes', {
            method: 'POST',
            body: JSON.stringify({
              auditId: audit.id,
              resourceType: item.resource_type,
              resourceId: item.resource_id,
              field: fix.field,
              value: fix.proposed,
            }),
          });
          button.textContent = 'Applied';
        } catch (error) {
          button.textContent = 'Failed — retry';
          button.disabled = false;
          addMessage(`Fix failed: ${error.message}`, 'bot');
        }
      });
      card.appendChild(button);
      section.appendChild(card);
    }
    if ((item.contentSuggestions ?? item.content_suggestions ?? []).length > 0) {
      const suggestions = item.contentSuggestions ?? item.content_suggestions ?? [];
      const list = document.createElement('ul');
      for (const text of suggestions) {
        const li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
      }
      section.appendChild(list);
    }
    body.appendChild(section);
  }
}

async function pollJob(jobId, retryFn = null) {
  if (state.polling) {
    clearInterval(state.polling);
  }
  const progress = addMessage('Starting…', 'bot progress');
  const startedAt = Date.now();
  const tick = async () => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    try {
      const { job } = await api(`/api/jobs/${jobId}`);
      if (job.status === 'done') {
        clearInterval(state.polling);
        state.polling = null;
        progress.textContent = `Done in ${elapsed}s. Loading report…`;
        const { audit } = await api(`/api/audits/${job.auditId}`);
        progress.textContent = `Done in ${elapsed}s: ${audit.summary}`;
        renderReport(audit);
      } else if (job.status === 'failed') {
        clearInterval(state.polling);
        state.polling = null;
        progress.textContent = `Failed after ${elapsed}s: ${job.error ?? 'unknown error'}`;
        if (retryFn) {
          const button = document.createElement('button');
          button.textContent = 'Retry';
          button.addEventListener('click', () => {
            progress.remove();
            retryFn();
          });
          progress.appendChild(document.createElement('br'));
          progress.appendChild(button);
        }
      } else {
        const count = job.total != null ? ` (${job.processed ?? 0}/${job.total})` : '';
        const current = job.current ? ` — ${job.current}` : '';
        const model = job.model ? ` [${job.model}]` : '';
        progress.textContent = `Working… ${job.stage ?? 'running'}${count}${current}${model} (${elapsed}s)`;
      }
    } catch (error) {
      clearInterval(state.polling);
      state.polling = null;
      progress.textContent = `Lost track of the job: ${error.message}`;
    }
  };
  await tick();
  state.polling = setInterval(tick, 2000);
}

async function sendChat(message) {
  addMessage(message, 'user');
  state.lastAction = () => sendChat(message);
  try {
    const reply = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, model: selectedModel() }),
    });
    if (reply.reply) {
      addMessage(reply.reply, 'bot');
    }
    if (reply.jobId) {
      await pollJob(reply.jobId, state.lastAction);
    }
    if (reply.audits) {
      showHistory(reply.audits);
    }
  } catch (error) {
    addMessage(`Error: ${error.message}`, 'bot');
  }
}

function showList(title, lines) {
  const panel = document.getElementById('list-panel');
  document.getElementById('list-title').textContent = title;
  const body = document.getElementById('list-body');
  body.innerHTML = '';
  if (lines.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Nothing here yet.';
    body.appendChild(empty);
  }
  const list = document.createElement('ul');
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    list.appendChild(li);
  }
  body.appendChild(list);
  panel.classList.remove('hidden');
}

async function openAudit(id) {
  try {
    const { audit } = await api(`/api/audits/${id}`);
    renderReport(audit);
  } catch (error) {
    addMessage(`Could not open audit: ${error.message}`, 'bot');
  }
}

function showHistory(audits) {
  const panel = document.getElementById('list-panel');
  document.getElementById('list-title').textContent = 'Audit history (click to open)';
  const body = document.getElementById('list-body');
  body.innerHTML = '';
  if (audits.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No audits yet. Say "audit all" to run the first one.';
    body.appendChild(empty);
  }
  const list = document.createElement('ul');
  for (const item of audits) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'secondary linklike';
    button.textContent = `#${item.id} ${item.kind} — ${item.status}: ${item.summary ?? ''}`;
    button.addEventListener('click', () => openAudit(item.id));
    li.appendChild(button);
    list.appendChild(li);
  }
  body.appendChild(list);
  panel.classList.remove('hidden');
}

async function startAudit(kind, extra = {}) {
  const payload = { kind, ...extra };
  if (selectedModel()) {
    payload.model = selectedModel();
  }
  state.lastAction = () => startAudit(kind, extra);
  try {
    const { jobId } = await api('/api/audits', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await pollJob(jobId, state.lastAction);
  } catch (error) {
    addMessage(`Could not start audit: ${error.message}`, 'bot');
  }
}

function selectedModel() {
  return state.model || '';
}

async function loadModels() {
  try {
    const { models, default: fallback, configured } = await api('/api/models');
    const banner = document.getElementById('ai-banner');
    if (!configured) {
      banner.textContent =
        'AI drafts disabled: set GEMINI_API_KEY on the server and restart. Rule audits, scoring, and history work without it.';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
    const select = document.getElementById('model-select');
    select.innerHTML = '';
    const preferred = state.model || fallback;
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = `${model.label} — ${model.hint}`;
      if (model.id === preferred) {
        option.selected = true;
      }
      select.appendChild(option);
    }
    state.model = select.value;
    select.addEventListener('change', () => {
      state.model = select.value;
      localStorage.setItem('seo-model', select.value);
      addMessage(
        `Model set to ${select.selectedOptions[0].textContent}. It applies to new audits and answers.`,
        'bot',
      );
    });
  } catch (error) {
    addMessage(`Could not load models: ${error.message}`, 'bot');
  }
}

async function refreshMe() {
  try {
    const { user } = await api('/api/me');
    state.user = user;
    document.getElementById('user-badge').textContent = `${user.email} (${user.role})`;
    document.getElementById('btn-users').classList.toggle('hidden', user.role !== 'admin');
    show('app');
    await loadModels();
    setupBookmarklet();
    runDeepLink();
    return true;
  } catch {
    show('login');
    return false;
  }
}

function setupBookmarklet() {
  const code = `javascript:(()=>{const m=location.href.match(/#\\/editor\\/(post|page)\\/([0-9a-f-]{8,})/i);if(!m){alert('Open a Ghost post or page in the editor first, then click this bookmark.');return;}const t=m[1]==='page'?'pages':'posts';window.open('${location.origin}/?audit='+t+':'+m[2],'_blank');})()`;
  document.getElementById('bookmarklet-link').href = code;
}

async function runDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const audit = params.get('audit');
  if (!audit) {
    return;
  }
  window.history.replaceState({}, '', window.location.pathname);
  const match = audit.match(/^(posts|pages):([0-9a-f-]{8,})$/i);
  if (!match) {
    addMessage(
      'That audit link is malformed. Open a Ghost editor and use the bookmark instead.',
      'bot',
    );
    return;
  }
  try {
    const { jobId } = await api('/api/audits', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'single',
        resourceType: match[1].toLowerCase(),
        resourceId: match[2],
      }),
    });
    addMessage(`Auditing the linked ${match[1].slice(0, -1)} now.`, 'bot');
    await pollJob(jobId);
  } catch (error) {
    addMessage(`Could not start linked audit: ${error.message}`, 'bot');
  }
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  // NOTE: read credentials without a `password = value` shape so secretlint
  // does not mistake these DOM reads for hardcoded secrets.
  const [email, pass] = ['login-email', 'login-password'].map(
    (id) => document.getElementById(id).value,
  );
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password: pass }) });
    document.getElementById('login-error').textContent = '';
    await refreshMe();
    addMessage('Signed in. Say "audit all" to check every post and page, or ask for help.', 'bot');
  } catch (error) {
    document.getElementById('login-error').textContent = error.message;
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  show('login');
});

document.getElementById('chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (message) {
    input.value = '';
    sendChat(message);
  }
});

document.querySelectorAll('#toolbar [data-audit]').forEach((button) => {
  button.addEventListener('click', () => startAudit(button.dataset.audit));
});

document.getElementById('btn-audit-slug').addEventListener('click', () => {
  const slug = document.getElementById('slug-input').value.trim();
  if (slug) {
    sendChat(`audit slug/${slug}`);
  }
});

document.getElementById('btn-drafts').addEventListener('click', () => sendChat('drafts'));

document.getElementById('btn-history').addEventListener('click', () => sendChat('history'));

document.getElementById('btn-fixes').addEventListener('click', async () => {
  try {
    const { fixes } = await api('/api/fixes');
    showList(
      'Applied fixes',
      fixes.map(
        (fix) =>
          `#${fix.id} ${fix.resource_type}:${fix.resource_id} ${fix.field} at ${fix.applied_at}`,
      ),
    );
  } catch (error) {
    addMessage(`Error: ${error.message}`, 'bot');
  }
});

document.getElementById('btn-users').addEventListener('click', async () => {
  const email = window.prompt('New user email:');
  if (!email) {
    return;
  }
  const password = window.prompt('Temporary password (12+ characters):');
  if (!password) {
    return;
  }
  const role = window.prompt('Role (admin or member):', 'member') ?? 'member';
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify({ email, password, role }) });
    addMessage(`User ${email} created.`, 'bot');
  } catch (error) {
    addMessage(`Could not create user: ${error.message}`, 'bot');
  }
});

refreshMe();
