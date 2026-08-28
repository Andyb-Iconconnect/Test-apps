/* -----------------------------------------------------------------------------
 * views.js — the four screens the board rotates through.
 *
 * Every view renders from Store state and nothing else, so any of them can be
 * shown at any time without a warm-up.
 *
 * A note on charts: this board is deliberately non-interactive — the cursor is
 * hidden and nobody is going to hover a bar on an office wall. So instead of a
 * tooltip layer, every mark is directly labelled with its own value, which is
 * the accessible fallback that hover would otherwise provide.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Views = {};
  var el = function (id) { return document.getElementById(id); };

  function h(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function statusVar(status) {
    return 'var(--status-' + (status === 'unknown' ? 'dark' : status) + ')';
  }

  /* --- Where a yacht is, in words ---------------------------------------- */

  function whereText(v) {
    var d = v.derived;
    if (d.lat == null) return 'Position unknown';
    var port = d.port;
    if (!port) return window.Fmt.latitude(d.lat) + '  ' + window.Fmt.longitude(d.lon);
    if (d.discreet) {
      // Deliberately vague: a region, never a fix.
      return 'In the area of ' + port.name;
    }
    if (port.distanceNm < 1.2) return 'At ' + port.name;
    return window.Fmt.distance(port.distanceNm) + ' ' + port.compass + ' of ' + port.name;
  }
  Views.whereText = whereText;

  /* --- View 1: the chart -------------------------------------------------- */

  Views.renderRail = function (highlightId) {
    var rail = el('rail-list');
    rail.textContent = '';

    window.Store.vessels.forEach(function (v) {
      var d = v.derived;
      var row = h('div', 'rail-row' + (highlightId === v.yacht.id ? ' is-highlight' : ''));

      var marker = h('span', 'marker');
      marker.style.background = statusVar(d.status);
      if (d.status === 'dark') {
        marker.style.background = 'transparent';
        marker.style.boxShadow = 'inset 0 0 0 2px ' + statusVar('dark');
      }
      row.appendChild(marker);

      row.appendChild(h('span', 'name', v.yacht.name));

      var state = h('span', 'state');
      if (d.status === 'underway' && v.fix && v.fix.sog != null && !d.discreet) {
        state.textContent = window.Fmt.speed(v.fix.sog);
      } else {
        state.textContent = window.Fmt.statusLabel(d.status);
      }
      state.style.color = d.status === 'underway' ? statusVar('underway') : '';
      row.appendChild(state);

      var where = h('span', 'where', whereText(v));
      if (d.stale && d.status !== 'refit') {
        where.textContent += ' · ' + window.Fmt.age(v.fix && v.fix.at);
      }
      row.appendChild(where);

      rail.appendChild(row);
    });
  };

  /* --- View 2: spotlight -------------------------------------------------- */

  Views.renderSpotlight = function (v) {
    var y = v.yacht, d = v.derived;

    el('spot-eyebrow').textContent = y.prefix + ' · ' + y.flag;
    el('spot-name').textContent = y.name;

    var spec = el('spot-spec');
    spec.textContent = '';
    [
      [y.loa.toFixed(1) + ' m', 'LOA'],
      [String(y.yearBuilt), 'built'],
      [y.lastRefit ? String(y.lastRefit) : '—', 'refit'],
      [y.grossTonnage ? y.grossTonnage.toLocaleString() + ' GT' : '—', ''],
      ['IMO ' + y.imo, ''],
      [y.classSociety || '—', '']
    ].forEach(function (pair) {
      var span = h('span');
      var b = h('b', null, pair[0]);
      span.appendChild(b);
      if (pair[1]) span.appendChild(document.createTextNode(' ' + pair[1]));
      spec.appendChild(span);
    });

    renderVisual(v);
    renderPositionCard(v);
    renderWeatherCard(v);
    renderDaylightCard(v);
    renderServiceCard(v);
  };

  function renderVisual(v) {
    var host = el('spot-visual');
    host.textContent = '';
    if (v.yacht.photo) {
      var img = document.createElement('img');
      img.src = v.yacht.photo;
      img.alt = window.Fmt.fullName(v.yacht);
      // If the file isn't there, fall back rather than showing a broken image.
      img.onerror = function () { host.textContent = ''; host.appendChild(locator(v)); };
      host.appendChild(img);
    } else {
      host.appendChild(locator(v));
    }
  }

  // A small regional chart drawn straight onto a canvas — stands in for a photo
  // until one is dropped into assets/photos/, and is more use than a grey box.
  function locator(v) {
    var wrap = h('div');
    wrap.style.position = 'absolute';
    wrap.style.inset = '0';
    var canvas = document.createElement('canvas');
    wrap.appendChild(canvas);

    requestAnimationFrame(function () {
      drawLocator(canvas, v);
    });
    return wrap;
  }

  function drawLocator(canvas, v) {
    var d = v.derived;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var css = getComputedStyle(document.documentElement);
    var col = function (n, f) { return (css.getPropertyValue(n) || '').trim() || f; };

    ctx.fillStyle = col('--map-ocean-deep', '#060e16');
    ctx.fillRect(0, 0, rect.width, rect.height);
    if (d.lat == null) return;

    // Roughly 400 nm across: close enough to recognise the coastline, far enough
    // that it stays regional context rather than a fix.
    var spanDeg = 7;
    var scale = (rect.width / (spanDeg / 360));
    var cx = window.Geo.worldX(d.lon);
    var cy = window.Geo.worldY(d.lat);
    var sx = function (wx) { return (wx - cx) * scale + rect.width / 2; };
    var sy = function (wy) { return (wy - cy) * scale + rect.height / 2; };

    // Reuse the coastline the main chart already decoded, culled by the bounds
    // it precomputed — at this zoom most of the world is off-canvas.
    var rings = window.FleetMap.landRings();
    var bounds = window.FleetMap.landBounds();
    ctx.beginPath();
    for (var i = 0; i < rings.length; i++) {
      var b = bounds[i];
      if (sx(b.maxX) < -20 || sx(b.minX) > rect.width + 20) continue;
      if (sy(b.maxY) < -20 || sy(b.minY) > rect.height + 20) continue;
      if (b.spanX * scale < 1.5 && b.spanY * scale < 1.5) continue;
      var ring = rings[i];
      ctx.moveTo(sx(window.Geo.worldX(ring[0])), sy(window.Geo.worldY(ring[1])));
      for (var j = 2; j < ring.length; j += 2) {
        ctx.lineTo(sx(window.Geo.worldX(ring[j])), sy(window.Geo.worldY(ring[j + 1])));
      }
      ctx.closePath();
    }
    ctx.fillStyle = col('--map-land', '#1b2632');
    ctx.fill('evenodd');
    ctx.strokeStyle = col('--map-coast', '#31435a');
    ctx.lineWidth = 1;
    ctx.stroke();

    // Nearest hub, for orientation.
    if (d.port) {
      var hx = sx(window.Geo.worldX(d.port.lon)), hy = sy(window.Geo.worldY(d.port.lat));
      if (hx > 0 && hx < rect.width && hy > 0 && hy < rect.height) {
        ctx.beginPath();
        ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = col('--map-coast', '#5c778f');
        ctx.fill();
        ctx.font = '400 12px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = col('--text-muted', '#67788b');
        ctx.fillText(d.port.name, hx + 7, hy);
      }
    }

    // Where it has been.
    if (v.track.length > 1 && !d.discreet) {
      ctx.beginPath();
      for (var t = 0; t < v.track.length; t++) {
        var tp = v.track[t];
        var tx = sx(window.Geo.worldX(tp.lon)), ty = sy(window.Geo.worldY(tp.lat));
        if (t === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
      }
      ctx.strokeStyle = col('--map-track', '#2f6ea8');
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The yacht.
    var px = rect.width / 2, py = rect.height / 2;
    var color = col('--status-' + (d.status === 'unknown' ? 'dark' : d.status), '#3987e5');
    if (d.discreet) {
      ctx.beginPath();
      ctx.arc(px, py, Math.min(rect.width, rect.height) * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = 0.12; ctx.fill();
      ctx.globalAlpha = 0.7; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
      ctx.strokeStyle = color; ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      ctx.arc(px, py, 20, 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = col('--map-ocean-deep', '#060e16'); ctx.lineWidth = 2; ctx.stroke();
    }
  }

  function renderPositionCard(v) {
    var d = v.derived;
    var latEl = el('spot-position'), ctxEl = el('spot-position-context'), ageEl = el('spot-fix-age');

    if (d.lat == null) {
      latEl.textContent = 'No position';
      ctxEl.textContent = 'This yacht has never reported to this board.';
      ageEl.textContent = '';
      return;
    }

    latEl.textContent = d.discreet
      ? 'Position withheld'
      : window.Fmt.latitude(d.lat) + '   ' + window.Fmt.longitude(d.lon);
    ctxEl.textContent = whereText(v);

    ageEl.className = 'fix-age' + (d.dark ? ' dark' : d.stale ? ' stale' : '');
    var parts = [window.Fmt.statusLabel(d.status)];
    if (d.status === 'underway' && v.fix && !d.discreet) {
      parts.push(window.Fmt.speed(v.fix.sog) + ' · course ' + window.Fmt.bearing(v.fix.cog));
    }
    parts.push('fix ' + window.Fmt.age(v.fix && v.fix.at));
    if (v.voyage && v.voyage.destination && !d.discreet) {
      parts.push('bound for ' + v.voyage.destination + ' (as reported)');
    }
    ageEl.textContent = parts.join('  ·  ');

    var extra = el('spot-position-extra');
    extra.textContent = '';
    extra.appendChild(kv('From ' + window.CONFIG.office.label,
      d.fromOffice != null ? window.Fmt.distance(d.fromOffice) : '—', null));
    extra.appendChild(kv('Run, 24 h',
      d.distance24h > 0.5 ? window.Fmt.distance(d.distance24h) : '—', null));
    extra.appendChild(kv('Draught',
      v.voyage && v.voyage.draught ? v.voyage.draught.toFixed(1) + ' m' : '—', null));
    extra.appendChild(kv('ETA',
      v.voyage && v.voyage.eta ? v.voyage.eta : '—',
      v.voyage && v.voyage.eta ? 'as reported' : null));
  }

  function renderWeatherCard(v) {
    var w = v.weather;
    var grid = el('spot-weather');
    grid.textContent = '';

    if (!w) {
      grid.appendChild(kv('Conditions', window.CONFIG.weather.enabled ? 'Loading…' : 'Disabled'));
      return;
    }

    var beaufort = window.Weather.beaufort(w.windSpeed);
    grid.appendChild(kv('Wind',
      window.Fmt.windSpeed(w.windSpeed),
      w.windDirection != null
        ? window.Geo.compassPoint(w.windDirection) + (beaufort ? ' · F' + beaufort.force : '')
        : null));

    grid.appendChild(kv('Air', window.Fmt.temperature(w.airTemp), window.Weather.describe(w.weatherCode)));

    if (w.marineAvailable) {
      grid.appendChild(kv('Sea', window.Fmt.waveHeight(w.waveHeight), window.Weather.seaState(w.waveHeight)));
      grid.appendChild(kv('Water', window.Fmt.temperature(w.seaTemp),
        w.swellHeight != null ? 'swell ' + window.Fmt.waveHeight(w.swellHeight) : null));
    } else {
      // Honest about the gap rather than showing a plausible-looking dash.
      grid.appendChild(kv('Sea', '—', 'inshore — no wave model'));
      grid.appendChild(kv('Gusts', window.Fmt.windSpeed(w.windGust), null));
    }
  }

  function kv(key, value, sub) {
    var wrap = h('div', 'kv');
    wrap.appendChild(h('span', 'k', key));
    var v = h('span', 'v', value);
    if (sub) {
      var small = h('small', null, sub);
      v.appendChild(small);
    }
    wrap.appendChild(v);
    return wrap;
  }

  function renderDaylightCard(v) {
    var d = v.derived;
    var host = el('spot-daylight');
    host.textContent = '';

    if (d.lat == null) return;

    var line = h('div', 'kv-grid');
    line.appendChild(kv('Local time', d.localTime.text, d.localTime.label));

    if (d.sun && d.sun.polar) {
      line.appendChild(kv('Daylight', d.sun.polar === 'day' ? 'Midnight sun' : 'Polar night', null));
    } else if (d.sun) {
      // Shown in the same frame as the clock above, so the three times agree.
      var frame = function (date) {
        return (v.weather && v.weather.utcOffsetSeconds != null)
          ? window.Fmt.timeAtOffset(date, v.weather.utcOffsetSeconds, false).text
          : window.Fmt.nauticalTime(date, d.lon).text;
      };
      line.appendChild(kv('Sunrise', frame(d.sun.sunrise), null));
      line.appendChild(kv('Sunset', frame(d.sun.sunset), null));
    }
    line.appendChild(kv('Sun', d.isDaylight ? Math.round(d.solarAltitude) + '°' : 'Below horizon',
      d.isDaylight ? 'altitude' : null));
    host.appendChild(line);

    if (d.sun && !d.sun.polar) host.appendChild(sunArc(d));
  }

  // A day-length arc with the sun's current place on it. Reads at a glance from
  // across a room in a way that two timestamps do not.
  function sunArc(d) {
    var NS = 'http://www.w3.org/2000/svg';
    // A wide viewBox, scaled uniformly: stretching a square one would turn the
    // sun into an ellipse.
    var W = 800, BASE = 52, PEAK = 4;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'sun-arc');
    svg.setAttribute('viewBox', '0 0 ' + W + ' 62');

    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M 10 ' + BASE + ' Q ' + (W / 2) + ' ' + (PEAK - 44) + ' ' + (W - 10) + ' ' + BASE);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'rgba(255,255,255,0.14)');
    path.setAttribute('stroke-width', '1.5');
    svg.appendChild(path);

    var base = document.createElementNS(NS, 'line');
    base.setAttribute('x1', '0'); base.setAttribute('y1', String(BASE));
    base.setAttribute('x2', String(W)); base.setAttribute('y2', String(BASE));
    base.setAttribute('stroke', 'rgba(255,255,255,0.09)');
    base.setAttribute('stroke-width', '1');
    svg.appendChild(base);

    var now = Date.now();
    var rise = d.sun.sunrise.getTime(), set = d.sun.sunset.getTime();
    var t = (now - rise) / (set - rise);
    var clamped = Math.max(0, Math.min(1, t));
    var x = 10 + clamped * (W - 20);
    // The same quadratic bezier evaluated at t, so the sun sits on the curve.
    var ctrlY = PEAK - 44;
    var y = Math.pow(1 - clamped, 2) * BASE +
            2 * (1 - clamped) * clamped * ctrlY +
            Math.pow(clamped, 2) * BASE;

    var sun = document.createElementNS(NS, 'circle');
    sun.setAttribute('cx', String(x));
    sun.setAttribute('cy', String(y));
    sun.setAttribute('r', '7');
    sun.setAttribute('fill', t >= 0 && t <= 1 ? 'var(--warning)' : 'var(--text-muted)');
    svg.appendChild(sun);

    return svg;
  }

  function renderServiceCard(v) {
    var s = v.yacht.service || {};
    var host = el('spot-service');
    host.textContent = '';

    var grid = h('div', 'kv-grid');
    var until = s.nextEventDate ? window.Fmt.until(s.nextEventDate) : null;
    grid.appendChild(kv('Next', s.nextEvent || '—',
      until ? until.text : null));
    grid.appendChild(kv('Open jobs', String(s.openJobs != null ? s.openJobs : '—'),
      s.urgentJobs ? s.urgentJobs + ' urgent' : null));
    grid.appendChild(kv('Engineer', s.engineer || '—', null));
    if (s.partsOnOrder && s.partsOnOrder.length) {
      var next = s.partsOnOrder[0];
      grid.appendChild(kv('Parts', String(s.partsOnOrder.length),
        'next ' + window.Fmt.shortDate(next.eta) + ' · ' + next.port));
    } else {
      grid.appendChild(kv('Parts', 'None on order', null));
    }
    host.appendChild(grid);
  }

  /* --- View 3: fleet statistics ------------------------------------------- */

  var STAT_STATES = [
    ['underway', 'Underway'],
    ['anchored', 'At anchor'],
    ['moored', 'Alongside'],
    ['refit', 'In refit'],
    ['dark', 'No signal']
  ];

  Views.renderStats = function () {
    var summary = window.Store.summary();
    var tiles = el('stat-tiles');
    tiles.textContent = '';

    STAT_STATES.forEach(function (pair) {
      var tile = h('div', 'tile');
      var label = h('div', 'label');
      var swatch = h('span', 'swatch');
      swatch.style.background = statusVar(pair[0]);
      label.appendChild(swatch);
      label.appendChild(document.createTextNode(pair[1]));
      tile.appendChild(label);

      var figure = h('div', 'figure', String(summary.counts[pair[0]] || 0));
      var of = h('small', null, 'of ' + summary.total);
      figure.appendChild(of);
      tile.appendChild(figure);
      tiles.appendChild(tile);
    });

    // Distance run — one measure, one hue, values direct-labelled.
    var vessels = window.Store.vessels.slice().sort(function (a, b) {
      return (b.derived.distance7d || 0) - (a.derived.distance7d || 0);
    });
    var max = Math.max.apply(null, vessels.map(function (v) { return v.derived.distance7d || 0; }).concat([1]));

    var bars = el('distance-bars');
    bars.textContent = '';
    vessels.forEach(function (v) {
      var value = v.derived.distance7d || 0;
      var row = h('div', 'bar-row');
      row.appendChild(h('div', 'bar-name', v.yacht.name));
      var track = h('div', 'bar-track');
      var fill = h('div', 'bar-fill');
      fill.style.width = (value / max * 100).toFixed(1) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      var val = h('div', 'bar-value' + (value < 0.5 ? ' zero' : ''),
        value < 0.5 ? '—' : window.Fmt.distance(value));
      row.appendChild(val);
      bars.appendChild(row);
    });

    el('distance-note').textContent =
      'Total ' + window.Fmt.distance(summary.distance7d) + ' across the fleet';

    renderRegions();
    renderGlance();
  };

  // The facts an office actually repeats to each other, worked out from the same
  // data rather than typed in anywhere.
  function renderGlance() {
    var vessels = window.Store.vessels;
    var host = el('glance-list');
    host.textContent = '';

    var totalLoa = vessels.reduce(function (sum, v) { return sum + (v.yacht.loa || 0); }, 0);
    var thisYear = new Date().getFullYear();
    var avgAge = vessels.reduce(function (sum, v) {
      return sum + (thisYear - (v.yacht.yearBuilt || thisYear));
    }, 0) / Math.max(1, vessels.length);

    var withFix = vessels.filter(function (v) { return v.derived.fromOffice != null; });
    var furthest = withFix.slice().sort(function (a, b) {
      return b.derived.fromOffice - a.derived.fromOffice;
    })[0];

    var moving = vessels.filter(function (v) {
      return v.derived.status === 'underway' && v.fix && v.fix.sog != null;
    }).sort(function (a, b) { return b.fix.sog - a.fix.sog; })[0];

    var busiest = vessels.slice().sort(function (a, b) {
      return (b.derived.distance7d || 0) - (a.derived.distance7d || 0);
    })[0];

    var nextEvent = window.Store.upcoming().filter(function (i) { return i.kind === 'event'; })[0];

    var engineers = {};
    vessels.forEach(function (v) {
      var e = v.yacht.service && v.yacht.service.engineer;
      if (e) engineers[e] = (engineers[e] || 0) + 1;
    });

    [
      ['Fleet length', totalLoa.toFixed(0) + ' m', vessels.length + ' vessels'],
      ['Average age', avgAge.toFixed(0) + ' yrs', 'since build'],
      ['Furthest away', furthest ? furthest.yacht.name : '—',
        furthest ? window.Fmt.distance(furthest.derived.fromOffice) + ' from ' + window.CONFIG.office.label : null],
      ['Fastest now', moving ? moving.yacht.name : 'None underway',
        moving ? window.Fmt.speed(moving.fix.sog) : null],
      ['Busiest this week', busiest ? busiest.yacht.name : '—',
        busiest ? window.Fmt.distance(busiest.derived.distance7d || 0) : null],
      ['Next survey', nextEvent ? nextEvent.vessel.yacht.name : '—',
        nextEvent ? window.Fmt.shortDate(nextEvent.date) + ' · ' + nextEvent.label : null],
      ['Engineers assigned', String(Object.keys(engineers).length), 'across the fleet']
    ].forEach(function (row) {
      var line = h('div', 'glance-row');
      line.appendChild(h('div', 'g-label', row[0]));
      var value = h('div', 'g-value', row[1]);
      line.appendChild(value);
      if (row[2]) line.appendChild(h('div', 'g-detail', row[2]));
      host.appendChild(line);
    });
  }

  // Coarse sea areas, so "where is everyone" answers in words rather than
  // coordinates. Ordered most specific first.
  var REGIONS = [
    ['Western Mediterranean', -6, 35, 16, 45],
    ['Adriatic', 12, 39.5, 20, 46],
    ['Eastern Mediterranean', 16, 30, 37, 42],
    ['Northern Europe', -12, 48, 32, 72],
    ['Iberian Atlantic', -12, 35, -6, 48],
    ['Caribbean', -85, 9, -58, 27],
    ['US East Coast', -82, 24, -64, 46],
    ['US West Coast', -130, 22, -105, 50],
    ['Atlantic', -70, -10, -5, 60],
    ['Middle East', 32, 12, 60, 31],
    ['Indian Ocean', 40, -35, 100, 25],
    ['South East Asia', 92, -12, 130, 24],
    ['Pacific', 130, -50, 180, 50],
    ['South America', -82, -56, -34, 12],
    ['Africa', -20, -36, 52, 37]
  ];

  // Bounds are [name, west, south, east, north].
  function regionForFixed(lon, lat) {
    for (var i = 0; i < REGIONS.length; i++) {
      var r = REGIONS[i];
      if (lon >= r[1] && lon <= r[3] && lat >= r[2] && lat <= r[4]) return r[0];
    }
    return 'Open ocean';
  }

  function renderRegions() {
    var groups = {};
    window.Store.vessels.forEach(function (v) {
      var d = v.derived;
      if (d.lat == null) return;
      var name = regionForFixed(d.lon, d.lat);
      (groups[name] = groups[name] || []).push(v);
    });

    var host = el('region-list');
    host.textContent = '';
    Object.keys(groups)
      .sort(function (a, b) { return groups[b].length - groups[a].length; })
      .forEach(function (name) {
        var row = h('div', 'region-row');
        row.appendChild(h('div', 'r-name', name));
        row.appendChild(h('div', 'r-count', String(groups[name].length)));
        row.appendChild(h('div', 'r-detail',
          groups[name].map(function (v) { return v.yacht.name; }).join(' · ')));
        host.appendChild(row);
      });

    var summary = window.Store.summary();
    el('region-note').textContent =
      summary.tracked + ' of ' + summary.total + ' reporting · ' +
      summary.openJobs + ' open jobs' +
      (summary.urgentJobs ? ' · ' + summary.urgentJobs + ' urgent' : '');
  }

  /* --- View 4: service and refit board ------------------------------------ */

  Views.renderSchedule = function () {
    var items = window.Store.upcoming();
    var now = new Date();
    var host = el('timeline');
    host.textContent = '';

    var horizon = now.getTime() + 200 * 86400000;
    var shown = items.filter(function (i) { return i.date.getTime() < horizon; }).slice(0, 12);

    if (!shown.length) {
      host.appendChild(h('div', 'muted', 'Nothing scheduled in the next six months.'));
    }

    shown.forEach(function (item) {
      var until = window.Fmt.until(item.date, now);
      var row = h('div', 'timeline-row');

      row.appendChild(h('div', 'when', window.Fmt.shortDate(item.date)));

      var what = h('div', 'what');
      what.appendChild(h('div', 'headline', item.label + (item.port ? ' → ' + item.port : '')));
      what.appendChild(h('div', 'vessel',
        window.Fmt.fullName(item.vessel.yacht) +
        (item.kind === 'part' ? ' · part on order' : '') +
        (item.kind === 'yard' ? ' · yard period ends' : '')));
      row.appendChild(what);

      var chipClass = item.kind === 'yard' ? 'yard'
                    : item.kind === 'part' ? 'part'
                    : until.overdue ? 'overdue'
                    : until.days != null && until.days <= 14 ? 'due' : 'ok';
      var chip = h('span', 'chip ' + chipClass);
      chip.appendChild(h('span', null, glyphFor(chipClass)));
      chip.appendChild(h('span', null, until.text));
      row.appendChild(chip);

      host.appendChild(row);
    });

    // Open work, per yacht.
    var jobs = el('jobs-list');
    jobs.textContent = '';
    window.Store.vessels.slice().sort(function (a, b) {
      var sa = a.yacht.service || {}, sb = b.yacht.service || {};
      return (sb.urgentJobs || 0) - (sa.urgentJobs || 0) || (sb.openJobs || 0) - (sa.openJobs || 0);
    }).forEach(function (v) {
      var s = v.yacht.service || {};
      var row = h('div', 'job-row');
      row.appendChild(h('div', 'j-name', v.yacht.name));
      if (s.urgentJobs) {
        var chip = h('span', 'chip overdue');
        chip.appendChild(h('span', null, '!'));
        chip.appendChild(h('span', null, s.urgentJobs + ' urgent'));
        row.appendChild(chip);
      } else {
        row.appendChild(h('span'));
      }
      row.appendChild(h('div', 'j-count' + (s.openJobs ? '' : ' none'),
        (s.openJobs || 0) + (s.openJobs === 1 ? ' job' : ' jobs')));
      jobs.appendChild(row);
    });

    renderParts();
  };

  // Parts on order, against where the yacht is expected to be. This is the line
  // that earns a wall board its keep: "part lands in Palma, yacht arrives Palma
  // Thursday" is not something a tracking site can tell you.
  function renderParts() {
    var host = el('parts-list');
    host.textContent = '';
    var rows = [];
    window.Store.vessels.forEach(function (v) {
      ((v.yacht.service || {}).partsOnOrder || []).forEach(function (p) {
        rows.push({ vessel: v, part: p });
      });
    });
    rows.sort(function (a, b) { return new Date(a.part.eta) - new Date(b.part.eta); });

    if (!rows.length) {
      host.appendChild(h('div', 'muted', 'Nothing on order.'));
      return;
    }

    rows.forEach(function (r) {
      var d = r.vessel.derived;
      var row = h('div', 'part-row');
      row.appendChild(h('div', 'p-item', r.part.item));

      // Is the yacht anywhere near where the part is going?
      var note = r.vessel.yacht.name;
      if (d.port && r.part.port) {
        note += d.port.name === r.part.port
          ? ' · already at ' + r.part.port
          : ' · currently ' + whereText(r.vessel);
      }
      row.appendChild(h('div', 'p-vessel', note));

      var chip = h('span', 'chip part');
      chip.appendChild(h('span', null, '⬤'));
      chip.appendChild(h('span', null, window.Fmt.shortDate(r.part.eta) + ' · ' + r.part.port));
      row.appendChild(chip);

      host.appendChild(row);
    });
  }

  // Status is never carried by colour alone — every chip pairs its colour with
  // a glyph and a word.
  function glyphFor(kind) {
    return { overdue: '!', due: '▲', yard: '⚓', part: '⬤', ok: '·' }[kind] || '·';
  }

  window.Views = Views;
})();
