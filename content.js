// Floating badge styles & root
(function initBadge() {
  if (window.GKR_BADGE) return;
  const badge = document.createElement('div');
  badge.id = 'gkr-badge';
  badge.style.cssText = `
    position: fixed; right: 14px; bottom: 14px; z-index: 999999999;
    background: #111; color: #fff; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18);
    padding: 10px 12px; font: 13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    min-width: 220px; max-width: 320px;
  `;
  badge.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
      <div style="font-weight:600;">Gumroad Keywords</div>
      <div style="display:flex; gap:6px;">
        <button id="gkr-scan" style="background:#fff;color:#111;border:none;border-radius:8px;padding:6px 8px;cursor:pointer;">Scan</button>
        <button id="gkr-csv" style="background:#fff;color:#111;border:none;border-radius:8px;padding:6px 8px;cursor:pointer;" disabled>CSV</button>
        <button id="gkr-hide" title="Hide" style="background:transparent;color:#fff;border:none;border-radius:8px;padding:6px 8px;cursor:pointer;">×</button>
      </div>
    </div>
    <div id="gkr-status" style="margin-top:6px;color:#bbb;">Ready.</div>
    <div id="gkr-top" style="margin-top:8px;"></div>
  `;
  document.documentElement.appendChild(badge);
  window.GKR_BADGE = badge;

  badge.querySelector('#gkr-hide').onclick = () => badge.remove();
  badge.querySelector('#gkr-scan').onclick = runQuickScan;
  badge.querySelector('#gkr-csv').onclick = exportCSV;

  // draggable
  let dragging = false, sx=0, sy=0, sr=0, sb=0;
  badge.addEventListener('mousedown', (e)=>{
    if (e.target.tagName === 'BUTTON') return;
    dragging = true; sx = e.clientX; sy = e.clientY;
    const rect = badge.getBoundingClientRect();
    sr = window.innerWidth - rect.right; sb = window.innerHeight - rect.bottom;
    e.preventDefault();
  });
  window.addEventListener('mousemove',(e)=>{
    if (!dragging) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    badge.style.right = (sr - dx) + 'px';
    badge.style.bottom = (sb - dy) + 'px';
  });
  window.addEventListener('mouseup',()=> dragging=false);
})();

function normalizeToken(t){return t.toLowerCase().replace(/[^\p{L}\p{N}#]+/gu,' ').trim();}
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
  const t = normalizeToken(text||''); if (!t) return [];
  return t.split(/\s+/).filter(w=>{
    if (!w) return false;
    if (w.startsWith('#')) w = w.replace(/^#+/,'');
    if (w.length < 3) return false;
    if (STOPWORDS.has(w)) return false;
    if (blacklistSet.has(w)) return false;
    return true;
  });
}
function ngrams(tokens, n, phraseBlacklistSet){
  const out=[]; for (let i=0;i+n<=tokens.length;i++){
    const g = tokens.slice(i,i+n).join(' ');
    if (!phraseBlacklistSet.has(g)) out.push(g);
  } return out;
}

function scanPageForProductLinks() {
  const links = new Set();
  document.querySelectorAll('a[href]').forEach(a=>{
    const href = a.getAttribute('href'); if (!href) return;
    let u; try { u = new URL(href, location.href).href; } catch { return; }
    if (/\/l\/[A-Za-z0-9_\-]+/.test(u) || /gumroad\.com\/(l|.+\/p)\/?/i.test(u)) links.add(u);
  });
  return Array.from(links).slice(0, 50);
}
async function fetchProductInfo(url){
  const res = await fetch(url,{credentials:'omit'}); const html = await res.text();
  const doc = new DOMParser().parseFromString(html,'text/html');
  const title = doc.querySelector('meta[property="og:title"]')?.content ||
                doc.querySelector('h1')?.textContent?.trim() || doc.title || '';
  const desc  = doc.querySelector('meta[name="description"]')?.content ||
                doc.querySelector('meta[property="og:description"]')?.content ||
                doc.querySelector('[data-testid="product-description"], .description')?.textContent?.trim() || '';
  const tagSet = new Set();
  doc.querySelectorAll('a[href*="/discover"], a[href*="query="], .tag, [class*="tag"]').forEach(a=>{
    const t=a.textContent?.trim(); if (t && t.length<=40) tagSet.add(t.replace(/^#/,''));
  });
  const text = doc.body?.textContent || '';
  (text.match(/#[\p{L}\p{N}_-]{3,}/gu) || []).forEach(h=>tagSet.add(h.replace(/^#/,'')));
  return { url, title: title.trim(), desc: desc.trim(), tags: Array.from(tagSet) };
}

let LAST_RESULT = null;

async function runQuickScan(){
  const status = document.getElementById('gkr-status');
  const topDiv = document.getElementById('gkr-top');
  const csvBtn = document.getElementById('gkr-csv');

  status.textContent = 'Scanning...';
  topDiv.innerHTML = '';
  csvBtn.disabled = true;

  try {
    // settings
    const { gkr_settings = {} } = await chrome.storage.sync.get(['gkr_settings']);
    const ngramEnabled = !!gkr_settings.ngrams;
    const blRaw = (gkr_settings.blacklist || '');
    const blist = Array.from(new Set(blRaw.split(/[\n,]+/).map(s=>s.trim().toLowerCase()).filter(Boolean)));
    const blacklistSet = new Set(blist.filter(w=>!w.includes(' ')));
    const phraseBlacklistSet = new Set(blist.filter(w=> w.includes(' ')));

    // gather links
    let links = scanPageForProductLinks();
    if (links.length === 0) links = [location.href];

    const items = [];
    let done = 0;
    for (const u of links) {
      try { items.push(await fetchProductInfo(u)); } catch {}
      status.textContent = `Scanning ${++done}/${links.length}...`;
    }

    // tally
    const freq={}, tagFreq={}, bi={}, tri={}, biTag={}, triTag={};
    for (const it of items){
      const text = [it.title||'', it.desc||'', (it.tags||[]).join(' ')].join(' ');
      const uni = tokenize(text, blacklistSet);
      for (const t of uni) freq[t]=(freq[t]||0)+1;

      const tagTokens = tokenize((it.tags||[]).join(' '), blacklistSet);
      for (const t of tagTokens) tagFreq[t]=(tagFreq[t]||0)+1;

      if (ngramEnabled){
        for (const g of ngrams(uni,2,phraseBlacklistSet)) bi[g]=(bi[g]||0)+1;
        for (const g of ngrams(uni,3,phraseBlacklistSet)) tri[g]=(tri[g]||0)+1;
        for (const g of ngrams(tagTokens,2,phraseBlacklistSet)) biTag[g]=(biTag[g]||0)+1;
        for (const g of ngrams(tagTokens,3,phraseBlacklistSet)) triTag[g]=(triTag[g]||0)+1;
      }
    }

    LAST_RESULT = { items, freq, tagFreq, bi, tri, biTag, triTag };

    // render top 5 (prefer unigrams; if n-gram on, campur)
    const topUni = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const topBi  = ngramEnabled ? Object.entries(bi).sort((a,b)=>b[1]-a[1]).slice(0,3) : [];
    status.textContent = `Done. ${items.length} products scanned.`;
    csvBtn.disabled = items.length === 0;

    const pill = (k,v)=> `<span style="display:inline-block;background:#fff;color:#111;border-radius:999px;padding:2px 8px;margin:2px 4px;font-size:12px;">${k} • ${v}</span>`;
    topDiv.innerHTML = `
      <div style="margin-top:4px;">${topUni.map(([k,v])=>pill(k,v)).join('')}</div>
      ${ngramEnabled && topBi.length ? `<div style="margin-top:4px;opacity:.9;">${topBi.map(([k,v])=>pill(k,v)).join('')}</div>` : ''}
    `;

    // notify popup if open
    chrome.runtime?.sendMessage?.({ type:'GKR_RESULT', payload: { count: items.length, top: topUni } });

  } catch (e) {
    status.textContent = 'Error: '+ e.message;
  }
}

function exportCSV(){
  if (!LAST_RESULT) return;
  const { freq, tagFreq, bi, tri, biTag, triTag } = LAST_RESULT;
  const header = ['term','count','in_tags','type'];
  const rows = [];

  const pushMap = (mapAll, mapTag, type) => {
    for (const [k,v] of Object.entries(mapAll)) rows.push([k, v, mapTag[k]||0, type]);
  };
  pushMap(freq, tagFreq, 'unigram');
  pushMap(bi, biTag, 'bigram');
  pushMap(tri, triTag, 'trigram');

  rows.sort((a,b)=> b[1]-a[1]);
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');

  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'gumroad_keywords.csv'; a.click();
  URL.revokeObjectURL(url);
}

// Receive result from popup scan (to update badge quickly)
chrome.runtime.onMessage.addListener((msg)=>{
  if (msg?.type === 'GKR_RESULT') {
    const status = document.getElementById('gkr-status');
    const topDiv = document.getElementById('gkr-top');
    const csvBtn = document.getElementById('gkr-csv');
    const top = msg.payload?.top || [];
    status.textContent = `Results received. ${msg.payload?.count || 0} products.`;
    csvBtn.disabled = false;
    const pill = (k,v)=> `<span style="display:inline-block;background:#fff;color:#111;border-radius:999px;padding:2px 8px;margin:2px 4px;font-size:12px;">${k} • ${v}</span>`;
    topDiv.innerHTML = top.map(([k,v])=>pill(k,v)).join('');
  }
});
