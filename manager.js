/* Tap list manager. Reads and writes data.json in your GitHub repository using the GitHub API.
   Your access key is stored only in this browser (localStorage). */
(function () {
  var esc = Slide.esc, fmtAbv = Slide.fmtAbv, beerById = Slide.beerById;
  var CFG_KEY = 'taplist.cfg';
  var DAY = 864e5;

  var root = document.getElementById('root');
  var cfg = null;          // {owner, repo, token}
  var S = null;            // data as last saved on GitHub
  var sha = '';            // GitHub's version id of data.json (needed to save)
  var draft = null;        // data being edited
  var view = 'main';       // 'main' or 'setup'
  var tab = 'tap';
  var dirty = false, busy = false, loading = false;
  var status = '', statusKind = 'warn', loadError = '';
  var editId = null, delConfirm = null, focusId = null, scrollId = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid(p) { return p + Math.random().toString(36).slice(2, 8); }

  /* ---------- saved settings (this browser only) ---------- */
  function readCfg() {
    try { var c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); return (c && c.owner && c.repo && c.token) ? c : null; }
    catch (e) { return null; }
  }
  function writeCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {} }
  function clearCfg() { try { localStorage.removeItem(CFG_KEY); } catch (e) {} }
  function guessRepo() {
    var host = location.hostname, g = { owner: '', repo: '' };
    if (/\.github\.io$/.test(host)) {
      g.owner = host.split('.')[0];
      var seg = location.pathname.split('/').filter(Boolean);
      g.repo = (seg.length > 1 || (seg.length === 1 && !/\.html?$/.test(seg[0]))) ? seg[0] : host;
    }
    return g;
  }

  /* ---------- GitHub ---------- */
  function b64enc(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(bin);
  }
  function b64dec(b64) {
    var bin = atob(String(b64).replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function ghUrl(c) { return 'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + '/contents/data.json'; }
  function ghHeaders(c) {
    return { 'Authorization': 'Bearer ' + c.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  function explain(res) {
    if (res.status === 401) return 'GitHub rejected the access key. It may be mistyped or expired. Open Setup and paste a new one.';
    if (res.status === 403) return 'GitHub refused this request. The access key may lack permission, or GitHub is limiting requests. Wait a few minutes and try again.';
    if (res.status === 404) return 'GitHub could not find data.json. Check the username and repository name in Setup, and that the access key was given access to this repository.';
    if (res.status === 409 || res.status === 422) return 'Someone saved a change first. Reload this page to get the latest list, then redo your change.';
    return 'GitHub returned an error (' + res.status + ').';
  }
  function getData(c) {
    return fetch(ghUrl(c), { headers: ghHeaders(c), cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(explain(res));
      return res.json();
    }).then(function (j) {
      if (!j.content) throw new Error('data.json is too large or empty.');
      return { data: JSON.parse(b64dec(j.content)), sha: j.sha };
    });
  }
  function putData(c, data, oldSha) {
    return fetch(ghUrl(c), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(c)),
      cache: 'no-store',
      body: JSON.stringify({ message: 'Update tap list', content: b64enc(JSON.stringify(data, null, 1)), sha: oldSha })
    }).then(function (res) {
      if (!res.ok) throw new Error(explain(res));
      return res.json();
    });
  }
  function netMsg(e) {
    var m = (e && e.message) || String(e);
    return /Failed to fetch|NetworkError|Load failed/i.test(m) ? 'Could not reach GitHub. Check your internet connection and try again.' : m;
  }

  function pull() {
    loading = true; loadError = ''; render();
    getData(cfg).then(function (r) {
      S = r.data; sha = r.sha; draft = clone(S); dirty = false; loading = false; render();
    }).catch(function (e) { loading = false; loadError = netMsg(e); render(); });
  }

  /* ---------- tap helpers ---------- */
  function tapIdx(id) { for (var i = 0; i < draft.tap.length; i++) if (draft.tap[i].id === id) return i; return -1; }
  function missingAbv() {
    return draft.tap.filter(function (t) { return beerById(draft, t.id) && !String(t.abv).trim(); }).length;
  }
  function newNote(t) {
    if (!t.since) return '';
    var inPub = false;
    S.tap.forEach(function (x) { if (x.id === t.id) inPub = true; });
    var msg;
    if (!inPub) msg = 'New on tap tag starts when you save';
    else {
      var d = Math.ceil((Date.parse(t.since) + 7 * DAY - Date.now()) / DAY);
      if (d <= 0) return '';
      msg = 'New on tap tag: ' + d + (d === 1 ? ' day' : ' days') + ' left';
    }
    return '<span class="small" style="display:block;color:var(--accent)">' + msg + '</span><button class="lnk" data-act="clearnew" data-id="' + esc(t.id) + '">Remove tag</button>';
  }

  /* ---------- screens ---------- */
  function tabsHTML() {
    var t = [['tap', 'Beers'], ['cw', 'Cider & wine'], ['screen', 'Header'], ['prev', 'Preview']];
    return '<div class="tabs">' + t.map(function (x) {
      return '<button class="tab' + (tab === x[0] ? ' on' : '') + '" data-act="tab" data-tab="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>';
  }
  function editBox(b) {
    var id = esc(b.id);
    return '<div class="det"><label class="f">Name</label><input type="text" data-p="beer|' + id + '|name" value="' + esc(b.name) + '">' +
      '<label class="f">Type (lager, IPA, stout...)</label><input type="text" data-p="beer|' + id + '|style" value="' + esc(b.style) + '">' +
      '<label class="f">Extra note (optional, e.g. Pints $5)</label><input type="text" data-p="beer|' + id + '|note" value="' + esc(b.note) + '">' +
      '<p style="margin:12px 0 0;display:flex;gap:8px"><button class="btn" data-act="doneedit">Done</button><button class="btn warn" data-act="delbeer" data-id="' + id + '">' + (delConfirm === b.id ? 'Tap again to delete' : 'Delete beer') + '</button></p></div>';
  }
  function tapTab() {
    var on = draft.tap.map(function (t) { var b = beerById(draft, t.id); return b ? { b: b, t: t } : null; }).filter(Boolean);
    var h = '<h2 style="margin-top:4px">On tap now (' + on.length + ')</h2><div class="card">';
    if (!on.length) h += '<p class="muted">Nothing selected yet. Check beers below.</p>';
    on.forEach(function (x, i) {
      var id = esc(x.b.id);
      h += '<div class="rw" id="row-' + id + '"><div class="r"><div class="grow"><b>' + esc(x.b.name) + '</b><span class="small">' + esc(x.b.style) + '</span>' + newNote(x.t) +
        '<button class="lnk" data-act="edit" data-id="' + id + '">' + (editId === x.b.id ? 'Close' : 'Edit') + '</button></div>' +
        '<input type="text" inputmode="decimal" id="abv-' + id + '" data-p="tap|' + id + '|abv" value="' + esc(x.t.abv) + '" placeholder="ABV %" style="width:84px;flex:none">' +
        '<button class="btn sq" data-act="up" data-id="' + id + '"' + (i === 0 ? ' disabled' : '') + '>\u25b2</button>' +
        '<button class="btn sq" data-act="down" data-id="' + id + '"' + (i === on.length - 1 ? ' disabled' : '') + '>\u25bc</button>' +
        '<button class="btn sq" data-act="off" data-id="' + id + '" title="Take off tap">\u2715</button></div>' + (editId === x.b.id ? editBox(x.b) : '') + '</div>';
    });
    h += '</div><h2>Not on tap - check to add to tap list</h2><input type="search" id="q" placeholder="Search beers"><div class="card" style="margin-top:8px">';
    var rest = draft.beers.filter(function (b) { return tapIdx(b.id) < 0; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    rest.forEach(function (b) {
      var id = esc(b.id);
      h += '<div class="rw" id="row-' + id + '" data-n="' + esc((b.name + ' ' + b.style).toLowerCase()) + '"><div class="r"><label class="grow" style="display:flex;gap:10px;align-items:center;cursor:pointer"><input type="checkbox" data-act="on" data-id="' + id + '" style="width:22px;height:22px;flex:none">' +
        '<span><b style="display:block">' + esc(b.name) + '</b><span class="small" style="display:block">' + esc(b.style) + '</span></span></label>' +
        '<button class="btn" data-act="edit" data-id="' + id + '">' + (editId === b.id ? 'Close' : 'Edit') + '</button></div>' + (editId === b.id ? editBox(b) : '') + '</div>';
    });
    if (!rest.length) h += '<p class="muted">Every beer is on tap.</p>';
    return h + '</div><button class="btn pri" data-act="addbeer" style="width:100%;margin-top:6px">+ Add a new beer</button>';
  }
  function logoField(id, logo) {
    return '<label class="f">Logo</label><div class="r" style="border:0">' + (logo ? '<img class="logo-prev" src="' + esc(logo) + '" alt="">' : '<span class="small grow">No logo (name is shown as text)</span>') +
      '<span class="grow"></span><input type="file" accept="image/*" data-up="' + esc(id) + '" style="max-width:150px;font-size:13px">' + (logo ? '<button class="btn" data-act="rmlogo" data-id="' + esc(id) + '">Remove</button>' : '') + '</div>';
  }
  function cwTab() {
    var h = '';
    draft.groups.forEach(function (g) {
      h += '<div class="card"><div class="two"><div><label class="f">Company</label><input type="text" data-p="grp|' + esc(g.id) + '|title" value="' + esc(g.title) + '"></div>' +
        '<div><label class="f">Label (CIDER, 7oz $11...)</label><input type="text" data-p="grp|' + esc(g.id) + '|sub" value="' + esc(g.sub) + '"></div></div>' + logoField(g.id, g.logo) + '<h2 style="margin-top:6px">Items</h2>';
      g.items.forEach(function (i) {
        h += '<div class="r"><input type="checkbox" title="Available" data-p="item|' + esc(g.id) + '|' + esc(i.id) + '|on"' + (i.on ? ' checked' : '') + ' style="width:22px;height:22px;flex:none">' +
          '<input type="text" data-p="item|' + esc(g.id) + '|' + esc(i.id) + '|name" value="' + esc(i.name) + '" style="flex:2">' +
          '<input type="text" inputmode="decimal" data-p="item|' + esc(g.id) + '|' + esc(i.id) + '|abv" value="' + esc(i.abv) + '" style="flex:1;min-width:0" placeholder="ABV">' +
          '<button class="btn sq" data-act="delitem" data-gid="' + esc(g.id) + '" data-id="' + esc(i.id) + '">\u2715</button></div>';
      });
      h += '<p style="margin:10px 0 0;display:flex;gap:8px"><button class="btn" data-act="additem" data-id="' + esc(g.id) + '">+ Add item</button><button class="btn warn" data-act="delgrp" data-id="' + esc(g.id) + '">' + (delConfirm === g.id ? 'Tap again to delete' : 'Delete company') + '</button></p></div>';
    });
    return h + '<button class="btn pri" data-act="addgrp" style="width:100%">+ Add a cider or wine company</button><p class="small">Checked items show on the screen.</p>';
  }
  function screenTab() {
    return '<div class="card"><label class="f">Title</label><input type="text" data-p="set|title" value="' + esc(draft.settings.title) + '">' +
      '<label class="f">Price line</label><input type="text" data-p="set|priceLine" value="' + esc(draft.settings.priceLine) + '">' +
      logoField('brew', draft.settings.logo) + '<p class="small">The brewery logo appears in both top corners.</p></div>';
  }
  function prevTab() {
    return '<div class="pv" id="pv"><div class="stage">' + Slide.stageHTML(draft) + '</div></div><p class="small">' +
      (dirty ? 'This is a preview of your unsaved changes. Looks right? Press Save to screen below.' : 'No unsaved changes. This matches what is on the screen now.') + '</p>';
  }
  function barHTML() {
    if (busy) return '<span class="muted">Saving\u2026</span>';
    if (dirty) {
      var miss = missingAbv();
      return (miss ? '<span class="small" style="color:var(--warn)">Enter ABV for ' + miss + (miss === 1 ? ' beer' : ' beers') + ' to save</span>' : '') +
        '<button class="btn" data-act="reset">Discard</button><button class="btn pri" data-act="publish"' + (miss ? ' disabled' : '') + '>Save to screen</button>';
    }
    return '<span class="muted">Screen is up to date</span>';
  }
  function statusHTML() {
    return status ? '<div class="msg' + (statusKind === 'ok' ? ' ok' : '') + '">' + esc(status) + '</div>' : '';
  }

  function renderSetup() {
    var g = guessRepo(), c = cfg || {};
    root.innerHTML = '<div class="m"><div class="top"><h1>Setup</h1>' + (S ? '<button class="btn" data-act="cancelsetup">Cancel</button>' : '') + '</div>' + statusHTML() +
      '<div class="card"><p class="small" style="margin-top:0">This connects the manager to your GitHub project so it can save the tap list. The access key stays in this browser only.</p>' +
      '<label class="f">GitHub username</label><input type="text" id="cfg-owner" autocapitalize="off" autocorrect="off" value="' + esc(c.owner || g.owner) + '">' +
      '<label class="f">Repository name</label><input type="text" id="cfg-repo" autocapitalize="off" autocorrect="off" value="' + esc(c.repo || g.repo) + '">' +
      '<label class="f">Access key (starts with github_pat_)</label><input type="password" id="cfg-token" autocapitalize="off" autocorrect="off" value="' + esc(c.token || '') + '">' +
      '<p style="margin:14px 0 0;display:flex;gap:8px"><button class="btn pri" data-act="savecfg" style="flex:1">Save and connect</button>' + (cfg ? '<button class="btn warn" data-act="forget">Forget key</button>' : '') + '</p></div></div>';
  }
  function renderMain() {
    if (loading) { root.innerHTML = '<div class="m"><p class="muted">Loading tap list\u2026</p></div>'; return; }
    if (loadError) {
      root.innerHTML = '<div class="m"><h1>Tap list manager</h1><div class="msg">' + esc(loadError) + '</div><p style="display:flex;gap:8px"><button class="btn pri" data-act="retry">Try again</button><button class="btn" data-act="setup">Setup</button></p></div>';
      return;
    }
    var body = { tap: tapTab, cw: cwTab, screen: screenTab, prev: prevTab }[tab]();
    root.innerHTML = '<div class="m"><div class="top"><h1>Tap list manager</h1><span style="display:flex;gap:6px"><a class="btn" href="index.html" style="text-decoration:none">View screen</a><button class="btn" data-act="setup">Setup</button></span></div>' +
      statusHTML() + tabsHTML() + body + '</div><div class="bar" id="bar">' + barHTML() + '</div>';
    fit();
    if (focusId) { var f = document.getElementById('abv-' + focusId); focusId = null; if (f) f.focus(); }
    if (scrollId) {
      var rw = document.getElementById('row-' + scrollId); scrollId = null;
      if (rw) { rw.scrollIntoView({ block: 'center' }); var ni = rw.querySelector('input[type=text]'); if (ni) { ni.focus(); ni.select(); } }
    }
  }
  function render() { if (view === 'setup') renderSetup(); else renderMain(); }
  function fit() { var pv = document.getElementById('pv'); if (pv) Slide.fitWidth(pv); }
  function markDirty() { dirty = true; status = ''; var b = document.getElementById('bar'); if (b) b.innerHTML = barHTML(); }

  /* ---------- save ---------- */
  function publish() {
    if (missingAbv()) { status = 'Every beer on tap needs an ABV before saving. Enter N/A for drinks without one.'; statusKind = 'warn'; render(); return; }
    busy = true; status = ''; render();
    var nowIso = new Date().toISOString(), inS = {};
    S.tap.forEach(function (x) { inS[x.id] = 1; });
    draft.tap.forEach(function (t) { if (t.since && !inS[t.id]) t.since = nowIso; });   // the 7-day "New on tap" clock starts now
    draft.updated = nowIso;
    putData(cfg, draft, sha).then(function (j) {
      S = clone(draft); sha = (j && j.content && j.content.sha) || sha; dirty = false; busy = false;
      status = 'Saved. The screen picks up the change within a few minutes.'; statusKind = 'ok'; render();
    }).catch(function (e) {
      busy = false; status = netMsg(e); statusKind = 'warn'; render();
    });
  }

  /* ---------- logos ---------- */
  function readLogo(file, cb) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var m = 360, k = Math.min(1, m / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); cb(c.toDataURL('image/png'));
    };
    img.onerror = function () { URL.revokeObjectURL(url); status = 'Could not read that image.'; statusKind = 'warn'; render(); };
    img.src = url;
  }
  function setLogo(id, val) {
    if (id === 'brew') draft.settings.logo = val;
    else draft.groups.forEach(function (g) { if (g.id === id) g.logo = val; });
  }

  /* ---------- events ---------- */
  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var a = el.dataset.act, id = el.dataset.id, i;
    if (a !== 'delbeer' && a !== 'delgrp') delConfirm = null;

    if (a === 'setup') { view = 'setup'; status = ''; render(); return; }
    if (a === 'cancelsetup') { view = 'main'; status = ''; render(); return; }
    if (a === 'retry') { pull(); return; }
    if (a === 'forget') { clearCfg(); cfg = null; S = null; status = 'Access key removed from this browser.'; statusKind = 'ok'; render(); return; }
    if (a === 'savecfg') {
      var o = document.getElementById('cfg-owner').value.trim(), r = document.getElementById('cfg-repo').value.trim(), t = document.getElementById('cfg-token').value.trim();
      if (!o || !r || !t) { status = 'Fill in all three fields.'; statusKind = 'warn'; render(); return; }
      cfg = { owner: o, repo: r, token: t }; writeCfg(cfg); view = 'main'; status = ''; pull(); return;
    }
    if (a === 'publish') { publish(); return; }

    if (a === 'tab') { tab = el.dataset.tab; }
    else if (a === 'on') { draft.tap.push({ id: id, abv: '', since: new Date().toISOString() }); focusId = id; markDirty(); }
    else if (a === 'clearnew') { draft.tap.forEach(function (t) { if (t.id === id) t.since = ''; }); markDirty(); }
    else if (a === 'off') { draft.tap = draft.tap.filter(function (x) { return x.id !== id; }); markDirty(); }
    else if (a === 'up' || a === 'down') {
      i = tapIdx(id); var j = a === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= draft.tap.length) return;
      var tmp = draft.tap[i]; draft.tap[i] = draft.tap[j]; draft.tap[j] = tmp; markDirty();
    }
    else if (a === 'addbeer') { var nb = { id: uid('b'), name: 'New beer', style: '', note: '' }; draft.beers.unshift(nb); editId = nb.id; scrollId = nb.id; tab = 'tap'; markDirty(); }
    else if (a === 'edit') { editId = (editId === id) ? null : id; delConfirm = null; }
    else if (a === 'doneedit') { editId = null; }
    else if (a === 'delbeer') {
      if (delConfirm === id) { draft.beers = draft.beers.filter(function (b) { return b.id !== id; }); draft.tap = draft.tap.filter(function (x) { return x.id !== id; }); delConfirm = null; editId = null; markDirty(); }
      else { delConfirm = id; editId = id; }
    }
    else if (a === 'addgrp') { draft.groups.push({ id: uid('g'), title: 'New company', sub: '', logo: '', items: [] }); markDirty(); }
    else if (a === 'delgrp') { if (delConfirm === id) { draft.groups = draft.groups.filter(function (g) { return g.id !== id; }); delConfirm = null; markDirty(); } else delConfirm = id; }
    else if (a === 'additem') { draft.groups.forEach(function (g) { if (g.id === id) g.items.push({ id: uid('i'), name: 'New item', abv: '', on: true }); }); markDirty(); }
    else if (a === 'delitem') { draft.groups.forEach(function (g) { if (g.id === el.dataset.gid) g.items = g.items.filter(function (x) { return x.id !== id; }); }); markDirty(); }
    else if (a === 'rmlogo') { setLogo(id, ''); markDirty(); }
    else if (a === 'reset') { draft = clone(S); dirty = false; status = ''; editId = null; }
    render();
  });
  root.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'q') {
      var q = t.value.toLowerCase(), rs = root.querySelectorAll('[data-n]');
      for (var k = 0; k < rs.length; k++) rs[k].style.display = rs[k].dataset.n.indexOf(q) >= 0 ? '' : 'none';
      return;
    }
    var p = t.dataset.p; if (!p) return;
    var a = p.split('|'), v = t.type === 'checkbox' ? t.checked : t.value;
    if (a[0] === 'set') draft.settings[a[1]] = v;
    else if (a[0] === 'beer') { var b = beerById(draft, a[1]); if (b) b[a[2]] = v; }
    else if (a[0] === 'tap') { draft.tap.forEach(function (x) { if (x.id === a[1]) x[a[2]] = v; }); }
    else if (a[0] === 'grp') { draft.groups.forEach(function (g) { if (g.id === a[1]) g[a[2]] = v; }); }
    else if (a[0] === 'item') { draft.groups.forEach(function (g) { if (g.id === a[1]) g.items.forEach(function (i) { if (i.id === a[2]) i[a[3]] = v; }); }); }
    markDirty();
  });
  root.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.up || !t.files || !t.files[0]) return;
    var id = t.dataset.up;
    readLogo(t.files[0], function (url) { setLogo(id, url); markDirty(); render(); });
  });
  window.addEventListener('resize', fit);

  /* ---------- start ---------- */
  cfg = readCfg();
  if (!cfg) { view = 'setup'; render(); } else { pull(); }
})();
