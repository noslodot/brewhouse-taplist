/* Builds the tap-list slide from the data. Plain old JavaScript so older smart-TV browsers can run it. */
(function (root) {
  var DAY = 864e5;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtAbv(v) {
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    return /^\d+(\.\d+)?$/.test(v) ? v + '% ABV' : v;
  }
  function beerById(s, id) {
    for (var i = 0; i < s.beers.length; i++) if (s.beers[i].id === id) return s.beers[i];
    return null;
  }
  // "New on tap" tag lasts 7 days from the time the beer was published onto the list.
  function isNew(t) {
    return !!(t.since && (Date.now() - Date.parse(t.since)) < 7 * DAY);
  }

  function stageHTML(s) {
    var beers = s.tap.map(function (t) {
      var b = beerById(s, t.id);
      return b ? { name: b.name, style: b.style, note: b.note, abv: t.abv, nw: isNew(t) } : null;
    }).filter(Boolean);

    var rows = Math.max(1, Math.ceil(beers.length / 2));
    var rowH = Math.min(100, 530 / rows);
    var nf = Math.round(Math.min(54, rowH / 1.75));
    var sf = Math.round(nf * 0.52);

    function beerRow(b) {
      var showStyle = b.style && String(b.style).toLowerCase() !== String(b.name).toLowerCase();
      var sub = [showStyle ? b.style : '', b.note].filter(Boolean).join(' \u00b7 ');
      return '<div class="brow" style="height:' + rowH + 'px"><div class="bl"><div class="nl">' +
        '<div class="name" style="font-size:' + nf + 'px">' + esc(b.name) + '</div>' +
        (b.nw ? '<span class="new" style="font-size:' + Math.round(nf * 0.4) + 'px">New on tap</span>' : '') +
        '</div>' +
        (sub ? '<div class="sub" style="font-size:' + sf + 'px">' + esc(sub) + '</div>' : '') +
        '</div><div class="abv" style="font-size:' + Math.round(nf * 0.95) + 'px">' + esc(fmtAbv(b.abv)) + '</div></div>';
    }

    var left = beers.slice(0, rows), right = beers.slice(rows);
    var logo = s.settings.logo ? '<img src="' + esc(s.settings.logo) + '" alt="">' : '<span></span>';

    var groups = s.groups.filter(function (g) {
      return g.items.some(function (i) { return i.on; });
    });
    var gh = groups.map(function (g) {
      var items = g.items.filter(function (i) { return i.on; });
      var rh = Math.min(70, 164 / items.length);
      var f = Math.round(Math.min(44, rh / 1.25));
      return '<div class="grp"><div class="ghd">' +
        (g.logo ? '<img src="' + esc(g.logo) + '" alt="">' : '<span class="wm">' + esc(g.title) + '</span>') +
        (g.sub ? '<span class="gsub">' + esc(g.sub) + '</span>' : '') + '</div>' +
        items.map(function (i) {
          return '<div class="brow" style="height:' + rh + 'px"><div class="name" style="font-size:' + f + 'px">' + esc(i.name) +
            '</div><div class="abv" style="font-size:' + f + 'px">' + esc(fmtAbv(i.abv)) + '</div></div>';
        }).join('') + '</div>';
    }).join('');

    return '<div class="hd">' + logo + '<div><h1>' + esc(s.settings.title) + '</h1><p>' + esc(s.settings.priceLine) + '</p></div>' + logo + '</div>' +
      '<div class="beers"><div>' + left.map(beerRow).join('') + '</div><div>' + right.map(beerRow).join('') + '</div></div>' +
      '<div class="sep"></div><div class="bottom">' + gh + '</div>';
  }

  function scaleTo(stage, k, left, top) {
    var t = 'scale(' + k + ')';
    stage.style.webkitTransform = t;
    stage.style.transform = t;
    stage.style.left = left + 'px';
    stage.style.top = top + 'px';
  }
  // Fill the whole window, centered, keeping 16:9 (TV and website).
  function fitFull(stage) {
    var w = root.innerWidth, h = root.innerHeight;
    var k = Math.min(w / 1920, h / 1080);
    scaleTo(stage, k, (w - 1920 * k) / 2, (h - 1080 * k) / 2);
  }
  // Fit to the width of a container (manager preview).
  function fitWidth(box) {
    var k = box.clientWidth / 1920;
    scaleTo(box.firstChild, k, 0, 0);
    box.style.height = (1080 * k) + 'px';
  }

  root.Slide = { esc: esc, fmtAbv: fmtAbv, beerById: beerById, isNew: isNew, stageHTML: stageHTML, fitFull: fitFull, fitWidth: fitWidth };
})(typeof window !== 'undefined' ? window : this);
