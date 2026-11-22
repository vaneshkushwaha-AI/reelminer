/* ============================================================
   ReelMiner — Application Logic
   ============================================================ */

// ─── CONFIG ──────────────────────────────────────────────────
const CFG = {
  GEMINI_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
  CORS_PROXIES: [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`
  ],
  STORE: {
    KEY:     'reelminer_apikey',
    GOAL:    'reelminer_goal',
    HISTORY: 'reelminer_history'
  },
  MAX_REELS: 5
};

// ─── STATE ───────────────────────────────────────────────────
let currentVideoId = '';
let currentReels   = [];
let pendingGoal    = '';
let pendingDurations = [];

// ─── UTILS ───────────────────────────────────────────────────

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function extractVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
    if (u.searchParams.has('v'))          return u.searchParams.get('v');
    if (u.pathname.includes('/embed/'))   return u.pathname.split('/embed/')[1].split(/[?/]/)[0];
    if (u.pathname.includes('/shorts/'))  return u.pathname.split('/shorts/')[1].split(/[?/]/)[0];
  } catch { /* ignore */ }
  const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function fmtTime(sec) {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function decodeHTMLEntities(text) {
  const ta = document.createElement('textarea');
  ta.innerHTML = text;
  return ta.value;
}

function scoreClass(val) {
  if (val >= 7) return 'score__fill--high';
  if (val >= 4) return 'score__fill--mid';
  return 'score__fill--low';
}

// ─── NOTIFICATIONS ──────────────────────────────────────────

function toast(msg, type = 'info') {
  const container = $('#notifications');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span>${msg}</span><button class="toast__close" onclick="this.parentElement.remove()">&times;</button>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 5500);
}

// ─── SECTION VISIBILITY ────────────────────────────────────

function showSection(name) {
  ['input', 'loading', 'manual', 'results'].forEach(s => {
    const el = $(`#section-${s}`);
    if (el) el.classList.toggle('hidden', s !== name);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setStep(id, state) {
  const el = $(`#${id}`);
  if (!el) return;
  el.className = 'step' + (state ? ` step--${state}` : '');
}

// ─── MODAL HELPERS ──────────────────────────────────────────

function openModal(id)  { $(`#${id}`).classList.add('open'); }
function closeModal(id) { $(`#${id}`).classList.remove('open'); }

// ─── TRANSCRIPT EXTRACTION ─────────────────────────────────

async function fetchViaProxy(url) {
  for (const mkProxy of CFG.CORS_PROXIES) {
    try {
      const r = await fetch(mkProxy(url));
      if (r.ok) return await r.text();
    } catch { /* try next */ }
  }
  throw new Error('proxy_fail');
}

function extractCaptionTracks(html) {
  const marker = '"captionTracks":';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const arrStart = html.indexOf('[', idx);
  if (arrStart === -1) return null;
  let depth = 0;
  for (let i = arrStart; i < html.length; i++) {
    if (html[i] === '[') depth++;
    if (html[i] === ']') depth--;
    if (depth === 0) {
      try { return JSON.parse(html.substring(arrStart, i + 1)); }
      catch { return null; }
    }
  }
  return null;
}

async function getTranscript(videoId) {
  // 1. Fetch video page via proxy
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetchViaProxy(pageUrl);

  // 2. Extract caption tracks
  const tracks = extractCaptionTracks(html);
  if (!tracks || tracks.length === 0) throw new Error('no_captions');

  // 3. Pick best track (English preferred)
  const track =
    tracks.find(t => t.languageCode === 'en') ||
    tracks.find(t => t.languageCode?.startsWith('en')) ||
    tracks[0];

  // 4. Fetch caption XML
  let captionUrl = track.baseUrl.replace(/\\u0026/g, '&');
  if (!captionUrl.startsWith('http')) captionUrl = 'https://www.youtube.com' + captionUrl;
  const xml = await fetchViaProxy(captionUrl);

  // 5. Parse XML
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const nodes = doc.querySelectorAll('text');
  if (nodes.length === 0) throw new Error('empty_captions');

  return Array.from(nodes).map(n => ({
    start:    parseFloat(n.getAttribute('start') || '0'),
    duration: parseFloat(n.getAttribute('dur')   || '0'),
    text:     decodeHTMLEntities(n.textContent.trim())
  }));
}

function formatTranscriptForPrompt(segments) {
  return segments.map(s => `[${fmtTime(s.start)}] ${s.text}`).join('\n');
}

// ─── MANUAL TRANSCRIPT PARSER ───────────────────────────────

function parseManualTranscript(raw) {
  const lines = raw.trim().split('\n').filter(l => l.trim());
  const segments = [];
  for (const line of lines) {
    const m = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)/);
    if (m) {
      const parts = m[1].split(':').map(Number);
      const sec = parts.length === 3 ? parts[0]*3600 + parts[1]*60 + parts[2] : parts[0]*60 + parts[1];
      segments.push({ start: sec, duration: 0, text: m[2].trim() });
    } else {
      segments.push({ start: segments.length > 0 ? segments[segments.length-1].start : 0, duration: 0, text: line.trim() });
    }
  }
  return segments;
}

