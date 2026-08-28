/* -----------------------------------------------------------------------------
 * console.js — the desk tool for sales and aftersales.
 *
 * Shares everything factual with the office display: the same store, the same
 * feeds, the same chart renderer, the same fleet file. What differs is the job.
 * The board is glanced at and never touched; this is opened in the morning and
 * worked through, so it leads with what needs attention rather than with where
 * everything is.
 *
 * Full detail is the point here, which is why discretion is a deliberate,
 * visible act rather than the default: the redacted install is index.html with
 * discreetLocked set, on a machine a passer-by cannot talk out of it.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var App = { selected: null, filter: 'all', query: '' };
  var el = function (id) { return document.getElementById(id); };

  var CHART_FPS = 20;
  var RAIL_MIN_INTERVAL_MS = 3000;

  /* --- Small DOM helpers -------------------------------------------------- */

  function h(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function statusVar(status) {
    return 'var(--status-' + (status === 'unknown' ? 'dark' : status) + ')';
  }

  // Their own service lines, in the charter's colours. Always beside the line's
  // name, so the colour identifies rather than carries the meaning.
  var LINE_COLOUR = { AV: '#93509E', IT: '#64A0C8', Security: '#80DED6' };

  /* --- Boot ---------------------------------------------------------------- */

  function boot() {
    window.Store.init(window.FLEET);
    window.FleetMap.init(el('chart-canvas'));
    renderBrand();

    window.Store.subscribe(onStoreChange);
    startFeed();
    window.Weather.start();

    el('search').addEventListener('input', function (e) {
      App.query = e.target.value.trim().toLowerCase();
      renderRail(true);
    });
    el('rail-list').addEventListener('click', onRailClick);
    el('work').addEventListener('click', onWorkClick);
    el('filters').addEventListener('click', onFilterClick);
    el('chart-canvas').addEventListener('click', onChartClick);
    el('clear-selection').addEventListener('click', function () { select(null); });
    el('discreet-toggle').addEventListener('click', toggleDiscreet);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', function () {
      window.FleetMap.resize();
      window.FleetMap.readTheme();
    });

    setInterval(function () { window.Store.recompute(); }, 1000);
    setInterval(function () { window.Store.persist(); }, 30000);
    setInterval(tickClock, 1000);
    tickClock();

    window.Store.recompute();
    renderFilters();
    renderRail(true);
    renderWork();
    aimChart();
    window.FleetMap.snap();
    requestAnimationFrame(frame);
  }

  function startFeed() {
    var key = (window.CONFIG.aisStreamApiKey || '').trim();
    if (key) {
      window.Store.mode = 'live';
      window.Ais.start(key, window.FLEET.map(function (y) { return y.mmsi; }));
    } else {
      window.Store.mode = 'demo';
      window.Demo.start(window.Store.vessels);
    }
  }

  function renderBrand() {
    var host = el('brand');
    var cfg = window.CONFIG;
    host.textContent = '';
    el('brand-locations').textContent = cfg.brandLocations || '';

    if (cfg.brandLogo) {
      var img = document.createElement('img');
      img.src = cfg.brandLogo;
      img.alt = cfg.brand || '';
      img.onerror = function () { cfg.brandLogo = null; renderBrand(); };
      host.appendChild(img);
      return;
    }
    var name = cfg.brand || '';
    var split = cfg.brandPowerMark ? name.indexOf('O') : -1;
    if (split < 0) { host.textContent = name; return; }
    host.appendChild(document.createTextNode(name.slice(0, split)));
    host.appendChild(powerMark());
    host.appendChild(document.createTextNode(name.slice(split + 1)));
  }

  function powerMark() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'power-o');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    var ring = document.createElementNS(NS, 'path');
    ring.setAttribute('d', 'M 59.1 22.9 A 33 33 0 1 1 40.9 22.9');
    svg.appendChild(ring);
    var bar = document.createElementNS(NS, 'line');
    bar.setAttribute('x1', '50'); bar.setAttribute('y1', '8');
    bar.setAttribute('x2', '50'); bar.setAttribute('y2', '42');
    svg.appendChild(bar);
    return svg;
  }

  /* --- What needs attention ------------------------------------------------ */

  // One model, used by the tiles, the rail badges and the attention list, so a
  // yacht flagged in one place is flagged in all of them.
  function attentionFor(v) {
    var cfg = window.CONFIG.fleetConsole;
    var now = new Date();
    var s = v.yacht.service || {};
    var items = [];

    if (s.nextEventDate) {
      var until = window.Fmt.until(s.nextEventDate, now);
      if (until.overdue) {
        items.push({ vessel: v, kind: 'event', severity: 'overdue', label: s.nextEvent,
                     date: new Date(s.nextEventDate), note: until.text });
      } else if (until.days != null && until.days <= cfg.attentionDays) {
        items.push({ vessel: v, kind: 'event', severity: 'due', label: s.nextEvent,
                     date: new Date(s.nextEventDate), note: until.text });
      }
    }

    if (s.urgentJobs) {
      items.push({ vessel: v, kind: 'job', severity: 'overdue',
                   label: s.urgentJobs + (s.urgentJobs === 1 ? ' urgent job' : ' urgent jobs'),
                   date: now, note: 'open' });
    }

    (s.partsOnOrder || []).forEach(function (part) {
      var until = window.Fmt.until(part.eta, now);
      if (until.days != null && until.days <= 7) {
        items.push({ vessel: v, kind: 'part', severity: until.overdue ? 'overdue' : 'due',
                     label: part.item, date: new Date(part.eta),
                     note: until.text + ' · ' + part.port, port: part.port });
      }
    });

    if (s.yardPeriod) {
      var yardUntil = window.Fmt.until(s.yardPeriod.to, now);
      if (yardUntil.days != null && yardUntil.days <= cfg.attentionDays) {
        items.push({ vessel: v, kind: 'yard', severity: 'due',
                     label: s.yardPeriod.yard + ' — yard period ends',
                     date: new Date(s.yardPeriod.to), note: yardUntil.text });
      }
    }

    return items;
  }

  function allAttention() {
    var out = [];
    window.Store.vessels.forEach(function (v) { out = out.concat(attentionFor(v)); });
    var rank = { overdue: 0, due: 1 };
    return out.sort(function (a, b) {
      return (rank[a.severity] - rank[b.severity]) || (a.date - b.date);
    });
  }

  // Systems past the age at which they are worth a conversation. The sales list.
  function upgradeCandidates() {
    var thresholds = window.CONFIG.fleetConsole.systemAgeYears;
    var now = Date.now();
    var out = [];
    window.Store.vessels.forEach(function (v) {
      (v.yacht.systems || []).forEach(function (sys) {
        if (!sys.installed) return;
        var years = (now - new Date(sys.installed)) / 31557600000;
        var limit = thresholds[sys.line];
        if (limit != null && years >= limit) {
          out.push({ vessel: v, system: sys, years: years, limit: limit });
        }
      });
    });
    return out.sort(function (a, b) { return b.years - a.years; });
  }

  function systemAge(sys) {
    if (!sys.installed) return null;
    return (Date.now() - new Date(sys.installed)) / 31557600000;
  }

  /* --- Rail ---------------------------------------------------------------- */

  var FILTERS = [
    ['all', 'All'],
    ['attention', 'Needs attention'],
    ['underway', 'Underway'],
    ['anchored', 'At anchor'],
    ['moored', 'Alongside'],
    ['refit', 'In refit'],
    ['dark', 'No signal']
  ];

  function renderFilters() {
    var host = el('filters');
    host.textContent = '';
    FILTERS.forEach(function (f) {
      var button = h('button', 'chip-filter');
      button.type = 'button';
      button.dataset.filter = f[0];
      button.setAttribute('aria-pressed', String(App.filter === f[0]));
      if (f[0] !== 'all' && f[0] !== 'attention') {
        var swatch = h('span', 'swatch');
        swatch.style.background = statusVar(f[0]);
        button.appendChild(swatch);
      }
      button.appendChild(document.createTextNode(f[1]));
      button.appendChild(h('span', 'n', String(countFor(f[0]))));
      host.appendChild(button);
    });
  }

  function countFor(filter) {
    return window.Store.vessels.filter(function (v) { return matchesFilter(v, filter); }).length;
  }

  function matchesFilter(v, filter) {
    if (filter === 'all') return true;
    if (filter === 'attention') return attentionFor(v).length > 0;
    return v.derived.status === filter;
  }

  function matchesQuery(v) {
    if (!App.query) return true;
    var y = v.yacht;
    var hay = [
      y.name, y.prefix, y.flag, y.flagCode, y.callSign, y.builder, y.classSociety,
      String(y.imo), String(y.mmsi),
      v.derived.port ? v.derived.port.name : '',
      y.service ? y.service.engineer : '',
      (y.systems || []).map(function (s) { return s.line + ' ' + (s.product || ''); }).join(' ')
    ].join(' ').toLowerCase();
    return hay.indexOf(App.query) !== -1;
  }

  function visibleVessels() {
    return window.Store.vessels.filter(function (v) {
      return matchesFilter(v, App.filter) && matchesQuery(v);
    }).sort(function (a, b) {
      var d = attentionFor(b).length - attentionFor(a).length;
      return d || a.yacht.name.localeCompare(b.yacht.name);
    });
  }

  var lastRailRender = 0;

  function renderRail(force) {
    var now = Date.now();
    if (!force && now - lastRailRender < RAIL_MIN_INTERVAL_MS) return;
    lastRailRender = now;

    // Rebuilding the list throws away focus; put it back where it was.
    var focused = document.activeElement;
    var focusedId = focused && focused.dataset ? focused.dataset.yachtId : null;

    var host = el('rail-list');
    host.textContent = '';
    var list = visibleVessels();

    list.forEach(function (v) {
      var attention = attentionFor(v);
      var urgent = attention.some(function (a) { return a.severity === 'overdue'; });

      var row = h('button', 'vessel-row');
      row.type = 'button';
      row.dataset.yachtId = v.yacht.id;
      if (App.selected === v.yacht.id) row.setAttribute('aria-current', 'true');

      var marker = h('span', 'marker');
      marker.style.background = statusVar(v.derived.status);
      if (v.derived.status === 'dark') {
        marker.style.background = 'transparent';
        marker.style.boxShadow = 'inset 0 0 0 2px ' + statusVar('dark');
      }
      row.appendChild(marker);
      row.appendChild(h('span', 'v-name', v.yacht.name));

      if (attention.length) {
        row.appendChild(h('span', 'v-flagcount' + (urgent ? ' urgent' : ''), String(attention.length)));
      } else {
        row.appendChild(h('span'));
      }

      row.appendChild(h('span', 'v-where', whereText(v)));
      host.appendChild(row);

      if (focusedId === v.yacht.id) row.focus();
    });

    if (!list.length) {
      host.appendChild(h('div', 'empty', App.query
        ? 'No vessel matches “' + App.query + '”.'
        : 'No vessel in this state.'));
    }

    el('rail-foot').textContent = list.length + ' of ' + window.Store.vessels.length + ' vessels';
    renderFilters();
  }

  function whereText(v) {
    var d = v.derived;
    if (d.lat == null) return 'Position unknown';
    if (!d.port) return window.Fmt.latitude(d.lat) + '  ' + window.Fmt.longitude(d.lon);
    if (d.discreet) return 'In the area of ' + d.port.name;
    if (d.port.distanceNm < 1.2) return 'At ' + d.port.name;
    return window.Fmt.distance(d.port.distanceNm) + ' ' + d.port.compass + ' of ' + d.port.name;
  }

  /* --- Work column --------------------------------------------------------- */

  function renderWork() {
    var host = el('work');
    host.textContent = '';
    var v = selectedVessel();
    if (v) renderDetail(host, v); else renderOverview(host);
  }

  function selectedVessel() {
    if (!App.selected) return null;
    for (var i = 0; i < window.Store.vessels.length; i++) {
      if (window.Store.vessels[i].yacht.id === App.selected) return window.Store.vessels[i];
    }
    return null;
  }

  function renderOverview(host) {
    var attention = allAttention();
    var overdue = attention.filter(function (a) { return a.severity === 'overdue'; });
    var summary = window.Store.summary();
    var upgrades = upgradeCandidates();
    var parts = attention.filter(function (a) { return a.kind === 'part'; });

    var tiles = h('div', 'tile-row');
    tiles.appendChild(tile('Overdue', overdue.length, overdue.length ? 'needs action now' : 'nothing overdue',
      overdue.length ? 'alert' : ''));
    tiles.appendChild(tile('Due soon', attention.length - overdue.length,
      'within ' + window.CONFIG.fleetConsole.attentionDays + ' days',
      (attention.length - overdue.length) ? 'warn' : ''));
    tiles.appendChild(tile('Open jobs', summary.openJobs,
      summary.urgentJobs ? summary.urgentJobs + ' urgent' : 'none urgent'));
    tiles.appendChild(tile('Parts landing', parts.length, 'within 7 days'));
    tiles.appendChild(tile('Upgrade leads', upgrades.length, 'systems past their age'));
    host.appendChild(tiles);

    // Needs attention
    var panel = h('div', 'panel');
    panel.appendChild(h('div', 'pane-title', 'Needs attention'));
    var rows = h('div', 'rows');
    if (!attention.length) {
      rows.appendChild(h('div', 'empty', 'Nothing outstanding across the fleet.'));
    }
    attention.forEach(function (item) {
      rows.appendChild(attentionRow(item));
    });
    panel.appendChild(rows);
    host.appendChild(panel);

    // Upgrade opportunities
    var sales = h('div', 'panel');
    sales.appendChild(h('div', 'pane-title', 'Upgrade conversations'));
    var salesRows = h('div', 'rows');
    if (!upgrades.length) {
      salesRows.appendChild(h('div', 'empty', 'Every installed system is inside its expected life.'));
    }
    upgrades.forEach(function (u) {
      var row = h('div', 'row clickable');
      row.dataset.yachtId = u.vessel.yacht.id;
      var main = h('div', 'r-main');
      main.appendChild(lineBadge(u.system.line));
      main.appendChild(document.createTextNode('  ' + u.vessel.yacht.name));
      row.appendChild(main);
      var chip = h('span', 'chip due');
      chip.appendChild(h('span', null, u.years.toFixed(0) + ' yrs'));
      row.appendChild(chip);
      row.appendChild(h('div', 'r-sub',
        (u.system.product || 'System') + ' · installed ' + window.Fmt.shortDate(u.system.installed) +
        ' · past ' + u.limit + '-year mark'));
      salesRows.appendChild(row);
    });
    sales.appendChild(salesRows);
    host.appendChild(sales);
  }

  function attentionRow(item) {
    var row = h('div', 'row clickable');
    row.dataset.yachtId = item.vessel.yacht.id;
    row.appendChild(h('div', 'r-main', item.label));
    var chipClass = item.severity === 'overdue' ? 'overdue'
                  : item.kind === 'part' ? 'part'
                  : item.kind === 'yard' ? 'yard' : 'due';
    var chip = h('span', 'chip ' + chipClass);
    chip.appendChild(h('span', null, glyphFor(item.kind, item.severity)));
    chip.appendChild(h('span', null, item.note));
    row.appendChild(chip);

    var sub = window.Fmt.fullName(item.vessel.yacht);
    if (item.kind === 'part' && item.port) {
      var d = item.vessel.derived;
      sub += d.port && d.port.name === item.port
        ? ' · already at ' + item.port
        : ' · currently ' + whereText(item.vessel);
    } else {
      sub += ' · ' + whereText(item.vessel);
    }
    row.appendChild(h('div', 'r-sub', sub));
    return row;
  }

  function glyphFor(kind, severity) {
    if (severity === 'overdue') return '!';
    if (kind === 'part') return '⬤';
    if (kind === 'yard') return '⚓';
    return '▲';
  }

  function tile(label, figure, note, variant) {
    var node = h('div', 'tile' + (variant ? ' ' + variant : ''));
    node.appendChild(h('div', 'label', label));
    node.appendChild(h('div', 'figure', String(figure)));
    if (note) node.appendChild(h('div', 'note', note));
    return node;
  }

  function lineBadge(line) {
    var badge = h('span', 'line-badge');
    var swatch = h('span', 'swatch');
    swatch.style.background = LINE_COLOUR[line] || 'var(--text-muted)';
    badge.appendChild(swatch);
    badge.appendChild(document.createTextNode(line));
    return badge;
  }

  /* --- Vessel detail ------------------------------------------------------- */

  function renderDetail(host, v) {
    var y = v.yacht, d = v.derived, s = y.service || {};

    var head = h('div', 'detail-head');
    var titleBlock = h('div');
    titleBlock.appendChild(h('div', 'eyebrow', y.prefix + ' · ' + y.flag));
    titleBlock.appendChild(h('h1', null, y.name));
    head.appendChild(titleBlock);

    var pill = h('span', 'state-pill');
    pill.style.color = statusVar(d.status);
    var swatch = h('span', 'swatch');
    pill.appendChild(swatch);
    pill.appendChild(h('span', null, window.Fmt.statusLabel(d.status)));
    head.appendChild(pill);
    host.appendChild(head);

    var spec = h('div', 'detail-spec');
    [[y.loa.toFixed(1) + ' m', 'LOA'], [y.beam ? y.beam.toFixed(1) + ' m' : '—', 'beam'],
     [y.grossTonnage ? y.grossTonnage.toLocaleString() + ' GT' : '—', ''],
     [String(y.yearBuilt), 'built'], [y.lastRefit ? String(y.lastRefit) : '—', 'refit'],
     ['IMO ' + y.imo, ''], ['MMSI ' + y.mmsi, ''], [y.classSociety || '—', ''],
     [y.builder || '—', '']
    ].forEach(function (pair) {
      var span = h('span');
      span.appendChild(h('b', null, pair[0]));
      if (pair[1]) span.appendChild(document.createTextNode(' ' + pair[1]));
      spec.appendChild(span);
    });
    host.appendChild(spec);

    // Attention for this vessel first — it is why you opened the record.
    var attention = attentionFor(v);
    if (attention.length) {
      var alertPanel = h('div', 'panel');
      alertPanel.appendChild(h('div', 'pane-title', 'Needs attention'));
      var alertRows = h('div', 'rows');
      attention.forEach(function (item) {
        var row = h('div', 'row');
        row.appendChild(h('div', 'r-main', item.label));
        var chip = h('span', 'chip ' + (item.severity === 'overdue' ? 'overdue' : 'due'));
        chip.appendChild(h('span', null, glyphFor(item.kind, item.severity)));
        chip.appendChild(h('span', null, item.note));
        row.appendChild(chip);
        alertRows.appendChild(row);
      });
      alertPanel.appendChild(alertRows);
      host.appendChild(alertPanel);
    }

    // Service
    var servicePanel = h('div', 'panel');
    servicePanel.appendChild(h('div', 'pane-title', 'Service'));
    var serviceRows = h('div', 'rows');
    serviceRows.appendChild(kvRow('Next event', s.nextEvent || '—',
      s.nextEventDate ? window.Fmt.date(s.nextEventDate) + ' · ' + window.Fmt.until(s.nextEventDate).text : null));
    serviceRows.appendChild(kvRow('Open jobs', String(s.openJobs != null ? s.openJobs : '—'),
      s.urgentJobs ? s.urgentJobs + ' urgent' : null));
    serviceRows.appendChild(kvRow('Engineer', s.engineer || '—', null));
    if (s.yardPeriod) {
      serviceRows.appendChild(kvRow('Yard period', s.yardPeriod.yard,
        window.Fmt.shortDate(s.yardPeriod.from) + ' – ' + window.Fmt.shortDate(s.yardPeriod.to)));
    }
    (s.partsOnOrder || []).forEach(function (part) {
      serviceRows.appendChild(kvRow('Part on order', part.item,
        window.Fmt.shortDate(part.eta) + ' · ' + part.port));
    });
    if (!(s.partsOnOrder || []).length) {
      serviceRows.appendChild(kvRow('Parts on order', 'None', null));
    }
    servicePanel.appendChild(serviceRows);
    host.appendChild(servicePanel);

    // Installed systems
    var sysPanel = h('div', 'panel');
    sysPanel.appendChild(h('div', 'pane-title', 'Installed systems'));
    var sysList = h('div', 'systems');
    var thresholds = window.CONFIG.fleetConsole.systemAgeYears;
    (y.systems || []).forEach(function (sys) {
      var row = h('div', 'system-row');
      row.appendChild(lineBadge(sys.line));
      row.appendChild(h('div', 's-product', sys.product || 'Not installed'));
      var age = systemAge(sys);
      var limit = thresholds[sys.line];
      var ageNode;
      if (age == null) {
        ageNode = h('div', 's-age none', '—');
      } else {
        var flagged = limit != null && age >= limit;
        ageNode = h('div', 's-age' + (flagged ? ' flag' : ''),
          age.toFixed(1) + ' yrs' + (flagged ? '  ▲' : ''));
        ageNode.title = 'Installed ' + window.Fmt.date(sys.installed);
      }
      row.appendChild(ageNode);
      sysList.appendChild(row);
    });
    if (!(y.systems || []).length) sysList.appendChild(h('div', 'empty', 'No systems recorded.'));
    sysPanel.appendChild(sysList);
    host.appendChild(sysPanel);

    // Contacts — console only, never on the office display.
    if ((y.contacts || []).length) {
      var contactPanel = h('div', 'panel');
      contactPanel.appendChild(h('div', 'pane-title', 'Aboard'));
      var contactRows = h('div', 'rows');
      y.contacts.forEach(function (c) {
        contactRows.appendChild(kvRow(c.role, c.name, c.email || c.phone || null));
      });
      contactPanel.appendChild(contactRows);
      host.appendChild(contactPanel);
    }
  }

  // Label first, value second. The other way round — value large on the left
  // with the field name as a chip on the right — reads as a tag on a thing
  // rather than as a field, and you cannot scan a column of them.
  function kvRow(key, value, sub) {
    var row = h('div', 'field');
    row.appendChild(h('div', 'f-key', key));
    row.appendChild(h('div', 'f-value', value));
    if (sub) row.appendChild(h('div', 'f-sub', sub));
    return row;
  }

  /* --- Chart pane ---------------------------------------------------------- */

  function aimChart() {
    var v = selectedVessel();
    if (v && v.derived.lat != null) {
      var rect = el('chart-canvas').getBoundingClientRect();
      var degreesWanted = 420 / 60 / Math.max(0.2, Math.cos(v.derived.lat * Math.PI / 180));
      window.FleetMap.centreOn(v.derived.lon, v.derived.lat, 360 * rect.width / degreesWanted);
    } else {
      window.FleetMap.fit(window.Store.vessels
        .filter(function (x) { return x.derived.lat != null; })
        .map(function (x) { return [x.derived.lon, x.derived.lat]; }), 40);
    }
  }

  function renderReadout() {
    var host = el('chart-readout');
    host.textContent = '';
    var v = selectedVessel();

    if (!v) {
      var summary = window.Store.summary();
      var grid = h('div', 'readout-grid');
      grid.appendChild(readoutCell('Reporting', summary.tracked + ' of ' + summary.total));
      grid.appendChild(readoutCell('Underway', String(summary.counts.underway || 0)));
      grid.appendChild(readoutCell('In refit', String(summary.counts.refit || 0)));
      grid.appendChild(readoutCell('Run, 7 days', window.Fmt.distance(summary.distance7d)));
      host.appendChild(grid);
      return;
    }

    var d = v.derived;
    host.appendChild(h('div', 'readout-line',
      d.lat == null ? 'No position'
        : d.discreet ? 'Position withheld'
        : window.Fmt.latitude(d.lat) + '   ' + window.Fmt.longitude(d.lon)));
    host.appendChild(h('div', 'readout-sub', whereText(v)));

    var age = h('div', 'readout-age' + (d.dark ? ' dark' : d.stale ? ' stale' : ''));
    var parts = [window.Fmt.statusLabel(d.status)];
    if (d.status === 'underway' && v.fix && !d.discreet) {
      parts.push(window.Fmt.speed(v.fix.sog) + ' · ' + window.Fmt.bearing(v.fix.cog));
    }
    parts.push('fix ' + window.Fmt.age(v.fix && v.fix.at));
    age.textContent = parts.join('  ·  ');
    host.appendChild(age);

    var grid2 = h('div', 'readout-grid');
    var w = v.weather;
    if (w) {
      var beaufort = window.Weather.beaufort(w.windSpeed);
      grid2.appendChild(readoutCell('Wind', window.Fmt.windSpeed(w.windSpeed) +
        (beaufort ? ' F' + beaufort.force : '')));
      grid2.appendChild(readoutCell('Air', window.Fmt.temperature(w.airTemp)));
      if (w.marineAvailable) {
        grid2.appendChild(readoutCell('Sea', window.Fmt.waveHeight(w.waveHeight)));
        grid2.appendChild(readoutCell('Water', window.Fmt.temperature(w.seaTemp)));
      }
    } else if (!window.CONFIG.weather.enabled) {
      grid2.appendChild(readoutCell('Conditions', 'Lookup off'));
    } else {
      grid2.appendChild(readoutCell('Conditions', 'Loading…'));
    }
    if (d.localTime) grid2.appendChild(readoutCell('Local time', d.localTime.text));
    if (d.fromOffice != null) {
      grid2.appendChild(readoutCell('From ' + window.CONFIG.office.label, window.Fmt.distance(d.fromOffice)));
    }
    host.appendChild(grid2);
  }

  function readoutCell(key, value) {
    var cell = h('div');
    cell.appendChild(h('span', 'k', key));
    cell.appendChild(h('span', 'v', value));
    return cell;
  }

  var lastChartFrame = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastChartFrame < 1000 / CHART_FPS) return;
    lastChartFrame = now;
    // No ambient drift here — a tool that wanders under the pointer is a
    // nuisance, whatever it does for a wall.
    window.FleetMap.render(now, window.Store.vessels, {
      highlight: App.selected,
      noDrift: true
    });
  }

  /* --- Interaction --------------------------------------------------------- */

  function select(yachtId) {
    App.selected = yachtId;
    el('chart-title').textContent = yachtId
      ? (selectedVessel() ? window.Fmt.fullName(selectedVessel().yacht) : 'Fleet')
      : 'Fleet';
    el('clear-selection').hidden = !yachtId;
    renderRail(true);
    renderWork();
    renderReadout();
    aimChart();
  }

  function onRailClick(event) {
    var row = event.target.closest('.vessel-row');
    if (row && row.dataset.yachtId) select(row.dataset.yachtId);
  }

  function onWorkClick(event) {
    var row = event.target.closest('[data-yacht-id]');
    if (row && row.dataset.yachtId) select(row.dataset.yachtId);
  }

  function onFilterClick(event) {
    var button = event.target.closest('.chip-filter');
    if (!button) return;
    App.filter = button.dataset.filter;
    renderRail(true);
  }

  function onChartClick(event) {
    var rect = el('chart-canvas').getBoundingClientRect();
    var vessel = window.FleetMap.hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (vessel) select(vessel.yacht.id);
  }

  // Discretion here is a visible, deliberate act with an unmissable banner —
  // the opposite of the office display, where it is locked on at install.
  function toggleDiscreet() {
    window.CONFIG.discreetMode = !window.CONFIG.discreetMode;
    var button = el('discreet-toggle');
    button.setAttribute('aria-pressed', String(window.CONFIG.discreetMode));

    var existing = document.querySelector('.discreet-banner');
    if (window.CONFIG.discreetMode && !existing) {
      var banner = h('div', 'discreet-banner',
        'Discreet mode — positions shown as areas, tracks and destinations withheld');
      el('console').insertBefore(banner, el('console').children[1]);
    } else if (!window.CONFIG.discreetMode && existing) {
      existing.remove();
    }

    window.Store.recompute();
    renderRail(true);
    renderWork();
    renderReadout();
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      if (document.activeElement === el('search') && App.query) {
        el('search').value = '';
        App.query = '';
        renderRail(true);
      } else if (App.selected) {
        select(null);
      }
      return;
    }
    // "/" focuses search, as it does everywhere else.
    if (event.key === '/' && document.activeElement !== el('search')) {
      event.preventDefault();
      el('search').focus();
    }
  }

  function tickClock() {
    el('clock').textContent = window.Fmt.clock(new Date(), window.CONFIG.office.timeZone);
  }

  function onStoreChange(store) {
    var pill = el('connection');
    pill.dataset.state = store.connection;
    el('connection-label').textContent = {
      demo: 'Demo data', open: 'Live AIS', connecting: 'Connecting',
      retrying: 'Reconnecting', closed: 'Offline', starting: 'Starting'
    }[store.connection] || store.connection;

    renderRail(false);
    renderReadout();
    if (App.selected) aimChart();
  }

  window.FleetConsole = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
