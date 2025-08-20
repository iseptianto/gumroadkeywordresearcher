const btnScan = document.getElementById('scan');
const btnExport = document.getElementById('export');
const btnClear = document.getElementById('clear');
const progressWrap = document.querySelector('.progress');
const progressBar = document.querySelector('.bar');
const summary = document.getElementById('summary');
const productsWrap = document.getElementById('productsWrap');
const productsDiv = document.getElementById('products');
const keywordsWrap = document.getElementById('keywordsWrap');
const keywordsTbody = document.querySelector('#keywordsTbl tbody');
const ngramsToggle = document.getElementById('ngramsToggle');
const blacklistArea = document.getElementById('blacklist');
const saveSettings = document.getElementById('saveSettings');
const tabs = document.getElementById('tabs');

let state = {
  items: [],                 // [{url,title,tags:[...],desc}]
  freq: {},                  // unigrams {term: count}
  tagFreq: {},               // unigrams found in tags
  bi: {},                    // bigrams
  tri: {},                   // trigrams
  biTag: {},
  triTag: {},
  currentTab: 'uni'
};

function toSet(list) { const s = new Set(); list.forEach(v=>{ if(v) s.add(v); }); return s; }

function parseBlacklist(raw) {
  return Array.from(new Set(
    raw.split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
  ));
}

async function loadSettings() {
  const { gkr_settings = {} } = await chrome.storage.sync.get(['gkr_settings']);
  ngramsToggle.checked = !!gkr_settings.ngrams;
  blacklistArea.value = gkr_settings.blacklist || '';
}

async function saveSettingsToStorage() {
  const gkr_settings = {
    ngrams: ngramsToggle.checked,
    blacklist: blacklistArea.value || ''
  };
  await chrome.storage.sync.set({ gkr_settings });
}