// ─── GEMINI API ─────────────────────────────────────────────

function buildPrompt(transcript, goal, durations) {
  return `You are an elite YouTube content strategist specialising in short-form viral content (YouTube Shorts, Instagram Reels, TikTok).

CHANNEL CONTEXT
• Channel Goal / Niche: "${goal}"

YOUR TASK
Analyse the transcript below and pick the TOP ${CFG.MAX_REELS} segments that would make the most viral, engaging short-form reels for this channel's audience.

SELECTION CRITERIA (ranked)
1. Hook Potential – does it open with an attention-grabbing moment in the first 3 seconds?
2. Standalone Value – will a viewer understand and enjoy it without the full video?
3. Emotional Trigger – curiosity, surprise, humour, inspiration, controversy?
4. Shareability – would viewers send this to a friend?
5. Relevance to "${goal}" – does it serve that specific audience?
6. TAM (Total Addressable Market) – how broad is the potential viewership for this clip?

PREFERRED DURATIONS: ${durations.join(', ')} seconds.
Try to vary the durations across the 5 reels if possible.

RESPOND WITH ONLY valid JSON — no markdown fences, no commentary outside the JSON.

Schema:
{
  "reels": [
    {
      "rank": 1,
      "title": "Catchy reel title",
      "hook": "Opening 3-second hook line",
      "start_time": "M:SS",
      "end_time": "M:SS",
      "start_seconds": 0,
      "end_seconds": 60,
      "duration_category": "60s",
      "script": "Full narration / spoken text for the reel",
      "virality_score": 9,
      "virality_reasoning": "Why this will go viral",
      "tam_score": 8,
      "tam_reasoning": "Audience reach explanation",
      "why_this_works": "Brief strategic reasoning",
      "suggested_caption": "Ready-to-post caption",
      "hashtags": ["#tag1","#tag2","#tag3","#tag4","#tag5"],
      "cta": "Call-to-action suggestion"
    }
  ]
}

RULES
• Use EXACT timestamps from the transcript.
• Each reel must be self-contained.
• Scores are integers 1-10.
• Return exactly ${CFG.MAX_REELS} reels sorted by combined virality+TAM.

TRANSCRIPT:
${transcript}`;
}

