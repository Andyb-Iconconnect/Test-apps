/* -----------------------------------------------------------------------------
 * app.js — bootstrap, the rotation, and the render loop.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var App = { paused: false, scene: 0, sceneStartedAt: 0, scenes: [] };

  var MAP_FPS = 30;                 // ambient, not a game
  var RECOMPUTE_MS = 1000;
  var PERSIST_MS = 30000;

  var el = function (id) { return document.getElementById(id); };

  /* --- Boot -------------------------------------------------------------- */

  function boot() {
    if (window.CONFIG.discreetLocked) window.CONFIG.discreetMode = true;
    window.Store.init(window.FLEET);
    window.FleetMap.init(el('chart-canvas'));

    renderBrand();
    el('brand-locations').textContent = window.CONFIG.brandLocations || '';
    el('brand-sub').textContent = window.CONFIG.subtitle || '';
    el('strapline').textContent = window.CONFIG.strapline || '';

    buildScenes();
    window.FleetMap.fit(fleetPoints(), 90, null, chartInset());
    window.FleetMap.snap();

    startFeed();
    window.Weather.start();

    window.Store.subscribe(onStoreChange);
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousemove', onPointer);
    document.addEventListener('keydown', noteActivity);
    document.addEventListener('mousemove', noteActivity);
    el('chart-canvas').addEventListener('click', onCanvasClick);
    el('rail-list').addEventListener('click', onRailClick);
    el('hint-close').addEventListener('click', function () {
      el('hint').classList.remove('visible');
    });

    setInterval(function () { window.Store.recompute(); }, RECOMPUTE_MS);
    setInterval(function () { window.Store.persist(); }, PERSIST_MS);
    setInterval(tickClock, 1000);
    setInterval(applyAmbientChrome, 60000);
    setInterval(checkAutoResume, 15000);

    // Shown once at start-up, then only when a pointer moves.
    showHint();

    tickClock();
    applyAmbientChrome();
    enterScene(0);
    requestAnimationFrame(frame);
  }

  // The wordmark, with the power symbol standing in for the first O the way the
  // logo does. Falls back to plain text if the name has no O, and is skipped
  // entirely when a logo image is configured.
  function renderBrand() {
    var host = el('brand');
    var cfg = window.CONFIG;
    host.textContent = '';

    if (cfg.brandLogo) {
      var img = document.createElement('img');
      img.src = cfg.brandLogo;
      img.alt = cfg.brand || '';
      // If the file isn't there, fall back to the wordmark rather than a broken image.
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

  // A ring open at the top with a bar rising through the gap — the mark from the
  // logo, drawn rather than embedded so it stays crisp at any panel size and
  // takes its colour from the stylesheet.
  function powerMark() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'power-o');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');

    var ring = document.createElementNS(NS, 'path');
    // Centre (50,55), radius 32. The gap is narrow and sits square at twelve
    // o'clock — just wide enough for the bar — so the O still reads as a letter.
    // The arc therefore runs the long way: from -74 degrees clockwise to 254.
    ring.setAttribute('d', 'M 59.1 22.9 A 33 33 0 1 1 40.9 22.9');
    svg.appendChild(ring);

    var bar = document.createElementNS(NS, 'line');
    // Rises just clear of the ring and drops about a third of the way into it.
    bar.setAttribute('x1', '50'); bar.setAttribute('y1', '8');
    bar.setAttribute('x2', '50'); bar.setAttribute('y2', '42');
    svg.appendChild(bar);

    return svg;
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
    window.Store.recompute();
  }

  /* --- Scenes ------------------------------------------------------------ */

  // The rotation. Spotlight expands into one scene per yacht so every boat gets
  // its turn rather than the same one every cycle.
  function buildScenes() {
    var r = window.CONFIG.rotation;
    App.scenes = [{ view: 'chart', seconds: r.chartSeconds }];

    if (r.spotlightAllYachts) {
      window.Store.vessels.forEach(function (v) {
        App.scenes.push({ view: 'spotlight', seconds: r.spotlightSeconds, vesselId: v.yacht.id });
      });
    } else {
      App.scenes.push({ view: 'spotlight', seconds: r.spotlightSeconds, vesselId: null });
    }

    App.scenes.push({ view: 'stats', seconds: r.statsSeconds });

    var dots = el('rotation-dots');
    dots.textContent = '';
    // One dot per view, not per yacht — eight spotlight dots would be noise.
    ['chart', 'spotlight', 'stats'].forEach(function (name) {
      var dot = document.createElement('div');
      dot.className = 'rotation-dot';
      dot.dataset.view = name;
      var fill = document.createElement('span');
      fill.className = 'fill';
      dot.appendChild(fill);
      dots.appendChild(dot);
    });
  }

  var VIEW_TITLES = {
    chart: 'Fleet chart',
    spotlight: 'Vessel detail',
    stats: 'Fleet summary'
  };

  function enterScene(index) {
    App.scene = ((index % App.scenes.length) + App.scenes.length) % App.scenes.length;
    App.sceneStartedAt = performance.now();
    var scene = App.scenes[App.scene];

    ['chart', 'spotlight', 'stats'].forEach(function (name) {
      el('view-' + name).classList.toggle('active', name === scene.view);
    });
    el('view-title').textContent = VIEW_TITLES[scene.view] || '';

    Array.prototype.forEach.call(el('rotation-dots').children, function (dot) {
      dot.classList.toggle('current', dot.dataset.view === scene.view);
      if (dot.dataset.view !== scene.view) dot.firstChild.style.width = '0%';
    });

    if (scene.view === 'chart') {
      chartTour.reset();
      window.FleetMap.fit(fleetPoints(), 90, null, chartInset());
      window.Views.renderRail(null);
    } else if (scene.view === 'spotlight') {
      var v = pickSpotlightVessel(scene);
      if (v) window.Views.renderSpotlight(v);
    } else if (scene.view === 'stats') {
      window.Views.renderStats();
    }
  }

  function pickSpotlightVessel(scene) {
    if (scene.vesselId) {
      for (var i = 0; i < window.Store.vessels.length; i++) {
        if (window.Store.vessels[i].yacht.id === scene.vesselId) return window.Store.vessels[i];
      }
    }
    return window.Store.vessels[Math.floor(Math.random() * window.Store.vessels.length)];
  }

  // The fleet rail is painted over the chart, so the camera has to treat that
  // strip as unusable. Measured rather than assumed: the rail is sized in rem.
  function width() {
    return document.getElementById('stage').getBoundingClientRect().width;
  }

  function chartInset() {
    var rail = document.querySelector('#view-chart .rail');
    var railWidth = rail ? rail.getBoundingClientRect().width : 0;
    return { left: railWidth * 0.86, right: 24 };
  }

  function fleetPoints() {
    return window.Store.vessels
      .filter(function (v) { return v.derived.lat != null; })
      .map(function (v) { return [v.derived.lon, v.derived.lat]; });
  }

  /* --- The chart's slow tour ---------------------------------------------- */

  // While the chart is up, hold the whole fleet for a while, then ease in on one
  // yacht at a time. It is the difference between a map and something worth
  // glancing at twice.
  var chartTour = {
    phase: 'fleet',
    index: 0,
    nextAt: 0,
    reset: function () {
      this.phase = 'fleet';
      this.index = 0;
      this.nextAt = performance.now() + 20000;
    },
    update: function (now) {
      if (now < this.nextAt) return;
      var visible = window.Store.vessels.filter(function (v) { return v.derived.lat != null; });
      if (!visible.length) return;

      if (this.phase === 'fleet') {
        this.phase = 'vessel';
        this.index = Math.floor(Math.random() * visible.length);
      } else {
        this.index = (this.index + 1) % visible.length;
        // Every few yachts, pull back out to the whole fleet for context.
        if (this.index % 3 === 0) this.phase = 'fleet';
      }

      if (this.phase === 'fleet') {
        window.FleetMap.fit(fleetPoints(), 90, null, chartInset());
        window.Views.renderRail(null);
        this.nextAt = now + 18000;
      } else {
        var v = visible[this.index];
        // Frame roughly 500 nm of sea across the free width. `scale` is the pixel
        // width of the whole world, so degrees on screen = 360 * width / scale.
        var free = width() - chartInset().left;
        var degreesWanted = 500 / 60 / Math.max(0.2, Math.cos(v.derived.lat * Math.PI / 180));
        window.FleetMap.centreOn(v.derived.lon, v.derived.lat,
          360 * free / degreesWanted, chartInset());
        window.Views.renderRail(v.yacht.id);
        this.nextAt = now + 14000;
      }
    },
    currentId: function () {
      if (this.phase !== 'vessel') return null;
      var visible = window.Store.vessels.filter(function (v) { return v.derived.lat != null; });
      var v = visible[this.index];
      return v ? v.yacht.id : null;
    }
  };

  /* --- Frame loop --------------------------------------------------------- */

  var lastMapFrame = 0;

  function frame(now) {
    requestAnimationFrame(frame);

    var scene = App.scenes[App.scene];

    if (scene.view === 'chart') {
      if (now - lastMapFrame >= 1000 / MAP_FPS) {
        lastMapFrame = now;
        if (!App.paused) chartTour.update(now);
        window.FleetMap.render(now, window.Store.vessels, {
          highlight: chartTour.currentId(),
          inset: chartInset()
        });
      }
    }

    if (!App.paused) {
      var elapsed = now - App.sceneStartedAt;
      var duration = scene.seconds * 1000;
      updateProgress(scene.view, Math.min(1, elapsed / duration));
      if (window.CONFIG.rotation.enabled && elapsed >= duration) enterScene(App.scene + 1);
    }
  }

  function updateProgress(view, fraction) {
    var dots = el('rotation-dots').children;
    for (var i = 0; i < dots.length; i++) {
      if (dots[i].dataset.view === view) {
        dots[i].firstChild.style.width = (fraction * 100).toFixed(1) + '%';
      }
    }
  }

  /* --- Chrome ------------------------------------------------------------- */

  function tickClock() {
    var now = new Date();
    el('clock').textContent = window.Fmt.clock(now, window.CONFIG.office.timeZone);
    el('clock-zone').textContent = window.CONFIG.office.label;
  }

  function onStoreChange(store) {
    var pill = el('connection');
    pill.dataset.state = store.connection;
    var label = {
      demo: 'Demo data',
      open: 'Live AIS',
      connecting: 'Connecting',
      retrying: 'Reconnecting',
      closed: 'Offline',
      starting: 'Starting'
    }[store.connection] || store.connection;
    el('connection-label').textContent = label;

    // Refresh whichever view is on screen, so a new fix is visible immediately
    // rather than at the next rotation.
    var scene = App.scenes[App.scene];
    if (!scene) return;
    if (scene.view === 'chart') {
      window.Views.renderRail(chartTour.currentId());
    } else if (scene.view === 'spotlight') {
      var v = pickSpotlightVessel(scene);
      if (v && scene.vesselId) window.Views.renderSpotlight(v);
    } else if (scene.view === 'stats') {
      window.Views.renderStats();
    }
  }

  // Burn-in shift and the after-hours dim.
  var shiftStep = 0;
  function applyAmbientChrome() {
    var d = window.CONFIG.display;
    var board = el('board');

    if (d.pixelShift) {
      var minutes = Date.now() / 60000;
      var step = Math.floor(minutes / d.pixelShiftMinutes);
      if (step !== shiftStep) {
        shiftStep = step;
        var dx = (step % 5) - 2, dy = (Math.floor(step / 5) % 5) - 2;
        board.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      }
    }

    if (d.nightDimming) {
      var hour = new Date().getHours();
      var isNight = d.nightDimFrom > d.nightDimTo
        ? (hour >= d.nightDimFrom || hour < d.nightDimTo)
        : (hour >= d.nightDimFrom && hour < d.nightDimTo);
      board.style.opacity = isNight ? String(d.nightDimOpacity) : '1';
    }
  }

  function onResize() {
    window.FleetMap.resize();
    window.FleetMap.readTheme();
  }

  /* --- Keyboard ----------------------------------------------------------- */

  var pointerTimer = null;
  var hintTimer = null;

  function onPointer() {
    document.body.classList.add('interactive');
    showHint();
    clearTimeout(pointerTimer);
    pointerTimer = setTimeout(function () {
      document.body.classList.remove('interactive');
    }, 4000);
  }

  // The shortcuts are invisible until something tells you about them. This costs
  // nothing on a wall — the pointer never moves there and the board only ever
  // shows it once, at boot — and it is the difference between someone opening a
  // link and watching one view, or actually finding the other three.
  function showHint() {
    var hint = el('hint');
    hint.classList.add('visible');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hint.classList.remove('visible'); }, 5000);
  }

  function onCanvasClick(event) {
    var rect = el('chart-canvas').getBoundingClientRect();
    var vessel = window.FleetMap.hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (vessel) showVessel(vessel.yacht.id);
  }

  function onRailClick(event) {
    var row = event.target.closest('.rail-row');
    if (row && row.dataset.yachtId) showVessel(row.dataset.yachtId);
  }

  // A board paused by hand and then forgotten is a board showing yesterday. If
  // nobody has touched it for a while, start moving again on its own.
  var RESUME_AFTER_MS = 5 * 60 * 1000;
  var lastActivity = Date.now();

  function noteActivity() {
    lastActivity = Date.now();
  }

  function checkAutoResume() {
    if (App.paused && Date.now() - lastActivity > RESUME_AFTER_MS) {
      App.paused = false;
      App.sceneStartedAt = performance.now();
      setViewTitle();
    }
  }

  function setViewTitle() {
    var scene = App.scenes[App.scene];
    el('view-title').textContent =
      (App.paused ? 'Paused · ' : '') + (VIEW_TITLES[scene.view] || '');
  }

  function onKey(event) {
    switch (event.key) {
      case ' ':
        event.preventDefault();
        App.paused = !App.paused;
        setViewTitle();
        break;
      case 'ArrowRight': enterScene(App.scene + 1); break;
      case 'ArrowLeft': enterScene(App.scene - 1); break;
      case '1': jumpToView('chart'); break;
      case '2': jumpToView('spotlight'); break;
      case '3': jumpToView('stats'); break;
      case 'd': case 'D':
        // Locked installs cannot be talked out of discretion from the keyboard.
        if (window.CONFIG.discreetLocked) break;
        window.CONFIG.discreetMode = !window.CONFIG.discreetMode;
        el('discreet-flag').textContent = window.CONFIG.discreetMode ? 'Discreet mode' : '';
        window.Store.recompute();
        enterScene(App.scene);
        break;
      case 'f': case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
        break;
      case 'r': case 'R': location.reload(); break;
    }
  }

  // Show one yacht now. Used by both click paths. The rotation is not paused —
  // a board that stops because somebody brushed the mouse is worse than one
  // that moves on — but the scene timer restarts, so there is a full dwell to
  // read it before the board carries on.
  function showVessel(yachtId) {
    for (var i = 0; i < App.scenes.length; i++) {
      var scene = App.scenes[i];
      if (scene.view === 'spotlight' && scene.vesselId === yachtId) {
        enterScene(i);
        return true;
      }
    }
    // Spotlight is configured to show a single yacht per cycle, so there is no
    // scene of its own to jump to — render it into the one that exists.
    for (var j = 0; j < App.scenes.length; j++) {
      if (App.scenes[j].view === 'spotlight') {
        App.scenes[j].vesselId = yachtId;
        enterScene(j);
        return true;
      }
    }
    return false;
  }

  function jumpToView(view) {
    for (var i = 0; i < App.scenes.length; i++) {
      if (App.scenes[i].view === view) { enterScene(i); return; }
    }
  }

  window.App = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
