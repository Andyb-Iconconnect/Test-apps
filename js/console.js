/* -----------------------------------------------------------------------------
 * console.js — the desk tool for looking a vessel up.
 *
 * Shares everything factual with the office display: the same store, the same
 * feeds, the same chart renderer, the same fleet file. What differs is the job.
 * The board is glanced at and never touched; this is opened when someone needs
 * to answer "where is she", so it can be searched, filtered and read in full.
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

  /* --- Boot ---------------------------------------------------------------- */

  // fleet.js as shipped, kept apart from anything added in this browser so the
  // two never compound on a reload.
  var BASE_FLEET = null;

  /**
   * fleet.js is hand-edited, and a missing bracket there takes the whole file
   * with it: the script throws, `window.FLEET` never gets defined, and the board
   * boots into nothing at all. Silence is the worst possible answer to that, so
   * say what happened and how to find it.
   */
  function fleetLoaded(where) {
    if (Array.isArray(window.FLEET) && window.FLEET.length) return true;
    var missing = typeof window.FLEET === 'undefined';
    document.body.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'boot-error';
    box.innerHTML =
      '<h1>' + (missing ? 'fleet.js did not load' : 'fleet.js has no vessels in it') + '</h1>' +
      '<p>' + (missing
        ? 'The file threw before it could define the fleet — almost always an ' +
          'unclosed bracket or a missing comma. Nothing else on ' + where + ' can start until it parses.'
        : 'The file loaded and parsed, but <code>window.FLEET</code> is an empty list.') +
      '</p>' +
      '<p>Check it with:</p><pre>node --check fleet.js</pre>' +
      '<p>The browser console has the line number too.</p>';
    document.body.appendChild(box);
    return false;
  }

  function boot() {
    if (!fleetLoaded('the console')) return;
    BASE_FLEET = window.FLEET.slice();
    window.FLEET = window.Vessel.mergedFleet(BASE_FLEET);
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
    wireAddDialog();
    wireRemoveDialog();
    wireFileDialog();
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
    renderHiddenNote();
    renderSaveButton();
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

  /* --- Rail ---------------------------------------------------------------- */

  var FILTERS = [
    ['all', 'All'],
    ['underway', 'Underway'],
    ['anchored', 'At anchor'],
    ['moored', 'Alongside'],
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
      if (f[0] !== 'all') {
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
    return v.derived.status === filter;
  }

  function matchesQuery(v) {
    if (!App.query) return true;
    var y = v.yacht;
    var hay = [
      y.name, y.prefix, y.flag, y.flagCode, y.callSign, y.builder, y.classSociety,
      String(y.imo), String(y.mmsi),
      v.derived.port ? v.derived.port.name : ''
    ].join(' ').toLowerCase();
    return hay.indexOf(App.query) !== -1;
  }

  function visibleVessels() {
    return window.Store.vessels.filter(function (v) {
      return matchesFilter(v, App.filter) && matchesQuery(v);
    }).sort(function (a, b) {
      return a.yacht.name.localeCompare(b.yacht.name);
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
      var nameCell = h('span', 'v-name', v.yacht.name);
      if (v.yacht.addedLocally) nameCell.appendChild(h('span', 'local-dot'));
      row.appendChild(nameCell);

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

  var OVERVIEW_STATES = [
    ['underway', 'Underway'],
    ['anchored', 'At anchor'],
    ['moored', 'Alongside'],
    ['dark', 'No signal']
  ];

  function renderOverview(host) {
    var summary = window.Store.summary();

    var tiles = h('div', 'tile-row');
    OVERVIEW_STATES.forEach(function (pair) {
      tiles.appendChild(tile(pair[1], summary.counts[pair[0]] || 0,
        'of ' + summary.total, pair[0] === 'dark' && summary.counts.dark ? 'warn' : ''));
    });
    tiles.appendChild(tile('Reporting', summary.tracked + ' of ' + summary.total,
      summary.tracked === summary.total ? 'all of them' : 'the rest are dark',
      summary.tracked < summary.total ? 'warn' : ''));
    host.appendChild(tiles);

    // The whole fleet in one table: where each one is, and how far off she is.
    // The rail beside this is filtered and searched; this is not.
    var panel = h('div', 'panel');
    panel.appendChild(h('div', 'pane-title', 'Where the fleet is'));
    var rows = h('div', 'rows');

    var byDistance = window.Store.vessels.slice().sort(function (a, b) {
      var da = a.derived.fromOffice, db = b.derived.fromOffice;
      if (da == null && db == null) return a.yacht.name.localeCompare(b.yacht.name);
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });

    if (!byDistance.length) {
      rows.appendChild(h('div', 'empty', 'No vessels in fleet.js.'));
    }
    byDistance.forEach(function (v) {
      var d = v.derived;
      var row = h('div', 'row clickable');
      row.dataset.yachtId = v.yacht.id;

      var main = h('div', 'r-main', v.yacht.name);
      row.appendChild(main);

      var chip = h('span', 'state-pill');
      chip.style.color = statusVar(d.status);
      var swatch = h('span', 'swatch');
      swatch.style.background = statusVar(d.status);
      chip.appendChild(swatch);
      chip.appendChild(h('span', null, window.Fmt.statusLabel(d.status)));
      row.appendChild(chip);

      var sub = whereText(v);
      if (d.fromOffice != null) {
        sub += '  ·  ' + window.Fmt.distance(d.fromOffice) + ' from ' + window.CONFIG.office.label;
      }
      sub += '  ·  fix ' + window.Fmt.age(v.fix && v.fix.at);
      row.appendChild(h('div', 'r-sub', sub));
      rows.appendChild(row);
    });
    panel.appendChild(rows);
    host.appendChild(panel);
  }

  function tile(label, figure, note, variant) {
    var node = h('div', 'tile' + (variant ? ' ' + variant : ''));
    node.appendChild(h('div', 'label', label));
    node.appendChild(h('div', 'figure', String(figure)));
    if (note) node.appendChild(h('div', 'note', note));
    return node;
  }

  function vesselVisual(y) {
    var band = h('div', 'detail-profile');
    // A drawing knows its own proportions and the band takes them. A photograph
    // does not: cover-cropping one into the drawing's long, low frame would cut
    // the masthead off the top and the waterline off the bottom, so photographs
    // get an ordinary landscape band instead.
    band.style.aspectRatio = String(y.photo ? 16 / 9 : window.Profile.frameAspect(y));

    function drawn() {
      band.textContent = '';
      band.style.aspectRatio = String(window.Profile.frameAspect(y));
      band.appendChild(window.Profile.create(y));
      band.appendChild(h('div', 'detail-profile-note', 'Illustration — add a photo in fleet.js'));
    }

    if (y.photo) {
      var img = document.createElement('img');
      img.src = y.photo;
      img.alt = window.Fmt.text(y.prefix) + ' ' + y.name;
      img.addEventListener('error', drawn);
      band.appendChild(img);
    } else {
      drawn();
    }
    return band;
  }

  function renderDetail(host, v) {
    var y = v.yacht, d = v.derived;

    var head = h('div', 'detail-head');
    var titleBlock = h('div');
    titleBlock.appendChild(h('div', 'eyebrow',
      window.Fmt.text(y.prefix) + ' · ' + window.Fmt.text(y.flag)));
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
    [[window.Fmt.metres(y.loa), 'LOA'], [window.Fmt.metres(y.beam), 'beam'],
     [window.Fmt.tonnage(y.grossTonnage), ''],
     [window.Fmt.year(y.yearBuilt), 'built'], [window.Fmt.year(y.lastRefit), 'refit'],
     ['IMO ' + window.Fmt.text(y.imo), ''], ['MMSI ' + window.Fmt.text(y.mmsi), ''],
     [window.Fmt.text(y.classSociety), ''], [window.Fmt.text(y.builder), '']
    ].filter(function (pair) {
      // A sparse record otherwise reads as a row of em dashes. Show what is
      // known and say nothing about the rest.
      return pair[0] && pair[0].indexOf('—') === -1;
    }).forEach(function (pair) {
      var span = h('span');
      span.appendChild(h('b', null, pair[0]));
      if (pair[1]) span.appendChild(document.createTextNode(' ' + pair[1]));
      spec.appendChild(span);
    });
    host.appendChild(spec);
    host.appendChild(vesselVisual(y));

    // Where she is, in the record itself. The chart pane carries this too, but
    // narrow layouts drop that pane entirely, and a vessel record with no
    // position in it is not much of a record.
    var whereLine = h('div', 'detail-where');
    whereLine.appendChild(h('span', 'w-main', whereText(v)));
    var whereAge = h('span', 'w-age' + (d.dark ? ' dark' : d.stale ? ' stale' : ''));
    var bits = [window.Fmt.statusLabel(d.status)];
    if (d.status === 'underway' && v.fix && !d.discreet) {
      bits.push(window.Fmt.speed(v.fix.sog) + ' · ' + window.Fmt.bearing(v.fix.cog));
    }
    bits.push('fix ' + window.Fmt.age(v.fix && v.fix.at));
    whereAge.textContent = bits.join('  ·  ');
    whereLine.appendChild(whereAge);
    host.appendChild(whereLine);

    if (y.addedLocally) {
      var localPanel = h('div', 'panel');
      var localHead = h('div', 'pane-title');
      localHead.appendChild(document.createTextNode('In this browser only '));
      localHead.appendChild(h('span', 'local-flag', 'not in fleet.js'));
      localPanel.appendChild(localHead);
      localPanel.appendChild(h('div', 'sheet-note',
        'This vessel was added here and is stored in this browser. It is not on ' +
        'the office display and not on anyone else\'s console until its entry is ' +
        'pasted into fleet.js.'));
      var snippet = h('pre', 'snippet', window.Vessel.toSnippet(y) + ',');
      localPanel.appendChild(snippet);
      var actions = h('div', 'sheet-actions');
      var copyButton = h('button', 'button-primary', 'Copy entry');
      copyButton.type = 'button';
      copyButton.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(snippet.textContent);
        }
        copyButton.textContent = 'Copied';
        setTimeout(function () { copyButton.textContent = 'Copy entry'; }, 2000);
      });
      actions.appendChild(copyButton);
      localPanel.appendChild(actions);
      host.appendChild(localPanel);
    }

    // The position, in full. The chart pane shows the same fix as a picture and
    // narrow layouts drop that pane entirely, so the numbers live here.
    var posPanel = h('div', 'panel');
    posPanel.appendChild(h('div', 'pane-title', 'Position'));
    var posRows = h('div', 'rows');

    if (d.lat == null) {
      posRows.appendChild(h('div', 'empty', 'This vessel has never reported to this console.'));
    } else {
      posRows.appendChild(kvRow('Coordinates',
        d.discreet ? 'Withheld' : window.Fmt.latitude(d.lat) + '   ' + window.Fmt.longitude(d.lon),
        d.discreet ? 'discreet — set on this vessel, or on the whole board' : null));
      posRows.appendChild(kvRow('Nearest port', whereText(v), null));
      posRows.appendChild(kvRow('Last fix', window.Fmt.age(v.fix && v.fix.at),
        v.fix && v.fix.at ? window.Fmt.date(v.fix.at) : null));
      if (v.fix && !d.discreet) {
        posRows.appendChild(kvRow('Speed & course',
          v.fix.sog != null ? window.Fmt.speed(v.fix.sog) : '—',
          v.fix.cog != null ? 'course ' + window.Fmt.bearing(v.fix.cog) : null));
      }
      posRows.appendChild(kvRow('From ' + window.CONFIG.office.label,
        d.fromOffice != null ? window.Fmt.distance(d.fromOffice) : '—', null));
      posRows.appendChild(kvRow('Run, 24 h',
        d.distance24h > 0.5 ? window.Fmt.distance(d.distance24h) : '—', null));
      posRows.appendChild(kvRow('Run, 7 days',
        d.distance7d > 0.5 ? window.Fmt.distance(d.distance7d) : '—', null));
    }
    posPanel.appendChild(posRows);
    host.appendChild(posPanel);

    // What the crew have typed into the AIS static message, where they have.
    if (v.voyage && !d.discreet && (v.voyage.destination || v.voyage.eta || v.voyage.draught)) {
      var voyPanel = h('div', 'panel');
      voyPanel.appendChild(h('div', 'pane-title', 'Voyage, as reported'));
      var voyRows = h('div', 'rows');
      voyRows.appendChild(kvRow('Bound for', v.voyage.destination || '—', null));
      voyRows.appendChild(kvRow('ETA', v.voyage.eta || '—', null));
      voyRows.appendChild(kvRow('Draught',
        v.voyage.draught ? v.voyage.draught.toFixed(1) + ' m' : '—', null));
      voyPanel.appendChild(voyRows);
      voyPanel.appendChild(h('div', 'sheet-note',
        'Typed by the crew, not measured. Treat it as intent rather than fact.'));
      host.appendChild(voyPanel);
    }

    var danger = h('div', 'danger-zone');
    danger.appendChild(h('span', 'note', y.addedLocally
      ? 'Added in this browser — removing deletes it outright.'
      : 'From fleet.js. Removing hides it here; the file still has the entry.'));
    var removeButton = h('button', 'button-quiet', 'Remove vessel');
    removeButton.type = 'button';
    removeButton.addEventListener('click', function () { askToRemove(v); });
    danger.appendChild(removeButton);
    host.appendChild(danger);
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
      grid.appendChild(readoutCell('Alongside', String(summary.counts.moored || 0)));
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

  /* --- Adding a vessel ----------------------------------------------------- */

  function wireAddDialog() {
    var dialog = el('add-dialog');
    el('add-vessel').addEventListener('click', function () { openAddDialog(); });
    el('add-cancel').addEventListener('click', function () { dialog.close(); });
    el('add-cancel-2').addEventListener('click', function () { dialog.close(); });
    el('done-close').addEventListener('click', function () { dialog.close(); });
    el('add-form').addEventListener('submit', onAddSubmit);
    el('copy-snippet').addEventListener('click', onCopySnippet);

    // Clear a field's error as soon as it is edited; nagging while someone types
    // is worse than saying nothing.
    ['imo', 'mmsi', 'name'].forEach(function (key) {
      el('f-' + key).addEventListener('input', function () {
        setFieldError(key, '');
      });
    });
  }

  function openAddDialog() {
    var form = el('add-form');
    form.reset();
    ['imo', 'mmsi', 'name'].forEach(function (k) { setFieldError(k, ''); });
    el('add-status').textContent = '';
    form.hidden = false;
    el('add-done').hidden = true;
    el('add-dialog').showModal();
    el('f-imo').focus();
  }

  function setFieldError(key, message) {
    el('e-' + key).textContent = message || '';
    el('f-' + key).setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function onAddSubmit(event) {
    event.preventDefault();

    var imo = window.Vessel.validateImo(el('f-imo').value);
    var mmsi = window.Vessel.validateMmsi(el('f-mmsi').value);
    var name = el('f-name').value.trim();

    setFieldError('imo', imo.ok ? '' : imo.error);
    setFieldError('mmsi', mmsi.ok ? '' : mmsi.error);
    setFieldError('name', name ? '' : 'Give the vessel a name.');

    if (!imo.ok) { el('f-imo').focus(); return; }
    if (!mmsi.ok) { el('f-mmsi').focus(); return; }
    if (!name) { el('f-name').focus(); return; }

    // Refuse a duplicate rather than quietly shadowing an existing record.
    var clash = window.FLEET.filter(function (y) {
      return y.mmsi === mmsi.value || y.imo === imo.value;
    })[0];
    if (clash) {
      setFieldError('mmsi', clash.name + ' is already on the list with that ' +
        (clash.mmsi === mmsi.value ? 'MMSI' : 'IMO') + '.');
      return;
    }

    var record = window.Vessel.buildRecord({
      name: name,
      prefix: el('f-prefix').value,
      mmsi: mmsi.value,
      imo: imo.value,
      flag: el('f-flag').value.trim() || null,
      builder: el('f-builder').value.trim() || null,
      loa: numberOrNull(el('f-loa').value),
      yearBuilt: numberOrNull(el('f-year').value),
      discreet: el('f-discreet').checked
    });

    var stored = window.Vessel.addAddition(record);
    reloadFleet(record.id);

    el('done-name').textContent = window.Fmt.fullName(record);
    el('done-snippet').textContent = window.Vessel.toSnippet(record) + ',';
    el('copy-status').textContent = stored ? ''
      : 'This browser is blocking storage, so the vessel will be gone on reload — the entry below is the only copy.';
    el('add-form').hidden = true;
    el('add-done').hidden = false;
    el('done-close').focus();
  }

  function numberOrNull(value) {
    var n = parseFloat(String(value).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  // Rebuild the fleet from file plus local additions, and point the feeds at the
  // new list — a vessel added mid-session has to be subscribed to.
  function reloadFleet(selectId) {
    window.FLEET = window.Vessel.mergedFleet(BASE_FLEET);
    window.Store.init(window.FLEET);

    if (window.Store.mode === 'demo') {
      window.Demo.stop();
      window.Demo.start(window.Store.vessels);
    } else {
      window.Ais.stop();
      window.Ais.start((window.CONFIG.aisStreamApiKey || '').trim(),
        window.FLEET.map(function (y) { return y.mmsi; }));
    }

    window.Store.recompute();
    select(selectId || App.selected);
    renderRail(true);
    renderHiddenNote();
    renderSaveButton();
  }

  function onCopySnippet() {
    var text = el('done-snippet').textContent;
    var status = el('copy-status');
    function fallback() {
      // Clipboard access is refused in some embedded contexts; select it instead
      // so the keyboard still works.
      var range = document.createRange();
      range.selectNodeContents(el('done-snippet'));
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Selected — press Ctrl+C (or Cmd+C) to copy.';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { status.textContent = 'Copied. Paste it into fleet.js.'; })
        .catch(fallback);
    } else {
      fallback();
    }
  }

  /* --- Removing a vessel --------------------------------------------------- */

  var pendingRemoval = null;

  function askToRemove(vessel) {
    pendingRemoval = vessel;
    var y = vessel.yacht;
    var snippet = el('remove-snippet');

    if (y.addedLocally) {
      el('remove-body').textContent =
        window.Fmt.fullName(y) + ' was added in this browser and is stored here only. ' +
        'Removing it deletes it outright — nothing else has a copy.';
      snippet.hidden = true;
    } else {
      // Be plain about what a browser can and cannot do to a file.
      el('remove-body').textContent =
        window.Fmt.fullName(y) + ' comes from fleet.js, which this page cannot edit. ' +
        'Removing it takes the vessel off this browser straight away, and then ' +
        'hands you the whole of fleet.js with it gone — save that over the file ' +
        'and it is off the office display and every other console too. Until you ' +
        'do, it can be restored from the bottom of the fleet list.';
      snippet.hidden = true;
    }
    el('remove-dialog').showModal();
    el('remove-cancel').focus();
  }

  function confirmRemoval() {
    if (!pendingRemoval) return;
    var y = pendingRemoval.yacht;
    if (y.addedLocally) window.Vessel.removeAddition(y.id);
    else window.Vessel.hideVessel(y.id);
    var wasFromFile = !y.addedLocally;
    pendingRemoval = null;
    el('remove-dialog').close();
    App.selected = null;
    reloadFleet(null);
    // Hiding is half the job; offer the half that makes it stick.
    if (wasFromFile) openFileDialog();
  }

  /* --- Writing fleet.js back out ------------------------------------------- */

  // Hiding takes a vessel off this browser; only the file takes it off
  // everything. So whenever there are local changes the console offers the whole
  // file with them applied, which is the one action that actually removes a
  // vessel for good.
  function localChangeCount() {
    return window.Vessel.loadAdditions().length + window.Vessel.hiddenIds().length;
  }

  function renderSaveButton() {
    var count = localChangeCount();
    var button = el('save-file');
    button.hidden = count === 0;
    button.textContent = count === 1 ? 'Save fleet.js (1 change)' : 'Save fleet.js (' + count + ')';
  }

  function openFileDialog() {
    var added = window.Vessel.loadAdditions().length;
    var hidden = window.Vessel.hiddenIds().length;
    var parts = [];
    if (added) parts.push(added + (added === 1 ? ' vessel added' : ' vessels added'));
    if (hidden) parts.push(hidden + (hidden === 1 ? ' vessel removed' : ' vessels removed'));
    el('file-summary').textContent = parts.length
      ? parts.join(' and ') + ' in this browser.'
      : 'No local changes — this is the fleet exactly as the file already has it.';
    el('file-content').textContent = window.Vessel.toFleetFile(window.FLEET);
    el('file-status').textContent = '';
    el('file-dialog').showModal();
    el('file-close').focus();
  }

  function wireFileDialog() {
    el('save-file').addEventListener('click', openFileDialog);
    el('file-close').addEventListener('click', function () { el('file-dialog').close(); });
    el('file-copy').addEventListener('click', function () {
      var text = el('file-content').textContent;
      var status = el('file-status');
      function selectInstead() {
        var range = document.createRange();
        range.selectNodeContents(el('file-content'));
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        status.textContent = 'Selected — press Ctrl+C (or Cmd+C).';
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(function () { status.textContent = 'Copied. Save it over fleet.js.'; })
          .catch(selectInstead);
      } else {
        selectInstead();
      }
    });
    el('file-download').addEventListener('click', onDownloadFile);
  }

  // Saving a file works two different ways depending on where this is running.
  // Served from a folder, an ordinary download link writes fleet.js. Inside the
  // artifact viewer a page cannot download anything by itself — it has to ask
  // the host, which prompts the viewer and only allows certain extensions, .js
  // not among them. So there it saves as fleet.js.txt and says to rename it.
  function onDownloadFile() {
    var status = el('file-status');
    var text = el('file-content').textContent;

    var host = (window.claude && typeof window.claude.use === 'function')
      ? window.claude.use('downloads') : null;

    if (!host) { downloadDirect(text, status); return; }

    status.textContent = 'Asking the viewer…';
    Promise.resolve(host).then(function (downloads) {
      if (!downloads) { downloadDirect(text, status); return; }
      return downloads.save({ filename: 'fleet.js.txt', data: text }).then(function () {
        status.textContent = 'Saved as fleet.js.txt — rename it to fleet.js.';
      }).catch(function (error) {
        var code = error && error.code;
        status.textContent = code === 'declined' ? 'Save cancelled.'
          : code === 'rate_limited' ? 'A save prompt is already open.'
          : 'Could not save here — use Copy file instead.';
      });
    }).catch(function () { downloadDirect(text, status); });
  }

  function downloadDirect(text, status) {
    try {
      var blob = new Blob([text], { type: 'text/javascript' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'fleet.js';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      status.textContent = 'Saving fleet.js — if nothing arrives, use Copy file.';
    } catch (e) {
      status.textContent = 'Downloads are blocked here — use Copy file instead.';
    }
  }

  function wireRemoveDialog() {
    el('remove-cancel').addEventListener('click', function () { el('remove-dialog').close(); });
    el('remove-close').addEventListener('click', function () { el('remove-dialog').close(); });
    el('remove-confirm').addEventListener('click', confirmRemoval);
    el('restore-hidden').addEventListener('click', function () {
      window.Vessel.unhideAll();
      reloadFleet(App.selected);
    });
  }

  // Hidden vessels are never silently gone: the rail says how many and offers
  // them back.
  function renderHiddenNote() {
    var hidden = window.Vessel.hiddenVessels(BASE_FLEET);
    var strayCount = window.Vessel.hiddenIds().length;
    var note = el('hidden-note');
    if (!strayCount) { note.hidden = true; return; }
    note.hidden = false;
    el('hidden-count').textContent = strayCount === 1
      ? '1 vessel hidden' + (hidden.length ? ' — ' + hidden[0].name : '')
      : strayCount + ' vessels hidden';
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
