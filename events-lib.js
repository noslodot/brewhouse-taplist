/* Shared helpers for the events page (events.html) and the events manager (events-manage.html).
   Dates are plain "YYYY-MM-DD" and times plain "HH:MM", always McMillin Farm local time (Pacific).
   An event is one day unless it has an "endDate" later than its "date"; then it runs from date through endDate,
   and its start/end times are the hours on each of those days. */
(function (root) {
  var TZ = 'America/Los_Angeles';
  var DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW_LONG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function str(v, max) { return (typeof v === 'string' || typeof v === 'number') ? String(v).trim().slice(0, max || 2000) : ''; }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z').getTime()); }
  function validTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  /* Only pictures kept in this repo's events-img folder are ever shown. */
  function safeImg(p) { return /^events-img\/[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i.test(p || '') ? p : ''; }

  /* "Now" in Pacific time, as {date:'2026-11-19', time:'17:50'}. */
  function pacificNow(d) {
    var f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var o = {};
    f.formatToParts(d || new Date()).forEach(function (p) { o[p.type] = p.value; });
    return { date: o.year + '-' + o.month + '-' + o.day, time: o.hour + ':' + o.minute };
  }

  /* An event is over once its end time has passed. No end time: it is over at the end of that day. */
  function lastDay(ev) { return (ev.endDate && ev.endDate > ev.date) ? ev.endDate : ev.date; }
  function isPast(ev, now) {
    var end = (ev.end && (!ev.start || ev.end >= ev.start)) ? ev.end : '23:59';
    return (lastDay(ev) + 'T' + end) < (now.date + 'T' + now.time);
  }
  function sortEvents(list) {
    return list.slice().sort(function (a, b) {
      return (a.date + 'T' + (a.start || '00:00') + a.title).localeCompare(b.date + 'T' + (b.start || '00:00') + b.title);
    });
  }

  function dateParts(date) {
    var d = new Date(date + 'T00:00:00Z');
    return {
      dow: DOW[d.getUTCDay()], dowLong: DOW_LONG[d.getUTCDay()], day: d.getUTCDate(),
      mon3: MON3[d.getUTCMonth()], month: MONTH[d.getUTCMonth()], monthKey: date.slice(0, 7), year: d.getUTCFullYear()
    };
  }
  /* What the little date box shows. One day: "FRI / 9 / JUL". Several days: "FRI–SUN / 9–11 / JUL" (or "JUL–AUG"
     when the run crosses a month). multi is true for a run, so the page can make the box's type smaller. */
  function dateBox(ev) {
    var a = dateParts(ev.date), end = lastDay(ev);
    if (end === ev.date) return { w: a.dow, d: String(a.day), m: a.mon3, multi: false };
    var b = dateParts(end);
    return { w: a.dow + '–' + b.dow, d: a.day + '–' + b.day, m: a.mon3 + (b.mon3 !== a.mon3 ? '–' + b.mon3 : ''), multi: true };
  }
  function t12(t) {
    var h = parseInt(t.slice(0, 2), 10), m = t.slice(3, 5);
    return { h: (h % 12) || 12, m: m, ap: h < 12 ? 'AM' : 'PM' };
  }
  function hm(x) { return x.h + (x.m === '00' ? '' : ':' + x.m); }
  /* "5–7 PM", "11 AM–5 PM", "5 PM", or "" */
  function fmtRange(start, end) {
    if (!validTime(start || '')) return '';
    var s = t12(start);
    if (!validTime(end || '') || end <= start) return hm(s) + ' ' + s.ap;
    var e = t12(end);
    return s.ap === e.ap ? hm(s) + '–' + hm(e) + ' ' + e.ap : hm(s) + ' ' + s.ap + '–' + hm(e) + ' ' + e.ap;
  }

  /* Coerce one event from data.json into safe strings. Returns null if it cannot be shown. */
  function cleanEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var ev = {
      id: str(raw.id, 80), title: str(raw.title, 200), date: str(raw.date, 10), endDate: str(raw.endDate, 10), start: str(raw.start, 5), end: str(raw.end, 5),
      place: str(raw.place, 200), host: str(raw.host, 120), cost: str(raw.cost, 80), desc: str(raw.desc, 4000), img: safeImg(str(raw.img, 200)),
      featured: raw.featured === true
    };
    if (!ev.title || !validDate(ev.date)) return null;
    if (!validDate(ev.endDate) || ev.endDate <= ev.date) ev.endDate = '';   // only a later last day makes a run
    if (!validTime(ev.start)) ev.start = '';
    if (!validTime(ev.end)) ev.end = '';
    return ev;
  }
  function cleanData(raw) {
    var d = (raw && typeof raw === 'object') ? raw : {};
    var s = (d.settings && typeof d.settings === 'object') ? d.settings : {};
    var list = Array.isArray(d.events) ? d.events.slice(0, 500) : [];
    return {
      settings: { title: str(s.title, 120) || 'Upcoming Events', place: str(s.place, 200) },
      events: list.map(cleanEvent).filter(Boolean),
      updated: str(d.updated, 40)
    };
  }

  /* Events with the same name on consecutive days are one multi-day event: they get "Day One", "Day Two", ...
     Pass the whole sorted list (past ones included) so a surviving day keeps its label. */
  var DAY_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
  function nextDay(date) { var d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
  function labelDays(sorted) {
    var i = 0;
    while (i < sorted.length) {
      var j = i, key = sorted[i].title.toLowerCase();
      while (j + 1 < sorted.length && sorted[j + 1].title.toLowerCase() === key && sorted[j + 1].date === nextDay(sorted[j].date)) j++;
      for (var k = i; k <= j; k++) sorted[k].dayLabel = j > i ? 'Day ' + (DAY_WORDS[k - i] || (k - i + 1)) : '';
      i = j + 1;
    }
    return sorted;
  }

  root.EventsLib = {
    esc: esc, str: str, validDate: validDate, validTime: validTime, safeImg: safeImg, pacificNow: pacificNow, isPast: isPast,
    sortEvents: sortEvents, labelDays: labelDays, dateParts: dateParts, dateBox: dateBox, lastDay: lastDay, fmtRange: fmtRange, cleanEvent: cleanEvent, cleanData: cleanData
  };
})(window);
