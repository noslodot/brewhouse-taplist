/* Events manager. Reads and writes events.json (and event photos in events-img/) in your GitHub repository
   using the GitHub API. It uses the same saved access key as the tap list manager (this browser only). */
(function () {
  var L = window.EventsLib, esc = L.esc;
  var CFG_KEY = 'taplist.cfg';        // shared with the tap list manager
  var FILE = 'events.json';
  var PHOTO_MAX = 1000;               // longest side of a saved photo, in pixels

  var root = document.getElementById('root');
  var cfg = null;          // {owner, repo, token}
  var savedSnap = '';      // what is on GitHub now, as comparable text
  var sha = '';            // GitHub's version id of events.json (needed to save)
  var draft = null;        // data being edited
  var view = 'list';       // 'list' | 'edit' | 'setup'
  var editId = null;
  var busy = false, loading = false, loadError = '';
  var status = '', statusKind = 'warn';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function newId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  /* ---------- saved settings (this browser only) ---------- */
  function readCfg() {
    try { var c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); return (c && c.owner && c.repo && c.token) ? c : null; }
    catch (e) { return null; }
  }
  function writeCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {} }
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
  function ghUrl(c, path) {
    return 'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + '/contents/' + path;
  }
  function ghHeaders(c) {
    return { 'Authorization': 'Bearer ' + c.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  function explain(res) {
    if (res.status === 401) return 'GitHub rejected the access key. It may be mistyped or expired. Open Setup and paste a new one.';
    if (res.status === 403) return 'GitHub refused this request. The access key may lack permission, or GitHub is limiting requests. Wait a few minutes and try again.';
    if (res.status === 404) return 'GitHub could not find the events file. Check the username and repository name in Setup, and that the access key was given access to this repository.';
    if (res.status === 409 || res.status === 422) return 'Someone saved a change first. Reload this page to get the latest events, then redo your change.';
    return 'GitHub returned an error (' + res.status + ').';
  }
  function netMsg(e) {
    var m = (e && e.message) || String(e);
    return /Failed to fetch|NetworkError|Load failed/i.test(m) ? 'Could not reach GitHub. Check your internet connection and try again.' : m;
  }
  function getData(c) {
    return fetch(ghUrl(c, FILE), { headers: ghHeaders(c), cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(explain(res));
      return res.json();
    }).then(function (j) {
      if (!j.content) throw new Error('The events file is too large or empty.');
      return { data: JSON.parse(b64dec(j.content)), sha: j.sha };
    });
  }
  function put(c, path, body) {
    return fetch(ghUrl(c, path), {
      method: 'PUT', cache: 'no-store',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(c)),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error(explain(res));
      return res.json();
    });
  }

  /* ---------- the data ---------- */
  function normalize(d) {
    d = (d && typeof d === 'object') ? d : {};
    d.settings = (d.settings && typeof d.settings === 'object') ? d.settings : {};
    if (!d.settings.title) d.settings.title = 'Upcoming Events';
    if (!d.settings.place) d.settings.place = '';
    d.events = (Array.isArray(d.events) ? d.events : []).filter(function (e) { return e && typeof e === 'object'; }).map(function (e) {
      return Object.assign({ id: newId(), title: '', date: '', start: '', end: '', place: '', host: '', cost: '', desc: '', img: '' }, e);
    });
    return d;
  }
  function isBlank(e) {
    return !(e.title || e.date || e.start || e.end || e.host || e.cost || e.desc || e.img || e._img);
  }
  function cleanOut(d) {   // the data as it will be saved: no blank events, no temporary fields
    var o = clone(d);
    o.events = o.events.filter(function (e) { return !isBlank(e); }).map(function (e) { delete e._img; delete e._new; if (!e.featured) delete e.featured; return e; });
    return o;
  }
  function snap(d) { var o = cleanOut(d); delete o.updated; return JSON.stringify(o); }
  function isDirty() {
    if (!draft) return false;
    if (draft.events.some(function (e) { return e._img; })) return true;
    return snap(draft) !== savedSnap;
  }
  function byId(id) { for (var i = 0; i < draft.events.length; i++) if (draft.events[i].id === id) return draft.events[i]; return null; }
  function dropBlanks() { draft.events = draft.events.filter(function (e) { return !isBlank(e); }); }

  function pull() {
    loading = true; loadError = ''; render();
    getData(cfg).then(function (r) {
      draft = normalize(r.data); sha = r.sha; savedSnap = snap(draft); loading = false; view = 'list'; render();
    }).catch(function (e) { loading = false; loadError = netMsg(e); render(); });
  }

  /* ---------- screens ---------- */
  function statusHTML() { return status ? '<div class="msg' + (statusKind === 'ok' ? ' ok' : '') + '" role="status">' + esc(status) + '</div>' : ''; }
  function barHTML() {
    var dis = busy || !isDirty();
    return '<button class="btn pri" data-act="save"' + (dis ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save to site') + '</button>';
  }
  function whenText(e) {
    if (!L.validDate(e.date)) return 'No date yet';
    var dp = L.dateParts(e.date), t = L.fmtRange(e.start, e.end);
    return dp.dowLong + ' ' + dp.month.slice(0, 3) + ' ' + dp.day + (t ? ' · ' + t : '');
  }
  function thumbHTML(e, cls) {
    var src = e._img ? e._img.dataUrl : L.safeImg(e.img);
    return src ? '<img class="thumb ' + (cls || '') + '" src="' + esc(src) + '" alt="">' : '';
  }
  function cardHTML(e, past) {
    return '<div class="card"><div class="r">' + thumbHTML(e) + '<div class="grow"><b>' + esc(e.title || '(no name yet)') + '</b><span class="small">' + esc(whenText(e)) + (e.featured ? ' \u00b7 Featured' : '') + '</span></div>' +
      (past ? '<button class="btn" data-act="copy" data-id="' + esc(e.id) + '">Copy</button>' : '') +
      '<button class="btn" data-act="edit" data-id="' + esc(e.id) + '">Edit</button></div></div>';
  }

  function renderSetup() {
    var g = guessRepo(), c = cfg || {};
    root.innerHTML = '<div class="m"><div class="top"><h1>Setup</h1>' + (draft ? '<button class="btn" data-act="cancelsetup">Cancel</button>' : '') + '</div>' + statusHTML() +
      '<div class="card"><p class="small" style="margin-top:0">This connects the manager to your GitHub project so it can save events. The access key stays in this browser only. If you already use the tap list manager in this browser, it is the same key and you will not see this screen.</p>' +
      '<label class="f" for="cfg-owner">GitHub username</label><input class="in" type="text" id="cfg-owner" autocapitalize="off" autocorrect="off" value="' + esc(c.owner || g.owner) + '">' +
      '<label class="f" for="cfg-repo">Repository name</label><input class="in" type="text" id="cfg-repo" autocapitalize="off" autocorrect="off" value="' + esc(c.repo || g.repo) + '">' +
      '<label class="f" for="cfg-token">Access key (starts with github_pat_)</label><input class="in" type="password" id="cfg-token" autocapitalize="off" autocorrect="off" value="' + esc(c.token || '') + '">' +
      '<p style="margin:14px 0 0"><button class="btn pri" data-act="savecfg" style="width:100%">Save and connect</button></p></div></div>';
  }
  function renderList() {
    var now = L.pacificNow(), up = [], past = [];
    draft.events.forEach(function (e) { if (isBlank(e)) return; (L.validDate(e.date) && L.isPast(e, now) ? past : up).push(e); });
    up = L.sortEvents(up.map(function (e) { return e; }));
    past = L.sortEvents(past).reverse();
    root.innerHTML = '<div class="m"><div class="top"><h1>Events</h1><button class="btn pri" data-act="add">+ Add event</button></div>' +
      '<p class="links"><a class="btn" href="manage.html" data-act="taplist">Tap list</a><a class="btn" href="events.html">View page</a></p>' +
      statusHTML() +
      '<h2>Coming up (' + up.length + ')</h2>' +
      (up.length ? up.map(function (e) { return cardHTML(e, false); }).join('') : '<p class="help">Nothing coming up. Tap + Add event.</p>') +
      (past.length ? '<details class="past"><summary>Past events (' + past.length + ')</summary><p class="help">Events leave the public page by themselves once they are over. They stay here until you delete them, so you can copy one for next time.</p>' +
        past.map(function (e) { return cardHTML(e, true); }).join('') + '</details>' : '') +
      '</div><div class="bar" id="bar">' + barHTML() + '</div>';
  }
  function renderEdit() {
    var e = byId(editId);
    if (!e) { view = 'list'; render(); return; }
    var isNew = !!e._new;
    root.innerHTML = '<div class="m"><button class="x" data-act="close" aria-label="Close">&times;</button><div class="top"><h1>' + (isNew ? 'New event' : 'Edit event') + '</h1></div>' + statusHTML() +
      '<label class="f" for="f-title" style="margin-top:0">Name</label><input class="in" type="text" id="f-title" data-f="title" value="' + esc(e.title) + '">' +
      '<div class="three"><div><label class="f" for="f-date">Date</label><input class="in" type="date" id="f-date" data-f="date" value="' + esc(L.validDate(e.date) ? e.date : '') + '"></div>' +
      '<div><label class="f" for="f-start">Starts</label><input class="in" type="time" id="f-start" data-f="start" value="' + esc(L.validTime(e.start) ? e.start : '') + '"></div>' +
      '<div><label class="f" for="f-end">Ends</label><input class="in" type="time" id="f-end" data-f="end" value="' + esc(L.validTime(e.end) ? e.end : '') + '"></div></div>' +
      '<label class="f" for="f-place">Place</label><input class="in" type="text" id="f-place" data-f="place" value="' + esc(e.place) + '">' +
      '<label class="f" for="f-host">Hosted by</label><input class="in" type="text" id="f-host" data-f="host" list="hosts" value="' + esc(e.host) + '">' +
      '<datalist id="hosts"><option value="McMillin Farm Collective"><option value="McMillin Farm Brewhouse"><option value="Celebrate HARVEST"></datalist>' +
      '<label class="f" for="f-cost">Cost (leave blank if not stated)</label><input class="in" type="text" id="f-cost" data-f="cost" value="' + esc(e.cost) + '" placeholder="Free, $10, ...">' +
      '<label class="chk" for="f-featured"><input type="checkbox" id="f-featured" data-f="featured"' + (e.featured ? ' checked' : '') + '><span>Featured McMillin Farm event<br><span class="small">Shown larger, across the whole row. Use for Hot Sauce Fest, Brewers Fest and the Holiday Market.</span></span></label>' +
      '<label class="f" for="f-desc">Details</label><textarea class="in" id="f-desc" data-f="desc">' + esc(e.desc) + '</textarea>' +
      '<label class="f">Photo</label><div class="r" id="photo-row">' + photoRowHTML(e) + '</div>' +
      (isNew ? '' : '<p style="margin:18px 0 0"><button class="btn warn" data-act="delete" data-id="' + esc(e.id) + '">Delete this event</button></p>') +
      '</div><div class="bar" id="bar">' + barHTML() + '</div>';
  }
  function photoRowHTML(e) {
    var has = !!(e._img || L.safeImg(e.img));
    return thumbHTML(e, 'big') + '<label class="btn" for="f-photo">' + (has ? 'Change photo' : 'Add photo') + '</label>' +
      '<input type="file" id="f-photo" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">' +
      (has ? '<button class="btn" data-act="rmphoto">Remove</button>' : '');
  }
  function renderMain() {
    if (loading) { root.innerHTML = '<div class="m"><p class="small">Loading events…</p></div>'; return; }
    if (loadError) {
      root.innerHTML = '<div class="m"><h1>Events manager</h1><div class="msg">' + esc(loadError) + '</div><p style="display:flex;gap:8px"><button class="btn pri" data-act="retry">Try again</button><button class="btn" data-act="setup">Setup</button></p></div>';
      return;
    }
    if (view === 'edit') renderEdit(); else renderList();
  }
  function render() { if (view === 'setup') renderSetup(); else renderMain(); window.scrollTo(0, 0); }
  function refreshBar() { var b = document.getElementById('bar'); if (b) b.innerHTML = barHTML(); }

  /* ---------- photos ---------- */
  function readPhoto(file, cb) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var k = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); cb(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = function () { URL.revokeObjectURL(url); status = 'Could not read that photo. Try a different one.'; statusKind = 'warn'; render(); };
    img.src = url;
  }

  /* ---------- save ---------- */
  function problem() {   // first event that is missing a name or a date
    for (var i = 0; i < draft.events.length; i++) {
      var e = draft.events[i];
      if (isBlank(e)) continue;
      if (!e.title.trim()) return { e: e, text: 'Every event needs a name.' };
      if (!L.validDate(e.date)) return { e: e, text: 'Every event needs a date.' };
    }
    return null;
  }
  function publish() {
    dropBlanks();
    var p = problem();
    if (p) { editId = p.e.id; view = 'edit'; status = p.text + ' Fix "' + (p.e.title || 'this event') + '" and save again.'; statusKind = 'warn'; render(); return; }
    busy = true; status = ''; refreshBar();
    var out = cleanOut(draft), uploads = [];
    out.updated = new Date().toISOString();
    draft.events.forEach(function (e) {
      if (!e._img) return;
      var path = 'events-img/' + e.id.replace(/[^A-Za-z0-9_-]/g, '') + '-' + Date.now().toString(36) + '.jpg';
      uploads.push({ id: e.id, path: path, b64: e._img.dataUrl.split(',')[1] });
    });
    uploads.forEach(function (u) { out.events.forEach(function (e) { if (e.id === u.id) e.img = u.path; }); });
    // photos first, then the list that points at them
    uploads.reduce(function (chain, u) {
      return chain.then(function () { return put(cfg, u.path, { message: 'Add event photo', content: u.b64 }); });
    }, Promise.resolve()).then(function () {
      return put(cfg, FILE, { message: 'Update events', content: b64enc(JSON.stringify(out, null, 1) + '\n'), sha: sha });
    }).then(function (j) {
      uploads.forEach(function (u) { var e = byId(u.id); if (e) { e.img = u.path; delete e._img; } });
      draft.updated = out.updated; savedSnap = snap(draft);
      sha = (j && j.content && j.content.sha) || sha; busy = false;
      status = 'Saved. It is live on the events page within about a minute.'; statusKind = 'ok';
      if (view === 'edit' && !byId(editId)) view = 'list';
      render();
    }).catch(function (e) {
      busy = false; status = netMsg(e); statusKind = 'warn'; render();
    });
  }

  /* ---------- taps and typing ---------- */
  root.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el) return;
    var a = el.dataset.act, id = el.dataset.id, e;
    if (a === 'setup') { view = 'setup'; status = ''; render(); return; }
    if (a === 'cancelsetup') { view = 'list'; status = ''; render(); return; }
    if (a === 'retry') { pull(); return; }
    if (a === 'taplist') { if (isDirty() && !window.confirm('You have event changes that are not saved. Leave without saving?')) ev.preventDefault(); return; }
    if (a === 'savecfg') {
      var o = document.getElementById('cfg-owner').value.trim(), r = document.getElementById('cfg-repo').value.trim(), t = document.getElementById('cfg-token').value.trim();
      if (!o || !r || !t) { status = 'Fill in all three boxes.'; statusKind = 'warn'; render(); return; }
      cfg = { owner: o, repo: r, token: t }; writeCfg(cfg); status = ''; pull(); return;
    }
    if (a === 'add') {
      e = { id: newId(), title: '', date: '', start: '', end: '', place: draft.settings.place || '', host: '', cost: '', desc: '', img: '', _new: true };
      draft.events.push(e); editId = e.id; view = 'edit'; status = ''; render();
      var f = document.getElementById('f-title'); if (f) f.focus();
      return;
    }
    if (a === 'edit') { editId = id; view = 'edit'; status = ''; render(); return; }
    if (a === 'copy') {
      var src = byId(id); if (!src) return;
      e = clone(src); e.id = newId(); e.date = ''; delete e._img; e._new = true;
      draft.events.push(e); editId = e.id; view = 'edit'; status = 'Copied. Pick the new date.'; statusKind = 'ok'; render(); return;
    }
    if (a === 'close') {
      e = byId(editId); if (e) delete e._new;
      if (e && isBlank(e)) dropBlanks();
      view = 'list'; status = ''; render(); return;
    }
    if (a === 'delete') {
      e = byId(id); if (!e) return;
      if (!window.confirm('Delete "' + (e.title || 'this event') + '"? It is removed from the page when you tap Save to site.')) return;
      draft.events = draft.events.filter(function (x) { return x.id !== id; });
      view = 'list'; status = 'Deleted. Tap Save to site to make it final.'; statusKind = 'ok'; render(); return;
    }
    if (a === 'rmphoto') {
      e = byId(editId); if (!e) return;
      e.img = ''; delete e._img; var row = document.getElementById('photo-row'); if (row) row.innerHTML = photoRowHTML(e); refreshBar(); return;
    }
    if (a === 'save') { if (!busy) publish(); return; }
  });
  root.addEventListener('input', function (ev) {
    var f = ev.target && ev.target.dataset && ev.target.dataset.f; if (!f) return;
    var e = byId(editId); if (!e) return;
    e[f] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
    if (status) { status = ''; var m = root.querySelector('.msg'); if (m) m.remove(); }
    refreshBar();
  });
  root.addEventListener('change', function (ev) {
    if (!ev.target || ev.target.id !== 'f-photo') return;
    var file = ev.target.files && ev.target.files[0]; if (!file) return;
    var e = byId(editId); if (!e) return;
    readPhoto(file, function (dataUrl) {
      e._img = { dataUrl: dataUrl };
      var row = document.getElementById('photo-row'); if (row) row.innerHTML = photoRowHTML(e);
      refreshBar();
    });
  });
  window.addEventListener('beforeunload', function (ev) { if (isDirty() && !busy) { ev.preventDefault(); ev.returnValue = ''; } });

  /* ---------- start ---------- */
  cfg = readCfg();
  if (cfg) pull(); else { view = 'setup'; render(); }
})();