async function callGemini(prompt) {
  const apiKey = localStorage.getItem(CFG.STORE.KEY);
  if (!apiKey) throw new Error('No API key set');

  const res = await fetch(`${CFG.GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192
      }
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 400 && err?.error?.message?.includes('API key')) throw new Error('Invalid Gemini API key. Check Settings.');
    if (res.status === 429) throw new Error('Rate limit reached. Wait a minute and try again.');
    throw new Error(err?.error?.message || `Gemini API error (${res.status})`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

function parseGeminiJSON(raw) {
  // Attempt direct parse
  try { return JSON.parse(raw); } catch { /* continue */ }
  // Strip markdown fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) try { return JSON.parse(fenced[1]); } catch { /* continue */ }
  // Find outermost { ... }
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(raw.substring(start, end + 1)); } catch { /* continue */ }
  }
  throw new Error('Could not parse AI response as JSON. Please try again.');
}

// ─── RENDER RESULTS ──────────────────────────────────────────

function renderResults(reels, videoId) {
  const container = $('#reels-container');
  container.innerHTML = '';
  currentReels = reels;

  reels.forEach((reel, i) => {
    const card = document.createElement('div');
    card.className = 'reel-card glass-card';

    const startSec = reel.start_seconds || 0;
    const endSec   = reel.end_seconds   || startSec + 60;

    card.innerHTML = `
      <div class="reel-card__top">
        <div class="reel-card__rank">${reel.rank || i + 1}</div>
        <div class="reel-card__title-wrap">
          <div class="reel-card__name" title="${esc(reel.title)}">${esc(reel.title)}</div>
        </div>
        <span class="reel-card__dur">${esc(reel.duration_category || '60s')}</span>
      </div>

      <div class="reel-card__body">
        <!-- Left column -->
        <div>
          <div class="timestamp-badge">⏱️ ${esc(reel.start_time)} → ${esc(reel.end_time)}</div>

          <div class="scores">
            <div class="score">
              <div class="score__header"><span class="score__label">Virality</span><span class="score__value">${reel.virality_score}/10</span></div>
              <div class="score__bar"><div class="score__fill ${scoreClass(reel.virality_score)}" style="width:${reel.virality_score * 10}%"></div></div>
            </div>
            <div class="score">
              <div class="score__header"><span class="score__label">TAM</span><span class="score__value">${reel.tam_score}/10</span></div>
              <div class="score__bar"><div class="score__fill ${scoreClass(reel.tam_score)}" style="width:${reel.tam_score * 10}%"></div></div>
            </div>
          </div>

          <div class="reel-detail">
            <div class="reel-detail__label">🎣 Hook</div>
            <div class="reel-detail__text">${esc(reel.hook)}</div>
          </div>

          <div class="reel-detail">
            <div class="reel-detail__label">📝 Script</div>
            <div class="reel-detail__text">${esc(reel.script)}</div>
          </div>

          <div class="reel-detail">
            <div class="reel-detail__label">💡 Why This Works</div>
            <div class="reel-detail__text">${esc(reel.why_this_works)}</div>
          </div>

          <div class="reel-detail">
            <div class="reel-detail__label">📱 Caption</div>
            <div class="reel-detail__text">${esc(reel.suggested_caption)}</div>
          </div>

          <div class="reel-detail">
            <div class="reel-detail__label">📣 CTA</div>
            <div class="reel-detail__text">${esc(reel.cta)}</div>
          </div>

          <div class="reel-card__tags">
            ${(reel.hashtags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
          </div>
        </div>

        <!-- Right column: embed -->
        <div>
          <div class="reel-card__embed">
            <iframe
              src="https://www.youtube.com/embed/${videoId}?start=${startSec}&end=${endSec}&rel=0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen
              loading="lazy"
            ></iframe>
          </div>

          <div class="reel-detail" style="margin-top:14px">
            <div class="reel-detail__label">🔥 Virality Reasoning</div>
            <div class="reel-detail__text">${esc(reel.virality_reasoning)}</div>
          </div>
          <div class="reel-detail">
            <div class="reel-detail__label">🌍 TAM Reasoning</div>
            <div class="reel-detail__text">${esc(reel.tam_reasoning)}</div>
          </div>
        </div>
      </div>

      <div class="reel-card__actions">
        <button class="btn btn--secondary btn--sm" onclick="copyText('${esc(reel.start_time)} → ${esc(reel.end_time)}')">📋 Copy Timestamps</button>
        <button class="btn btn--secondary btn--sm" onclick="copyText(decodeURIComponent('${encodeURIComponent(reel.script)}'))">📋 Copy Script</button>
        <button class="btn btn--secondary btn--sm" onclick="copyText(decodeURIComponent('${encodeURIComponent(reel.suggested_caption + '\\n' + (reel.hashtags||[]).join(' '))}'))">📋 Copy Caption</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(
    () => toast('Copied to clipboard!', 'success'),
    () => toast('Copy failed — try manually', 'error')
  );
}

// ─── HISTORY ────────────────────────────────────────────────

function saveHistory(videoId, goal, reels) {
  const history = JSON.parse(localStorage.getItem(CFG.STORE.HISTORY) || '[]');
  history.unshift({
    videoId,
    goal,
    reels,
    date: new Date().toISOString()
  });
  if (history.length > 20) history.length = 20;
  localStorage.setItem(CFG.STORE.HISTORY, JSON.stringify(history));
}

function renderHistory() {
  const list = $('#history-list');
  const history = JSON.parse(localStorage.getItem(CFG.STORE.HISTORY) || '[]');
  if (history.length === 0) {
    list.innerHTML = '<p class="text-muted" style="padding:12px">No analyses yet.</p>';
    return;
  }
  list.innerHTML = history.map((h, i) => `
    <div class="history-item" data-idx="${i}">
      <img src="https://img.youtube.com/vi/${h.videoId}/mqdefault.jpg" alt="thumb">
      <div class="history-item__info">
        <div class="history-item__title">${esc(h.goal)}</div>
        <div class="history-item__date">${new Date(h.date).toLocaleDateString()} · ${h.reels.length} reels</div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      const h = history[idx];
      currentVideoId = h.videoId;
      renderResults(h.reels, h.videoId);
      $('#results-meta').textContent = `Channel goal: ${h.goal} · Analysed ${new Date(h.date).toLocaleDateString()}`;
      showSection('results');
      closeModal('history-modal');
    });
  });
}

// ─── EXPORT ──────────────────────────────────────────────────

function exportReport() {
  if (currentReels.length === 0) return toast('Nothing to export', 'error');

  let md = `# ReelMiner Report\n\n**Video:** https://youtube.com/watch?v=${currentVideoId}\n**Date:** ${new Date().toLocaleString()}\n\n---\n\n`;

  currentReels.forEach(r => {
    md += `## #${r.rank} — ${r.title}\n`;
    md += `- **Duration:** ${r.duration_category}\n`;
    md += `- **Timestamps:** ${r.start_time} → ${r.end_time}\n`;
    md += `- **Virality:** ${r.virality_score}/10 — ${r.virality_reasoning}\n`;
    md += `- **TAM:** ${r.tam_score}/10 — ${r.tam_reasoning}\n`;
    md += `- **Hook:** ${r.hook}\n`;
    md += `- **Script:** ${r.script}\n`;
    md += `- **Why it works:** ${r.why_this_works}\n`;
    md += `- **Caption:** ${r.suggested_caption}\n`;
    md += `- **Hashtags:** ${(r.hashtags||[]).join(' ')}\n`;
    md += `- **CTA:** ${r.cta}\n\n---\n\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reelminer-report-${currentVideoId}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Report downloaded!', 'success');
}

// ─── MAIN EXTRACT FLOW ──────────────────────────────────────

async function handleExtract() {
  const url  = $('#youtube-url').value.trim();
  const goal = $('#channel-goal').value.trim();
  const durs = Array.from($$('input[name="dur"]:checked')).map(c => c.value + 's');

  // Validate
  if (!url)             return toast('Please enter a YouTube URL', 'error');
  if (!goal)            return toast('Please enter your channel goal / niche', 'error');
  if (durs.length === 0) return toast('Select at least one reel duration', 'error');

  const videoId = extractVideoId(url);
  if (!videoId) return toast('Invalid YouTube URL — check the link and try again', 'error');

  const apiKey = localStorage.getItem(CFG.STORE.KEY);
  if (!apiKey) { openModal('settings-modal'); return toast('Please enter your Gemini API key first', 'error'); }

  currentVideoId   = videoId;
  pendingGoal      = goal;
  pendingDurations = durs;

  // Save goal for next time
  localStorage.setItem(CFG.STORE.GOAL, goal);

  // Show loading
  showSection('loading');
  setStep('step-transcript', 'active');
  setStep('step-analyze', '');
  setStep('step-render', '');

  try {
    // ── Step 1: Transcript ──
    let segments;
    try {
      segments = await getTranscript(videoId);
      setStep('step-transcript', 'done');
    } catch (err) {
      setStep('step-transcript', 'error');
      showSection('manual');
      if (err.message === 'no_captions') {
        toast('This video has no captions. Paste the transcript manually.', 'error');
      } else {
        toast('Auto-extraction failed. Paste the transcript manually.', 'error');
      }
      return;
    }

    // ── Step 2: Gemini ──
    setStep('step-analyze', 'active');
    const transcript = formatTranscriptForPrompt(segments);
    const prompt     = buildPrompt(transcript, goal, durs);
    const raw        = await callGemini(prompt);
    const parsed     = parseGeminiJSON(raw);
    const reels      = parsed.reels || [];
    if (reels.length === 0) throw new Error('AI returned no reels — try a different video.');
    setStep('step-analyze', 'done');

    // ── Step 3: Render ──
    setStep('step-render', 'active');
    renderResults(reels, videoId);
    setStep('step-render', 'done');

    // Save history
    saveHistory(videoId, goal, reels);

    // Show results
    setTimeout(() => {
      showSection('results');
      $('#results-meta').textContent = `Channel goal: ${goal}`;
    }, 400);

  } catch (err) {
    toast(err.message, 'error');
    showSection('input');
  }
}

// ─── MANUAL SUBMIT ───────────────────────────────────────────

async function handleManualSubmit() {
  const raw = $('#manual-transcript').value.trim();
  if (!raw) return toast('Paste the transcript first', 'error');
  if (raw.length < 50) return toast('Transcript seems too short — paste the full text', 'error');

  const apiKey = localStorage.getItem(CFG.STORE.KEY);
  if (!apiKey) { openModal('settings-modal'); return toast('Set your API key first', 'error'); }

  showSection('loading');
  setStep('step-transcript', 'done');
  setStep('step-analyze', 'active');
  setStep('step-render', '');

  try {
    const segments   = parseManualTranscript(raw);
    const transcript = formatTranscriptForPrompt(segments);
    const prompt     = buildPrompt(transcript, pendingGoal, pendingDurations);
    const rawResp    = await callGemini(prompt);
    const parsed     = parseGeminiJSON(rawResp);
    const reels      = parsed.reels || [];
    if (reels.length === 0) throw new Error('AI returned no reels — try a different video.');
    setStep('step-analyze', 'done');

    setStep('step-render', 'active');
    renderResults(reels, currentVideoId);
    setStep('step-render', 'done');

    saveHistory(currentVideoId, pendingGoal, reels);

    setTimeout(() => {
      showSection('results');
      $('#results-meta').textContent = `Channel goal: ${pendingGoal}`;
    }, 400);

  } catch (err) {
    toast(err.message, 'error');
    showSection('manual');
  }
}

// ─── INIT ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // ─ API key management ─
  const savedKey = localStorage.getItem(CFG.STORE.KEY);
  if (savedKey) {
    $('#api-banner').classList.add('hidden');
  }

  $('#settings-btn').addEventListener('click', () => {
    $('#api-key-input').value = localStorage.getItem(CFG.STORE.KEY) || '';
    openModal('settings-modal');
  });
  $('#settings-close').addEventListener('click', () => closeModal('settings-modal'));
  $('#settings-modal .modal__backdrop').addEventListener('click', () => closeModal('settings-modal'));

  $('#save-settings').addEventListener('click', () => {
    const key = $('#api-key-input').value.trim();
    if (!key) return toast('Please enter a valid API key', 'error');
    localStorage.setItem(CFG.STORE.KEY, key);
    $('#api-banner').classList.add('hidden');
    closeModal('settings-modal');
    toast('API key saved!', 'success');
  });

  $('#toggle-key-vis').addEventListener('click', () => {
    const inp = $('#api-key-input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  $('#api-banner-btn').addEventListener('click', () => {
    openModal('settings-modal');
  });

  // ─ History modal ─
  $('#history-btn').addEventListener('click', () => { renderHistory(); openModal('history-modal'); });
  $('#history-close').addEventListener('click', () => closeModal('history-modal'));
  $('#history-modal .modal__backdrop').addEventListener('click', () => closeModal('history-modal'));

  // ─ Restore saved goal ─
  const savedGoal = localStorage.getItem(CFG.STORE.GOAL);
  if (savedGoal) $('#channel-goal').value = savedGoal;

  // ─ Duration chips toggle ─
  $$('.chip input').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('.chip').classList.toggle('chip--active', cb.checked);
      updateExtractBtn();
    });
  });

  // ─ YouTube URL preview ─
  let urlDebounce;
  $('#youtube-url').addEventListener('input', () => {
    clearTimeout(urlDebounce);
    urlDebounce = setTimeout(() => {
      const id = extractVideoId($('#youtube-url').value);
      const preview = $('#video-preview');
      if (id) {
        $('#video-thumb').src = `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
        $('#video-title').textContent = `Video ID: ${id}`;
        preview.classList.remove('hidden');
      } else {
        preview.classList.add('hidden');
      }
      updateExtractBtn();
    }, 350);
  });

  // ─ Enable / disable extract button ─
  function updateExtractBtn() {
    const hasUrl  = !!extractVideoId($('#youtube-url').value);
    const hasGoal = !!$('#channel-goal').value.trim();
    const hasDur  = $$('input[name="dur"]:checked').length > 0;
    $('#extract-btn').disabled = !(hasUrl && hasGoal && hasDur);
  }
  $('#channel-goal').addEventListener('input', updateExtractBtn);
  updateExtractBtn();

  // ─ Extract button ─
  $('#extract-btn').addEventListener('click', handleExtract);

  // ─ Manual section ─
  $('#manual-submit').addEventListener('click', handleManualSubmit);
  $('#manual-back').addEventListener('click', () => showSection('input'));

  // ─ Results actions ─
  $('#export-btn').addEventListener('click', exportReport);
  $('#new-btn').addEventListener('click', () => {
    showSection('input');
    $('#youtube-url').value = '';
    $('#video-preview').classList.add('hidden');
    updateExtractBtn();
  });

  // ─ Keyboard shortcut (Enter = submit) ─
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !$('#section-input').classList.contains('hidden')) {
      const btn = $('#extract-btn');
      if (!btn.disabled) handleExtract();
    }
  });
});