function normalizeToken(t) {
  return t.toLowerCase().replace(/[^\p{L}\p{N}#]+/gu, ' ').trim();
}
const STOPWORDS = new Set(`
a an the of and or to for with your my our their is are be been being was were will would should could can on in into from as by it its this that these those at
you me we i they them our us he she his her theirs mine yours not no yes up down over under than then out more most less least very much many few any some each every
about across after again against all almost along already also although always among around because before behind below between both but came come comes doing did done do
during either enough especially etc even ever far few find first get goes going got had has have having here how however if into just keep kept kind last later like
made make makes many may maybe might near need never new next often once only other others otherwise own per put really same see seen since so still such take takes took
than that their there they thing things think though through time times try trying until onto upon used use uses using want wants way ways well were what when where which
while who why will within without yes yet you your yours
`.trim().split(/\s+/));

function tokenize(text, blacklistSet) {
  const t = normalizeToken(text || '');
  if (!t) return [];
  const raw = t.split(/\s+/);
  const tokens = [];
  for (let w of raw) {
    if (!w) continue;
    if (w.startsWith('#')) w = w.replace(/^#+/, '');
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    if (blacklistSet.has(w)) continue;
    tokens.push(w);
  }
  return tokens;
}

function ngrams(tokens, n, phraseBlacklistSet) {
  const grams = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    const g = tokens.slice(i, i + n).join(' ');
    if (phraseBlacklistSet.has(g)) continue;
    grams.push(g);
  }
  return grams;
}

function tally(items, ngramEnabled, blacklist) {
  const blacklistSet = new Set(blacklist.filter(w => !w.includes(' ')));
  const phraseBlacklistSet = new Set(blacklist.filter(w => w.includes(' ')));

  const freq = {}, tagFreq = {}, bi = {}, tri = {}, biTag = {}, triTag = {};

  for (const it of items) {
    const text = [it.title || '', it.desc || '', (it.tags || []).join(' ')].join(' ');
    const uni = tokenize(text, blacklistSet);

    // unigrams
    for (const tok of uni) freq[tok] = (freq[tok] || 0) + 1;

    // tag-only
    const tagTokens = tokenize((it.tags || []).join(' '), blacklistSet);
    for (const tok of tagTokens) tagFreq[tok] = (tagFreq[tok] || 0) + 1;

    // n-grams
    if (ngramEnabled) {
      const biList = ngrams(uni, 2, phraseBlacklistSet);
      const triList = ngrams(uni, 3, phraseBlacklistSet);
      for (const g of biList) bi[g] = (bi[g] || 0) + 1;
      for (const g of triList) tri[g] = (tri[g] || 0) + 1;

      // n-grams inside tags
      const biTagList = ngrams(tagTokens, 2, phraseBlacklistSet);
      const triTagList = ngrams(tagTokens, 3, phraseBlacklistSet);
      for (const g of biTagList) biTag[g] = (biTag[g] || 0) + 1;
      for (const g of triTagList) triTag[g] = (triTag[g] || 0) + 1;
    }
  }
  return { freq, tagFreq, bi, tri, biTag, triTag };
}

function renderTable(mapAll, mapTag, limit=100) {
  const rows = Object.entries(mapAll).sort((a,b)=>b[1]-a[1]).slice(0, limit)
    .map(([k,v]) => `<tr><td>${k}</td><td class="nowrap">${v}</td><td class="nowrap">${mapTag[k] || 0}</td></tr>`).join('');
  keywordsTbody.innerHTML = rows || `<tr><td colspan="3" class="muted">No results.</td></tr>`;
  keywordsWrap.hidden = !rows;
}

function render() {
  summary.innerHTML = `<p><strong>${state.items.length}</strong> product(s) scanned.</p>
  <p class="muted">Switch tabs to view Unigrams, Bigrams, or Trigrams.</p>`;

  productsWrap.hidden = state.items.length === 0;
  productsDiv.innerHTML = state.items.map(it => {
    const title = it?.title || '(no title)';
    const url = it?.url || '#';
    const tags = Array.isArray(it?.tags) ? it.tags : [];
    return `
      <div style="margin:8px 0;padding:8px;border:1px solid #eee;border-radius:8px;">
        <div><a href="${url}" target="_blank" rel="noopener">${title}</a></div>
        ${tags.length ? `<div class="muted" style="margin-top:6px;">${
          tags.map(t => `<span class="pill">${t}</span>`).join(' ')
        }</div>` : ''}
      </div>
    `;
  }).join('');

  tabs.hidden = state.items.length === 0;

  if (state.currentTab === 'uni') renderTable(state.freq, state.tagFreq);
  if (state.currentTab === 'bi')  renderTable(state.bi, state.biTag);
  if (state.currentTab === 'tri') renderTable(state.tri, state.triTag);

  btnExport.disabled = state.items.length === 0;
}


function switchTab(to) {
  state.currentTab = to;
  tabs.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === to));
  render();
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function injectAndRun(fn, args = []) {
  const tab = await getCurrentTab();
  if (!tab?.id) throw new Error('No active tab');
  return chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fn, args });
}

// page helpers
function scanPageForProductLinks() {
  const links = new Set();
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href'); if (!href) return;
    let u; try { u = new URL(href, location.href); } catch { return; }
    const abs = u.href;
    const isGumroad = /(^|\.)gumroad\.com$/i.test(u.hostname);
    const looksLikeProduct = /\/l\/[A-Za-z0-9_\-]+/.test(u.pathname) || /\/p\//i.test(u.pathname);
    if (isGumroad && looksLikeProduct) links.add(abs);
  });
  // batasi agar ringan
  return Array.from(links).slice(0, 60);
}

async function fetchProductInfo(url) {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title =
      doc.querySelector('meta[property="og:title"]')?.content ||
      doc.querySelector('h1')?.textContent?.trim() ||
      doc.title || '';

    const desc =
      doc.querySelector('meta[name="description"]')?.content ||
      doc.querySelector('meta[property="og:description"]')?.content ||
      doc.querySelector('[data-testid="product-description"], .description')?.textContent?.trim() ||
      '';

    const tagSet = new Set();
    doc.querySelectorAll('a[href*="/discover"], a[href*="query="], .tag, [class*="tag"]').forEach(a => {
      const t = a.textContent?.trim();
      if (t && t.length <= 40) tagSet.add(t.replace(/^#/, ''));
    });
    const text = doc.body?.textContent || '';
    (text.match(/#[\p{L}\p{N}_-]{3,}/gu) || []).forEach(h => tagSet.add(h.replace(/^#/, '')));

    // selalu return objek valid
    return { url, title: (title || '').trim(), desc: (desc || '').trim(), tags: Array.from(tagSet) };
  } catch (e) {
    // fallback aman agar nggak null
    return { url, title: '', desc: '', tags: [] };
  }
}


async function scan() {
  try {
    await saveSettingsToStorage();
    const { gkr_settings = {} } = await chrome.storage.sync.get(['gkr_settings']);
    const ngramEnabled = !!gkr_settings.ngrams;
    const blacklist = parseBlacklist(gkr_settings.blacklist || '');

    btnScan.disabled = true;
    btnExport.disabled = true;
    progressWrap.hidden = false;
    progressBar.style.width = '0%';

    const tab = await getCurrentTab();
    const url = tab?.url || '';
    if (!/gumroad\.com/i.test(url)) {
      summary.innerHTML = `<p>Open a Gumroad page first (search, collection, or product), then click <strong>Scan</strong>.</p>`;
      progressWrap.hidden = true;
      btnScan.disabled = false;
      return;
    }

    const [{ result: linksFromPage }] = await injectAndRun(scanPageForProductLinks);
    let productLinks = Array.isArray(linksFromPage) ? linksFromPage : [];
    if (productLinks.length === 0) productLinks = [url];

    const items = [];
    let done = 0;
    for (const u of productLinks) {
      try {
        const execRes = await injectAndRun(fetchProductInfo, [u]);
        const safe = execRes?.[0]?.result;
        if (safe && typeof safe === 'object') items.push(safe);
      } catch (e) {
        console.warn('Fetch failed', u, e);
      } finally {
        done++;
        progressBar.style.width = Math.round((done / productLinks.length) * 100) + '%';
      }
    }

    // kalau tidak ada item valid, tampilkan pesan yang ramah
    if (items.length === 0) {
      summary.innerHTML = `<p class="muted">No products could be scraped on this page. Try running from a Gumroad search or collection page.</p>`;
      progressWrap.hidden = true;
      btnScan.disabled = false;
      return;
    }

    state.items = items;
    const { freq, tagFreq, bi, tri, biTag, triTag } = tally(items, ngramEnabled, blacklist);
    state.freq = freq; state.tagFreq = tagFreq;
    state.bi = bi; state.tri = tri; state.biTag = biTag; state.triTag = triTag;

    render();

    chrome.tabs.sendMessage(tab.id, { type: 'GKR_RESULT', payload: {
      count: items.length,
      top: Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5)
    }}).catch(()=>{});
  } catch (e) {
    console.error(e);
    summary.innerHTML = `<p style="color:#b00020">Error: ${e.message}</p>`;
  } finally {
    progressWrap.hidden = true;
    btnScan.disabled = false;
    btnExport.disabled = state.items.length === 0;
  }
}


function exportCSV() {
  const header = ['term','count','in_tags','type'];
  const rows = [];

  const pushMap = (mapAll, mapTag, type) => {
    for (const [k,v] of Object.entries(mapAll)) {
      rows.push([k, v, mapTag[k] || 0, type]);
    }
  };
  pushMap(state.freq, state.tagFreq, 'unigram');
  pushMap(state.bi, state.biTag, 'bigram');
  pushMap(state.tri, state.triTag, 'trigram');

  rows.sort((a,b)=> b[1]-a[1]);
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');

  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'gumroad_keywords.csv'; a.click();
  URL.revokeObjectURL(url);
}

btnScan.onclick = scan;
btnExport.onclick = exportCSV;
btnClear.onclick = () => {
  state = { items: [], freq:{}, tagFreq:{}, bi:{}, tri:{}, biTag:{}, triTag:{}, currentTab:'uni' };
  summary.innerHTML = ''; productsWrap.hidden = true; productsDiv.innerHTML = '';
  keywordsWrap.hidden = true; keywordsTbody.innerHTML = ''; btnExport.disabled = true;
  tabs.hidden = true; tabs.querySelectorAll('.tab').forEach(el=>el.classList.remove('active'));
  tabs.querySelector('[data-tab="uni"]')?.classList.add('active');
};
saveSettings.onclick = saveSettingsToStorage;

tabs.addEventListener('click', (e)=>{
  const t = e.target.closest('.tab'); if (!t) return;
  switchTab(t.dataset.tab);
});

loadSettings();
