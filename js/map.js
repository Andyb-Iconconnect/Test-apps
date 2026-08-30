/* -----------------------------------------------------------------------------
 * map.js — the chart.
 *
 * A purpose-built canvas renderer rather than a tile-based map library. For an
 * ambient display that is the right trade: no tile requests, no usage policy, no
 * runtime dependency, and complete control over a palette that has to sit
 * quietly on an office wall for eight hours at a time.
 *
 * Coordinates go lon/lat -> normalised Mercator world [0,1] -> screen pixels.
 * The camera eases toward a target rather than jumping, so the board never
 * snaps; it drifts.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Map = {};

  var canvas, ctx, dpr = 1;
  var width = 0, height = 0;
  var land = null, landBounds = null;
  var coarseLand = null, coarseBounds = null;
  var fineLand = null, fineBounds = null;
  // Below this many degrees across the screen the fine coastline is worth its
  // cost; above it the difference is under a pixel and the cost is all there is.
  var DETAIL_BELOW_DEGREES = 90;

  // Offscreen buffer for the shading pass. Kept at half resolution: it is only
  // ever blurred, and blurring at full size costs several times as much to
  // produce an image nobody can tell apart.
  // The chart under the fleet — ocean, depth, graticule, coast glow, land,
  // relief, borders — composited once and kept. None of it changes unless the
  // camera does, and rebuilding it every frame meant three full-canvas blend
  // passes per frame for an image identical to the last one.
  var basemap = null, baseCtx = null, baseKey = '';
  var shade = null, shadeCtx = null;       // crisp land mask
  var blurBuf = null, blurCtx = null;      // the same mask, blurred
  var bevelBuf = null, bevelCtx = null;    // mask minus an offset copy: one edge
  var blurBuf2 = null, blurCtx2 = null;
  var SHADE_DIVISOR = 4;
  var depth = null, depthBounds = null;      // [band][ring]
  var borders = null, borderBounds = null;
  var theme = {};
  var themeKey = '';
  var nightPath = null, nightComputedAt = 0;

  // Camera in normalised world units. `scale` is the pixel width of the whole
  // world, so 1000 means the equator spans 1000px.
  var cam = { cx: 0.5, cy: 0.5, scale: 900 };
  var target = { cx: 0.5, cy: 0.5, scale: 900 };
  var drift = { t: Math.random() * 1000 };

  /* --- Setup ------------------------------------------------------------- */

  Map.init = function (canvasElement) {
    canvas = canvasElement;
    ctx = canvas.getContext('2d', { alpha: false });
    // Two levels of coastline. The fine one is five times the points, which at
    // world zoom — where every ring is traced once per world repeat — measured
    // 474 ms a frame, or two frames a second on a board that has to run all day.
    // Culling handles the zoomed-in case on its own; it is only the wide views
    // that need the coarse copy.
    coarseLand = window.Geo.decodeLand(window.WORLD_LAND_ENCODED, window.WORLD_LAND_SCALE);
    coarseBounds = coarseLand.map(ringBounds);
    if (window.WORLD_LAND_DETAIL_ENCODED) {
      fineLand = window.Geo.decodeLand(window.WORLD_LAND_DETAIL_ENCODED,
                                       window.WORLD_LAND_DETAIL_SCALE);
      fineBounds = fineLand.map(ringBounds);
    }
    land = coarseLand;
    landBounds = coarseBounds;

    // Both optional: the board runs without either file, just flatter.
    if (window.WORLD_DEPTH_ENCODED) {
      var all = window.Geo.decodeLand(window.WORLD_DEPTH_ENCODED, window.WORLD_DEPTH_SCALE);
      var counts = window.WORLD_DEPTH_BANDS || [all.length];
      depth = [];
      var at = 0;
      for (var b = 0; b < counts.length; b++) {
        depth.push(all.slice(at, at + counts[b]));
        at += counts[b];
      }
      depthBounds = depth.map(function (band) { return band.map(ringBounds); });
    }
    if (window.WORLD_BORDERS_ENCODED) {
      borders = window.Geo.decodeLand(window.WORLD_BORDERS_ENCODED, window.WORLD_BORDERS_SCALE);
      borderBounds = borders.map(ringBounds);
    }
    readTheme();
    Map.resize();
  };

  // The palette lives in CSS so there is exactly one place to retint the board.
  // A twilight tint is stored as one rgba token but used as two things: the hue
  // goes in fillStyle and the strength on globalAlpha, because `multiply` takes
  // its weight from globalAlpha.
  function splitAlpha(rgba) {
    var m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/.exec(rgba);
    if (!m) return { colour: rgba, alpha: 1 };
    return {
      colour: 'rgb(' + Math.round(+m[1]) + ',' + Math.round(+m[2]) + ',' + Math.round(+m[3]) + ')',
      alpha: m[4] === undefined ? 1 : +m[4]
    };
  }
  Map._splitAlpha = splitAlpha;

  function readTheme() {
    var s = getComputedStyle(document.documentElement);
    function v(name, fallback) {
      var raw = s.getPropertyValue(name);
      return (raw && raw.trim()) || fallback;
    }
    themeKey = String(Math.random());     // any retint invalidates the basemap
    theme = {
      ocean: v('--map-ocean', '#0a141d'),
      oceanDeep: v('--map-ocean-deep', '#07101a'),
      land: v('--map-land', '#1b2632'),
      coast: v('--map-coast', '#31435a'),
      graticule: v('--map-graticule', '#16222f'),
      night: v('--map-night', 'rgba(40, 55, 150, 0.72)'),
      duskWarm: v('--twilight-dusk', 'rgba(255, 205, 165, 0.245)'),
      civil: v('--twilight-civil', 'rgba(170, 150, 235, 0.374)'),
      nautical: v('--twilight-nautical', 'rgba(105, 120, 215, 0.504)'),
      astro: v('--twilight-astro', 'rgba(60, 78, 180, 0.626)'),
      track: v('--map-track', '#2f6ea8'),
      underway: v('--status-underway', '#3987e5'),
      anchored: v('--status-anchored', '#199e70'),
      moored: v('--status-moored', '#8b98a8'),
      dark: v('--status-dark', '#6c7a8c'),
      label: v('--text-primary', '#ffffff'),
      labelDim: v('--text-secondary', '#c3c2b7'),
      panel: v('--surface-2', '#111820'),
      depth200: v('--map-depth-200', '#0B1826'),
      depth1000: v('--map-depth-1000', '#081220'),
      border: v('--map-border', 'rgba(147, 190, 220, 0.22)'),
      courseLine: v('--map-course', 'rgba(60, 180, 228, 0.45)'),
      wind: v('--map-wind', 'rgba(147, 190, 220, 0.6)'),
      placeWater: v('--map-place-water', 'rgba(147, 190, 220, 0.55)'),
      placeLand: v('--map-place-land', 'rgba(20, 40, 62, 0.75)')
    };
  }
  Map.readTheme = function () { readTheme(); baseKey = ''; };

  Map.resize = function () {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);   // 2 is plenty; 3 just burns GPU
    var rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /* --- Projection -------------------------------------------------------- */

  function sx(worldX) { return (worldX - cam.cx) * cam.scale + width / 2; }
  function sy(worldY) { return (worldY - cam.cy) * cam.scale + height / 2; }

  Map.project = function (lon, lat) {
    return [sx(window.Geo.worldX(lon)), sy(window.Geo.worldY(lat))];
  };

  // How many world-widths of horizontal shift are on screen. Above a certain
  // zoom-out the world repeats, and land has to be drawn more than once.
  function worldRepeats() {
    var visible = width / cam.scale;
    return visible > 1 ? Math.ceil(visible / 2) + 1 : 1;
  }

  /* --- Camera ------------------------------------------------------------ */

  // Fit a set of [lon, lat] points, choosing the shorter way around the globe so
  // a fleet split between the Med and the Caribbean frames across the Atlantic
  // rather than the long way over Asia.
  // `inset` optionally reserves screen space that is covered by chrome — the
  // fleet rail sits over the left of the chart, and a fit that ignores it drops
  // half the Caribbean behind the panel.
  Map.fit = function (points, paddingPx, maxScale, inset) {
    if (!points.length) return;
    var insetLeft = (inset && inset.left) || 0;
    var insetRight = (inset && inset.right) || 0;
    var xs = points.map(function (p) { return window.Geo.worldX(p[0]); });
    var ys = points.map(function (p) { return window.Geo.worldY(p[1]); });

    var direct = spread(xs, false);
    var wrapped = spread(xs.map(function (x) { return x < 0.5 ? x + 1 : x; }), true);
    var best = wrapped.range < direct.range ? wrapped : direct;

    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var pad = paddingPx == null ? 90 : paddingPx;
    var spanX = Math.max(best.range, 0.004);
    var spanY = Math.max(maxY - minY, 0.004);

    var usableWidth = Math.max(120, width - insetLeft - insetRight - pad * 2);
    var scale = Math.min(usableWidth / spanX, (height - pad * 2) / spanY);
    scale = Math.max(140, Math.min(maxScale || 60000, scale));

    // Shift the centre so the content lands in the free area, not under the rail.
    var centreShift = (insetLeft - insetRight) / 2 / scale;
    target.cx = ((best.min + best.range / 2 - centreShift) % 1 + 1) % 1;
    target.cy = (minY + maxY) / 2;
    target.scale = scale;
  };

  function spread(values, wrapped) {
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    return { min: min, max: max, range: max - min, wrapped: wrapped };
  }

  Map.centreOn = function (lon, lat, scale, inset) {
    var s = scale || target.scale;
    var shift = inset ? (((inset.left || 0) - (inset.right || 0)) / 2 / s) : 0;
    target.cx = window.Geo.worldX(lon) - shift;
    target.cy = window.Geo.worldY(lat);
    target.scale = s;
  };

  Map.snap = function () {
    cam.cx = target.cx; cam.cy = target.cy; cam.scale = target.scale;
  };

  // Exponential easing, framerate-independent.
  function easeCamera(dtMs) {
    var k = 1 - Math.pow(0.0022, dtMs / 1000);
    // Longitude eases the short way round the world.
    var dx = target.cx - cam.cx;
    if (dx > 0.5) dx -= 1; else if (dx < -0.5) dx += 1;
    cam.cx = (cam.cx + dx * k + 1) % 1;
    cam.cy += (target.cy - cam.cy) * k;
    // Zoom is eased in log space so it feels linear.
    cam.scale = Math.exp(Math.log(cam.scale) + (Math.log(target.scale) - Math.log(cam.scale)) * k);
  }

  /* --- Frame ------------------------------------------------------------- */

  var lastFrame = 0;

  Map.render = function (now, vessels, options) {
    if (!ctx) return;
    var dt = lastFrame ? Math.min(120, now - lastFrame) : 16;
    lastFrame = now;
    easeCamera(dt);

    var opts = options || {};
    var driftPx = 0, driftPy = 0;
    if (window.CONFIG.display.ambientMotion && !opts.noDrift) {
      // A slow lissajous wander of a few pixels: enough that the image is never
      // truly static, small enough that nobody notices it happening.
      drift.t += dt / 1000;
      driftPx = Math.sin(drift.t / 23) * 6;
      driftPy = Math.cos(drift.t / 31) * 4;
    }

    ctx.save();
    ctx.translate(driftPx, driftPy);

    drawBasemap();
    if (opts.showNight !== false) drawNight(now);

    // Vessel labels are laid out before anything else is written over the chart,
    // so the port names can be told which space is already spoken for. Yachts
    // win; ports yield. Then everything is painted in z-order.
    var placed = locateVessels(vessels);
    var labels, claimed;
    if (Map.profile) {
      var m2 = function (name, fn) {
        var t = performance.now(); var r = fn();
        Map.profile[name] = (Map.profile[name] || 0) + (performance.now() - t); return r;
      };
      labels = m2('layout', function () { return opts.labels === false ? [] : layoutLabels(placed, opts); });
      claimed = labels.map(function (l) { return l.box; }).concat(markerBoxes(placed));
      claimed = claimed.concat(m2('places', function () { return drawPlaces(claimed, opts); }));
      m2('ports', function () { drawPorts(claimed); });
      m2('courses', function () { drawCourses(vessels); });
      m2('tracks', function () { drawTracks(vessels); });
      m2('markers', function () { paintMarkers(placed, opts, now); });
      m2('wind', function () { drawWind(placed); });
      m2('labels', function () { paintLabels(labels); });
      m2('scale', function () { drawScaleBar(opts); });
    } else {
      labels = opts.labels === false ? [] : layoutLabels(placed, opts);
      claimed = labels.map(function (l) { return l.box; }).concat(markerBoxes(placed));
      // Place names go under the ports and the fleet, and yield to both.
      claimed = claimed.concat(drawPlaces(claimed, opts));
      drawPorts(claimed);
      drawCourses(vessels);
      drawTracks(vessels);
      paintMarkers(placed, opts, now);
      drawWind(placed);
      paintLabels(labels);
      drawScaleBar(opts);
    }

    ctx.restore();

    // Kept so a pointer can be matched against the marks. The drift offset has
    // to come with it: the markers are drawn through a translated context, so
    // their screen position is the projected position plus the drift.
    // Labels come with it: they are the thing most likely to collide with
    // something new, and a check that can read them is worth more than one that
    // has to squint at a screenshot.
    Map.lastFrame = { placed: placed, labels: labels, driftX: driftPx, driftY: driftPy };
    return placed;
  };

  // The vessel nearest a point on the canvas, within a comfortable finger's
  // reach. Returns null when the click was on open sea.
  Map.hitTest = function (x, y, radius) {
    var frame = Map.lastFrame;
    if (!frame) return null;
    var limit = radius || 30;
    var best = null, bestDistance = limit;
    for (var i = 0; i < frame.placed.length; i++) {
      var p = frame.placed[i];
      var d = Math.hypot(x - (p.x + frame.driftX), y - (p.y + frame.driftY));
      if (d < bestDistance) { bestDistance = d; best = p.vessel; }
    }
    return best;
  };

  /**
   * The static chart, drawn once per camera position and blitted thereafter.
   *
   * Ambient drift is a translate of the whole scene, so it does not invalidate
   * this; only a real camera move does. On a board that holds a view for
   * seventy-five seconds at a time, that is one rebuild and two thousand
   * blits.
   */
  function drawBasemap() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var key = [cam.cx.toFixed(4), cam.cy.toFixed(4), cam.scale.toFixed(2),
               width, height, themeKey].join('|');

    if (!basemap) { basemap = document.createElement('canvas'); baseCtx = basemap.getContext('2d'); }
    if (basemap.width !== Math.round(width * dpr) || basemap.height !== Math.round(height * dpr)) {
      basemap.width = Math.round(width * dpr);
      basemap.height = Math.round(height * dpr);
      baseKey = '';
    }

    if (key !== baseKey) {
      baseKey = key;
      var main = ctx;
      ctx = baseCtx;                       // the draw functions all write to `ctx`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawOcean();
      drawDepth();
      drawGraticule();
      pickDetail();
      buildShadeMask();
      drawCoastGlow();
      drawLand();
      drawLandRelief();
      drawBorders();
      ctx = main;
    }
    ctx.drawImage(basemap, 0, 0, width, height);
  }

  function drawOcean() {
    ctx.fillStyle = theme.oceanDeep;
    ctx.fillRect(-20, -20, width + 40, height + 40);
    // A soft vertical wash stops a large flat expanse of sea reading as dead space.
    var g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, theme.ocean);
    g.addColorStop(1, theme.oceanDeep);
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, width + 40, height + 40);
  }

  function drawGraticule() {
    // Step down as we zoom in, so the grid stays a texture and never a cage.
    var degreesOnScreen = (width / cam.scale) * 360;
    var step = degreesOnScreen > 200 ? 30
             : degreesOnScreen > 90 ? 15
             : degreesOnScreen > 30 ? 5
             : degreesOnScreen > 10 ? 2 : 1;

    ctx.strokeStyle = theme.graticule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var lat = -80; lat <= 80; lat += step) {
      var y = sy(window.Geo.worldY(lat));
      if (y < -10 || y > height + 10) continue;
      ctx.moveTo(0, y); ctx.lineTo(width, y);
    }
    for (var lon = -180; lon <= 180; lon += step) {
      for (var r = -worldRepeats(); r <= worldRepeats(); r++) {
        var x = sx(window.Geo.worldX(lon) + r);
        if (x < -10 || x > width + 10) continue;
        ctx.moveTo(x, 0); ctx.lineTo(x, height);
      }
    }
    ctx.stroke();
  }

  function ringBounds(ring) {
    var minX = 181, maxX = -181, minY = 91, maxY = -91;
    for (var i = 0; i < ring.length; i += 2) {
      if (ring[i] < minX) minX = ring[i];
      if (ring[i] > maxX) maxX = ring[i];
      if (ring[i + 1] < minY) minY = ring[i + 1];
      if (ring[i + 1] > maxY) maxY = ring[i + 1];
    }
    return {
      minX: window.Geo.worldX(minX), maxX: window.Geo.worldX(maxX),
      minY: window.Geo.worldY(maxY), maxY: window.Geo.worldY(minY),
      // Approximate on-screen size, used to drop islands too small to see.
      spanX: window.Geo.worldX(maxX) - window.Geo.worldX(minX),
      spanY: window.Geo.worldY(minY) - window.Geo.worldY(maxY)
    };
  }

  /**
   * Depth, painted over the ocean and under the graticule.
   *
   * Natural Earth's bands are "water DEEPER than N metres", not shallower —
   * the deep Atlantic is inside the 200 m polygon and the English Channel is
   * not. So they nest with the abyss innermost and are drawn shallowest first,
   * each one a step darker: --map-ocean is the shelf, and the sea falls away
   * from it. Reading them the other way round paints the ocean pale and the
   * continental shelves dark, which is how this first came out.
   *
   * Filled nonzero rather than even-odd. Even-odd cancels wherever two rings
   * overlap, and after simplification plenty of them do, which turns a coastal
   * shelf into a moth-eaten one.
   */
  function drawDepth() {
    if (!depth) return;
    var repeats = worldRepeats();
    var degPerPx = (width / cam.scale) * 360 / width;
    var stride = degPerPx > 0.6 ? 4 : degPerPx > 0.25 ? 2 : 1;
    var fills = [theme.depth200, theme.depth1000];

    // One path per band, filled once. Filling each ring separately was correct
    // and cost up to fourteen hundred fill() calls a frame at world zoom, which
    // was most of a sixty-millisecond frame. Nonzero does not cancel where two
    // rings overlap, so batching them is safe — that was the only reason to
    // keep them apart.
    for (var band = 0; band < depth.length; band++) {
      ctx.beginPath();
      for (var i = 0; i < depth[band].length; i++) {
        var bounds = depthBounds[band][i];
        // Below a couple of pixels a contour is noise, not shape.
        if ((bounds.spanX * cam.scale) < 3 && (bounds.spanY * cam.scale) < 3) continue;
        for (var r = -repeats; r <= repeats; r++) {
          if (!visible(bounds, r)) continue;
          traceRing(depth[band][i], r, stride);
        }
      }
      ctx.fillStyle = fills[Math.min(band, fills.length - 1)];
      ctx.fill();
    }
  }

  // Whether a ring's bounds fall anywhere on screen in world copy `r`.
  function visible(bounds, r) {
    var left = sx(bounds.minX + r), right = sx(bounds.maxX + r);
    if (right < -40 || left > width + 40) return false;
    var top = sy(bounds.minY), bottom = sy(bounds.maxY);
    return !(bottom < -40 || top > height + 40);
  }

  /**
   * International boundaries. Coastlines are deliberately absent from the data:
   * the land layer already draws those, and a second pass over them thickens
   * every shore in the world.
   */
  function drawBorders() {
    if (!borders) return;
    var repeats = worldRepeats();
    // Only worth drawing once a country is big enough on screen to be worth
    // naming; below that they are a grey haze over the land.
    if (cam.scale < 900) return;

    ctx.beginPath();
    for (var i = 0; i < borders.length; i++) {
      for (var r = -repeats; r <= repeats; r++) {
        if (!visible(borderBounds[i], r)) continue;
        var line = borders[i];
        ctx.moveTo(sx(window.Geo.worldX(line[0]) + r), sy(window.Geo.worldY(line[1])));
        for (var k = 2; k < line.length; k += 2) {
          ctx.lineTo(sx(window.Geo.worldX(line[k]) + r), sy(window.Geo.worldY(line[k + 1])));
        }
      }
    }
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Everything that stops the chart reading as two flat colours.
   *
   * The land silhouette goes once into a half-size offscreen buffer — it is
   * only ever blurred, and blurring at full size costs several times as much
   * for an image nobody can tell apart. That one mask then does two jobs, on
   * either side of the land fill:
   *
   *   before — blurred wide and screened on, it throws a glow off every coast
   *            into the water. Drawn BEFORE the fill so the land itself paints
   *            over the middle of it and only the spill shows; drawn after, it
   *            washes the fill out, and canvas has no inverse clip to fix that.
   *
   *   after  — blurred tight, offset up-left and screened, then down-right and
   *            multiplied. An emboss. It is not topography and does not pretend
   *            to be, there being no free global relief raster this can reach,
   *            but it gives a landmass a body instead of a flat fill, which is
   *            what flat meant.
   */
  function buildShadeMask() {
    if (!window.CONFIG.display.landShading) return false;
    var w = Math.max(1, Math.round(width / SHADE_DIVISOR));
    var h = Math.max(1, Math.round(height / SHADE_DIVISOR));
    if (!shade) { shade = document.createElement('canvas'); shadeCtx = shade.getContext('2d'); }
    if (shade.width !== w || shade.height !== h) { shade.width = w; shade.height = h; }

    shadeCtx.setTransform(1 / SHADE_DIVISOR, 0, 0, 1 / SHADE_DIVISOR, 0, 0);
    shadeCtx.clearRect(0, 0, width, height);
    shadeCtx.fillStyle = '#ffffff';
    shadeCtx.beginPath();
    traceVisibleLand(shadeCtx);
    shadeCtx.fill('evenodd');
    return true;
  }

  /**
   * Blur the mask into the small buffer and hand it back.
   *
   * The blur happens here, at a quarter resolution, and never on the main
   * canvas: a 30-pixel blur across 1920x1080 measured 117 ms a frame, where the
   * same effect on a quarter-size buffer with a quarter-size kernel is a
   * fraction of a millisecond. Scaling the result back up smooths it further,
   * for free.
   */
  function blurredMask(mainCanvasPx) {
    if (!blurBuf) { blurBuf = document.createElement('canvas'); blurCtx = blurBuf.getContext('2d'); }
    if (blurBuf.width !== shade.width || blurBuf.height !== shade.height) {
      blurBuf.width = shade.width; blurBuf.height = shade.height;
    }
    blurCtx.setTransform(1, 0, 0, 1, 0, 0);
    blurCtx.clearRect(0, 0, blurBuf.width, blurBuf.height);
    blurCtx.filter = 'blur(' + (mainCanvasPx / SHADE_DIVISOR).toFixed(2) + 'px)';
    blurCtx.drawImage(shade, 0, 0);
    blurCtx.filter = 'none';
    return blurBuf;
  }

  function drawCoastGlow() {
    if (!shade || !window.CONFIG.display.landShading) return;
    var glow = blurredMask(Math.min(34, Math.max(8, cam.scale / 2400)));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.45;
    ctx.drawImage(glow, 0, 0, width, height);
    ctx.restore();
  }

  /**
   * A crescent of the mask along one side: the land, minus the same land shifted.
   *
   * Screening and multiplying the WHOLE mask, offset each way, was the obvious
   * emboss and the wrong one — both passes cover the interior, so the interior
   * came out darker than the fill and every landmass lost its colour. Taking
   * the difference leaves the flat middle untouched and puts the light and the
   * shade only where there is an edge, which is what a bevel is.
   */
  function bevelMask(dx, dy, blurPx) {
    if (!bevelBuf) { bevelBuf = document.createElement('canvas'); bevelCtx = bevelBuf.getContext('2d'); }
    if (bevelBuf.width !== shade.width || bevelBuf.height !== shade.height) {
      bevelBuf.width = shade.width; bevelBuf.height = shade.height;
    }
    var k = SHADE_DIVISOR;
    bevelCtx.setTransform(1, 0, 0, 1, 0, 0);
    bevelCtx.globalCompositeOperation = 'source-over';
    bevelCtx.clearRect(0, 0, bevelBuf.width, bevelBuf.height);
    bevelCtx.drawImage(shade, 0, 0);
    bevelCtx.globalCompositeOperation = 'destination-out';
    bevelCtx.drawImage(shade, dx / k, dy / k);
    bevelCtx.globalCompositeOperation = 'source-over';

    // Soften the crescent. Done on this buffer, never on the main canvas.
    if (!blurBuf2) { blurBuf2 = document.createElement('canvas'); blurCtx2 = blurBuf2.getContext('2d'); }
    if (blurBuf2.width !== shade.width || blurBuf2.height !== shade.height) {
      blurBuf2.width = shade.width; blurBuf2.height = shade.height;
    }
    blurCtx2.setTransform(1, 0, 0, 1, 0, 0);
    blurCtx2.clearRect(0, 0, blurBuf2.width, blurBuf2.height);
    blurCtx2.filter = 'blur(' + (blurPx / k).toFixed(2) + 'px)';
    blurCtx2.drawImage(bevelBuf, 0, 0);
    blurCtx2.filter = 'none';
    return blurBuf2;
  }

  function drawLandRelief() {
    if (!shade || !window.CONFIG.display.landShading) return;
    var reliefPx = Math.min(14, Math.max(3.5, cam.scale / 6000));
    var d = Math.max(1.5, reliefPx * 0.8);

    ctx.save();
    // Light off the north-west shore.
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.5;
    ctx.drawImage(bevelMask(d, d, reliefPx), 0, 0, width, height);
    // Shade along the south-east.
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.45;
    ctx.drawImage(bevelMask(-d, -d, reliefPx), 0, 0, width, height);
    ctx.restore();
  }

  function pickDetail() {
    var useFine = fineLand && ((width / cam.scale) * 360) < DETAIL_BELOW_DEGREES;
    land = useFine ? fineLand : coarseLand;
    landBounds = useFine ? fineBounds : coarseBounds;
  }

  function drawLand() {
    // Stride: when zoomed out there is no point emitting a lineTo for detail
    // finer than a pixel.
    var degPerPx = (width / cam.scale) * 360 / width;
    // Measured: filling and then stroking one path of forty thousand segments
    // was 57 ms a frame at world zoom, most of the frame. Striding harder when
    // a whole hemisphere is on screen costs nothing visible — at 0.19 degrees
    // per pixel every fourth point is still finer than the display.
    var stride = degPerPx > 0.15 ? 8 : degPerPx > 0.06 ? 4 : degPerPx > 0.02 ? 2 : 1;

    ctx.beginPath();
    traceVisibleLand(ctx);
    ctx.fillStyle = theme.land;
    ctx.fill('evenodd');          // interior rings punch out lakes and inland seas
    // A hairline coast is what separates land from sea where the fill alone
    // reads as haze. It costs a second pass over the same path, so it is
    // skipped at the zooms where it is a sub-pixel shimmer nobody can see and
    // half the frame budget.
    if (degPerPx < 0.15) {
      ctx.strokeStyle = theme.coast;
      ctx.globalAlpha = cam.scale > 1800 ? 1 : 0.55;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function traceRing(ring, worldOffset, stride, into) {
    var target = into || ctx;
    var n = ring.length;
    target.moveTo(sx(window.Geo.worldX(ring[0]) + worldOffset), sy(window.Geo.worldY(ring[1])));
    for (var i = 2 * stride; i < n; i += 2 * stride) {
      target.lineTo(sx(window.Geo.worldX(ring[i]) + worldOffset), sy(window.Geo.worldY(ring[i + 1])));
    }
    target.closePath();
  }

  // Every land ring currently on screen, traced into whichever context is given.
  // Shared by the fill and by the shading buffer so the two can never disagree
  // about where the coast is.
  function traceVisibleLand(into) {
    var repeats = worldRepeats();
    var degPerPx = (width / cam.scale) * 360 / width;
    var stride = degPerPx > 0.15 ? 8 : degPerPx > 0.06 ? 4 : degPerPx > 0.02 ? 2 : 1;
    for (var r = -repeats; r <= repeats; r++) {
      for (var i = 0; i < land.length; i++) {
        var b = landBounds[i];
        if (b.spanX * cam.scale < 1.5 && b.spanY * cam.scale < 1.5) continue;
        var left = sx(b.minX + r), right = sx(b.maxX + r);
        if (right < -40 || left > width + 40) continue;
        var top = sy(b.minY), bottom = sy(b.maxY);
        if (bottom < -40 || top > height + 40) continue;
        traceRing(land[i], r, stride, into);
      }
    }
  }

  /* --- Night ------------------------------------------------------------- */

  // Dusk, drawn as it happens: a narrow warm band on the daylight side of the
  // terminator, then civil, nautical and astronomical twilight cooling through
  // violet into deep blue, then night. Bands are filled between successive
  // solar-altitude contours, so the gradient is the real one rather than a wash
  // with a hard edge.
  // Colours come from the token stylesheet, like every other colour on the board.
  var DUSK_ALTITUDE = 5;

  function drawNight(now) {
    if (!nightPath || now - nightComputedAt > 60000) {
      nightPath = window.Geo.twilightContours(new Date(), [-6, -12, -18], 2);
      nightPath.dusk = window.Geo.altitudeContour(new Date(), DUSK_ALTITUDE, 2).points;
      nightComputedAt = now;
    }

    var c = nightPath.contours;              // [terminator, -6, -12, -18]
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    fillBetween(nightPath.dusk, c[0], theme.duskWarm);
    fillBetween(c[0], c[1], theme.civil);
    fillBetween(c[1], c[2], theme.nautical);
    fillBetween(c[2], c[3], theme.astro);
    fillBeyond(c[3], theme.night);
    ctx.restore();
  }

  // The strip between two contours: out along the first, back along the second.
  function fillBetween(upper, lower, fill) {
    var repeats = worldRepeats();
    ctx.save();
    ctx.beginPath();
    for (var r = -repeats; r <= repeats; r++) {
      for (var i = 0; i < upper.length; i++) {
        var x = sx(window.Geo.worldX(upper[i][0]) + r);
        var y = sy(window.Geo.worldY(upper[i][1]));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (var j = lower.length - 1; j >= 0; j--) {
        ctx.lineTo(sx(window.Geo.worldX(lower[j][0]) + r), sy(window.Geo.worldY(lower[j][1])));
      }
      ctx.closePath();
    }
    var tint = splitAlpha(fill);
    ctx.fillStyle = tint.colour;
    ctx.globalAlpha = tint.alpha;
    ctx.fill();
    ctx.restore();
  }

  // Everything darker than the last contour, closed off the edge of the canvas
  // at whichever pole is currently in darkness.
  function fillBeyond(contour, fill) {
    var repeats = worldRepeats();
    var edgeY = nightPath.nightAtNorthPole ? -1000 : height + 1000;
    ctx.save();
    ctx.beginPath();
    for (var r = -repeats; r <= repeats; r++) {
      var firstX = sx(window.Geo.worldX(contour[0][0]) + r);
      ctx.moveTo(firstX, sy(window.Geo.worldY(contour[0][1])));
      for (var i = 1; i < contour.length; i++) {
        ctx.lineTo(sx(window.Geo.worldX(contour[i][0]) + r), sy(window.Geo.worldY(contour[i][1])));
      }
      ctx.lineTo(sx(window.Geo.worldX(180) + r), edgeY);
      ctx.lineTo(firstX, edgeY);
      ctx.closePath();
    }
    var tint = splitAlpha(fill);
    ctx.fillStyle = tint.colour;
    ctx.globalAlpha = tint.alpha;
    ctx.fill();
    ctx.restore();
  }

  // Yachting hubs, drawn only once the chart is close enough that naming them
  // adds context rather than clutter.
  /**
   * Sea, ocean and country names.
   *
   * Nothing else on the chart said what anything was called: with only port
   * dots it read as a diagram of dots rather than a chart. Seas are set in
   * letter-spaced capitals, which is the convention on paper and does the
   * useful work of distinguishing water from land at a glance.
   *
   * Each name is shown across a band of zooms and hidden outside it — an ocean
   * label makes no sense when the screen is one bay, and a country's does not
   * when the screen is a hemisphere. Everything yields to the fleet.
   */
  function drawPlaces(claimed, opts) {
    if (!window.PLACES || opts.places === false) return [];
    var degreesOnScreen = (width / cam.scale) * 360;
    var mine = [];

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (var i = 0; i < window.PLACES.length; i++) {
      var pl = window.PLACES[i];
      var name = pl[0], kind = pl[3], size = pl[4] || 0;
      var style = placeStyle(kind, size, degreesOnScreen);
      if (!style) continue;

      var x = nearestScreenX(pl[1]);
      var y = sy(window.Geo.worldY(pl[2]));
      if (x < -100 || x > width + 100 || y < 10 || y > height - 10) continue;

      ctx.font = style.font;
      ctx.letterSpacing = style.tracking;
      var w = ctx.measureText(name).width;
      var box = { x: x - w / 2, y: y - style.size, w: w, h: style.size * 2 };
      var leftLimit = (opts.inset && opts.inset.left ? opts.inset.left : 0) + 4;
      if (box.x < leftLimit || box.x + box.w > width - 4) { ctx.letterSpacing = '0px'; continue; }
      if (collides(box, claimed.concat(mine), null)) { ctx.letterSpacing = '0px'; continue; }

      ctx.fillStyle = style.color;
      ctx.globalAlpha = style.alpha;
      ctx.fillText(style.upper ? name.toUpperCase() : name, x, y);
      ctx.globalAlpha = 1;
      ctx.letterSpacing = '0px';
      mine.push(box);
    }
    ctx.restore();
    return mine;
  }

  // Which names belong at this zoom, and how they are set. Returns null for a
  // name that has no business being on screen at all.
  function placeStyle(kind, size, deg) {
    if (kind === 'ocean') {
      if (deg < 70) return null;
      return { font: '400 15px ' + FONT_DISPLAY, tracking: '0.34em', size: 15,
               color: theme.placeWater, alpha: 0.85, upper: true };
    }
    if (kind === 'sea') {
      if (deg > 130 || deg < 2) return null;
      return { font: '400 12px ' + FONT_DISPLAY, tracking: '0.26em', size: 12,
               color: theme.placeWater, alpha: 0.8, upper: true };
    }
    // A country is worth naming once it is a reasonable share of the screen,
    // and stops being worth it when the screen is inside it.
    var share = size / deg;
    if (share < 0.12 || share > 2.5) return null;
    return { font: '400 12px ' + FONT_DISPLAY, tracking: '0.16em', size: 12,
             color: theme.placeLand, alpha: 0.72, upper: true };
  }

  function drawPorts(claimed) {
    if (cam.scale < 12000) return;
    var showNames = cam.scale > 20000;
    var taken = claimed.slice();
    ctx.save();
    ctx.font = '400 11px ' + FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < window.PORTS.length; i++) {
      var p = window.PORTS[i];
      if (p[4] !== 1) continue;                    // hubs only
      var x = sx(window.Geo.worldX(p[2]));
      var y = sy(window.Geo.worldY(p[3]));
      if (x < -40 || x > width + 40 || y < -20 || y > height + 20) continue;

      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = theme.coast;
      ctx.fill();
      if (!showNames) continue;

      // The Ligurian coast alone has five hubs within twenty miles. Drop any
      // name that cannot be placed clear of what is already on the chart.
      var box = { x: x + 6, y: y - 7, w: ctx.measureText(p[0]).width + 4, h: 14 };
      if (box.x + box.w > width - 4) continue;
      if (collides(box, taken, null)) continue;
      taken.push(box);

      ctx.fillStyle = theme.labelDim;
      ctx.globalAlpha = 0.5;
      ctx.fillText(p[0], x + 6, y);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* --- Vessels ----------------------------------------------------------- */

  function statusColor(status) {
    return theme[status] || theme.dark;
  }

  /**
   * The leg still to run: from where she is to the port she says she is bound
   * for, as a great circle.
   *
   * The destination is crew-typed into the AIS static message, so it is intent
   * rather than fact and is drawn as a dashed line rather than a route. A
   * destination naming nowhere in data/ports.js simply is not drawn: guessing
   * at what "ST BARTHS VIA ANTIGUA" means would put a line across the chart
   * that nobody can account for.
   */
  function drawCourses(vessels) {
    if (!vessels) return;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.2;

    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i], d = v.derived;
      if (!d || d.lat == null || d.discreet) continue;
      if (d.status !== 'underway') continue;
      var name = v.voyage && v.voyage.destination;
      if (!name) continue;
      var port = portNamed(name);
      if (!port) continue;

      var legs = greatCircle(d.lon, d.lat, port[0], port[1]);
      if (legs.length < 2) continue;

      ctx.strokeStyle = theme.courseLine;
      ctx.beginPath();
      var offset = nearestScreenX(d.lon) - sx(window.Geo.worldX(d.lon));
      for (var k = 0; k < legs.length; k++) {
        var px = sx(window.Geo.worldX(legs[k][0])) + offset;
        var py = sy(window.Geo.worldY(legs[k][1]));
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // A small ring on the destination, so the line ends somewhere rather
      // than just stopping.
      var ex = sx(window.Geo.worldX(port[0])) + offset;
      var ey = sy(window.Geo.worldY(port[1]));
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(ex, ey, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([6, 5]);
    }
    ctx.restore();
  }

  // Points along the great circle, so a long leg bends the way a passage does
  // rather than running straight across a Mercator chart.
  function greatCircle(lon1, lat1, lon2, lat2, steps) {
    var n = steps || 48;
    var toRad = Math.PI / 180, toDeg = 180 / Math.PI;
    var p1 = lat1 * toRad, l1 = lon1 * toRad, p2 = lat2 * toRad, l2 = lon2 * toRad;
    var dp = p2 - p1, dl = l2 - l1;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    var delta = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
    if (!isFinite(delta) || delta < 1e-9) return [[lon1, lat1], [lon2, lat2]];

    var out = [];
    for (var i = 0; i <= n; i++) {
      var f = i / n;
      var A = Math.sin((1 - f) * delta) / Math.sin(delta);
      var B = Math.sin(f * delta) / Math.sin(delta);
      var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
      var y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
      var z = A * Math.sin(p1) + B * Math.sin(p2);
      out.push([Math.atan2(y, x) * toDeg, Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg]);
    }
    // Unwrap, so a leg crossing the antimeridian does not fold back on itself.
    for (var k = 1; k < out.length; k++) {
      var step = out[k][0] - out[k - 1][0];
      if (step > 180) out[k][0] -= 360;
      else if (step < -180) out[k][0] += 360;
    }
    return out;
  }

  function portNamed(name) {
    var want = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!want) return null;
    for (var i = 0; i < window.PORTS.length; i++) {
      var p = window.PORTS[i];
      var have = p[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]/g, '');
      if (have === want) return [p[2], p[3]];
    }
    return null;
  }

  /**
   * What she is sitting in: an arrow at each marker, pointing the way the wind
   * is blowing, with its speed.
   *
   * Meteorological convention names the direction wind comes FROM, so the arrow
   * points the opposite way — towards where it is going, which is what anyone
   * reading a chart expects an arrow to mean.
   */
  function drawWind(placed) {
    for (var i = 0; i < placed.length; i++) {
      var w = placed[i].vessel.weather;
      if (!w || w.windSpeed == null || w.windDirection == null) continue;
      if (placed[i].vessel.derived.discreet) continue;

      var x = placed[i].x + 22, y = placed[i].y - 20;
      var heading = (w.windDirection + 180) * Math.PI / 180;
      var dx = Math.sin(heading), dy = -Math.cos(heading);
      var len = 9;

      ctx.save();
      ctx.strokeStyle = theme.wind;
      ctx.fillStyle = theme.wind;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - dx * len, y - dy * len);
      ctx.lineTo(x + dx * len, y + dy * len);
      ctx.stroke();
      // Head.
      ctx.beginPath();
      ctx.moveTo(x + dx * len, y + dy * len);
      ctx.lineTo(x + dx * (len - 5) - dy * 3.2, y + dy * (len - 5) + dx * 3.2);
      ctx.lineTo(x + dx * (len - 5) + dy * 3.2, y + dy * (len - 5) - dx * 3.2);
      ctx.closePath();
      ctx.fill();

      ctx.font = '400 10px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(w.windSpeed) + ' kn', x + 13, y);
      ctx.restore();
    }
  }

  /**
   * A nautical scale bar. Every chart has one; this had none, so nothing on
   * screen said whether two yachts were ten miles apart or a thousand.
   *
   * Sized by measuring a real distance across the middle of the view rather
   * than from the projection constant, because Mercator's scale changes with
   * latitude and a bar computed at the equator lies everywhere else.
   */
  function drawScaleBar(opts) {
    var lat = window.Geo.latFromWorldY(cam.cy);
    var lonPerPx = 360 / cam.scale;
    var nmPerPx = window.Geo.distanceNm(0, lat, lonPerPx, lat);
    if (!isFinite(nmPerPx) || nmPerPx <= 0) return;

    // The nearest sensible round number under a fifth of the width.
    var target = nmPerPx * Math.min(220, width * 0.2);
    var steps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000];
    var nm = steps[0];
    for (var i = 0; i < steps.length; i++) if (steps[i] <= target) nm = steps[i];
    var barPx = nm / nmPerPx;

    // Clear of the fleet rail, which the label layout already avoids and which
    // the bar was sitting squarely behind.
    var x = ((opts && opts.inset && opts.inset.left) || 0) + 26;
    var y = height - 26;
    ctx.save();
    ctx.strokeStyle = theme.labelDim;
    ctx.fillStyle = theme.labelDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
    ctx.moveTo(x, y); ctx.lineTo(x + barPx, y);
    ctx.moveTo(x + barPx / 2, y - 3); ctx.lineTo(x + barPx / 2, y + 3);
    ctx.moveTo(x + barPx, y - 4); ctx.lineTo(x + barPx, y + 4);
    ctx.stroke();

    ctx.font = '400 11px ' + FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(nm >= 1000 ? (nm / 1000) + ',000 nm' : nm + ' nm', x + barPx + 8, y + 4);
    ctx.restore();
  }

  function drawTracks(vessels) {
    vessels.forEach(function (v) {
      var d = v.derived;
      if (!v.track || v.track.length < 2 || d.lat == null) return;
      if (d.discreet) return;      // a track is a movement pattern; don't publish it

      var pts = v.track;
      var color = statusColor(d.status);
      // Fade the tail out so the eye reads direction without an arrowhead.
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i];
        var ax = sx(window.Geo.worldX(a.lon)), ay = sy(window.Geo.worldY(a.lat));
        var bx = sx(window.Geo.worldX(b.lon)), by = sy(window.Geo.worldY(b.lat));
        // Skip the seam when a track crosses the antimeridian.
        if (Math.abs(bx - ax) > width * 0.6) continue;
        if ((ax < -50 && bx < -50) || (ax > width + 50 && bx > width + 50)) continue;
        ctx.globalAlpha = 0.06 + 0.5 * (i / pts.length);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
  }

  // Where each yacht lands on screen — no drawing, so labels can be laid out
  // before anything is committed to the canvas.
  function locateVessels(vessels) {
    var placed = [];
    // Quiet ones first, so an active yacht is never painted over.
    var order = vessels.slice().sort(function (a, b) {
      return rank(a.derived.status) - rank(b.derived.status);
    });

    order.forEach(function (v) {
      var d = v.derived;
      if (d.lat == null) return;
      var x = nearestScreenX(d.lon);
      var y = sy(window.Geo.worldY(d.lat));
      if (x < -80 || x > width + 80 || y < -80 || y > height + 80) return;
      placed.push({ vessel: v, x: x, y: y, color: statusColor(d.status) });
    });
    return placed;
  }

  function markerBoxes(placed) {
    var boxes = [];
    placed.forEach(function (p) {
      boxes.push({ x: p.x - 9, y: p.y - 9, w: 18, h: 18, owner: p.vessel.yacht.id });
      // The wind arrow and its speed sit up and to the right of the marker.
      // Without claiming that space the name label lands on top of it, which is
      // exactly what happened the first time.
      if (windBox(p)) boxes.push(windBox(p));
    });
    return boxes;
  }

  function windBox(p) {
    var w = p.vessel.weather;
    if (!w || w.windSpeed == null || w.windDirection == null) return null;
    if (p.vessel.derived.discreet) return null;
    // Centre (p.x + 22, p.y - 20), arrow half-length 9, then the speed out to +48.
    //
    // Deliberately NOT owned by the vessel. `collides` lets a label sit on its
    // own marker, which is right for the marker and wrong for this: her name
    // would land squarely on her own wind arrow, which is what it did.
    return { x: p.x + 10, y: p.y - 32, w: 62, h: 24, tight: true };
  }

  function paintMarkers(placed, opts, now) {
    var highlightId = opts.highlight;
    placed.forEach(function (p) {
      var v = p.vessel, d = v.derived;
      var isHighlight = highlightId && v.yacht.id === highlightId;
      var course = d.status === 'underway'
        ? (v.fix.cog != null ? v.fix.cog : v.fix.heading)
        : null;

      if (d.discreet) {
        drawDiscreetArea(p.x, p.y, p.color, d);
      } else if (d.status === 'underway' && course != null) {
        drawUnderwayPulse(p.x, p.y, p.color, now);
        drawChevron(p.x, p.y, course, p.color, isHighlight);
      } else {
        drawStationary(p.x, p.y, p.color, d.status, isHighlight);
      }

      if (isHighlight) drawHighlightRing(p.x, p.y, p.color, now);
    });
  }

  function rank(status) {
    return { moored: 0, dark: 2, anchored: 3, underway: 4, unknown: 0 }[status] || 0;
  }

  // With the world repeating, pick the copy of this longitude nearest the centre
  // of the screen so a marker never lands on the wrong side of the seam.
  function nearestScreenX(lon) {
    var base = window.Geo.worldX(lon);
    var bestX = sx(base), bestDist = Math.abs(bestX - width / 2);
    for (var r = -2; r <= 2; r++) {
      if (r === 0) continue;
      var x = sx(base + r);
      var dist = Math.abs(x - width / 2);
      if (dist < bestDist) { bestDist = dist; bestX = x; }
    }
    return bestX;
  }

  function drawChevron(x, y, course, color, big) {
    var s = big ? 13 : 10;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(course * Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.62, s * 0.72);
    ctx.lineTo(0, s * 0.34);
    ctx.lineTo(-s * 0.62, s * 0.72);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    // A ring of surface colour keeps the mark legible against dark land.
    ctx.strokeStyle = theme.oceanDeep;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawStationary(x, y, color, status, big) {
    var r = big ? 8 : 6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = status === 'dark' ? theme.oceanDeep : color;
    ctx.fill();
    ctx.lineWidth = status === 'dark' ? 2 : 2;
    ctx.strokeStyle = status === 'dark' ? color : theme.oceanDeep;
    if (status === 'dark') ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawUnderwayPulse(x, y, color, now) {
    var phase = (now % 3200) / 3200;
    var radius = 10 + phase * 22;
    ctx.globalAlpha = 0.28 * (1 - phase);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawHighlightRing(x, y, color, now) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -(now / 60) % 100;
    ctx.stroke();
    ctx.restore();
  }

  // A discreet yacht gets an area, not a point — deliberately imprecise, and
  // visibly so, rather than a false pinpoint.
  function drawDiscreetArea(x, y, color, d) {
    var radiusPx = Math.max(18, (window.CONFIG.discreetRoundingNm / 60) * (cam.scale / 360) * 1.4);
    radiusPx = Math.min(radiusPx, 140);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.10;
    ctx.fill();
    ctx.globalAlpha = 0.65;
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  /* --- Labels ------------------------------------------------------------ */

  // Eight yachts, several of them anchored within a mile of each other, will
  // collide unless placement is tried in order of preference and checked.
  var LABEL_OFFSETS = [
    [16, 0, 'left'], [-16, 0, 'right'],
    [14, -18, 'left'], [-14, -18, 'right'],
    [14, 18, 'left'], [-14, 18, 'right'],
    [0, -26, 'center'], [0, 28, 'center']
  ];

  function layoutLabels(placed, opts) {
    // Seed the occupancy list with the markers, so a label never lands on top of
    // another yacht's chevron.
    var boxes = markerBoxes(placed);
    var out = [];
    var scale = opts.labelScale || 1;
    var nameSize = Math.round(14 * scale);
    var subSize = Math.round(11 * scale);

    placed.forEach(function (p) {
      var v = p.vessel, d = v.derived;
      var name = v.yacht.name;
      var sub = labelSub(v);

      ctx.font = '500 ' + nameSize + 'px ' + FONT_DISPLAY;
      var nameWidth = ctx.measureText(name).width;
      ctx.font = '400 ' + subSize + 'px ' + FONT;
      var subWidth = sub ? ctx.measureText(sub).width : 0;
      var boxW = Math.max(nameWidth, subWidth) + 10;
      var boxH = sub ? nameSize + subSize + 6 : nameSize + 2;

      var chosen = null;
      for (var i = 0; i < LABEL_OFFSETS.length; i++) {
        var o = LABEL_OFFSETS[i];
        var bx = o[2] === 'left' ? p.x + o[0]
               : o[2] === 'right' ? p.x + o[0] - boxW
               : p.x - boxW / 2;
        var by = p.y + o[1] - boxH / 2;
        var box = { x: bx, y: by, w: boxW, h: boxH, align: o[2] };
        var leftLimit = (opts.inset && opts.inset.left ? opts.inset.left : 0) + 4;
        if (bx < leftLimit || bx + boxW > width - 4 || by < 4 || by + boxH > height - 4) continue;
        if (!collides(box, boxes, v.yacht.id)) { chosen = box; break; }
      }
      if (!chosen) return;      // rather no label than an unreadable pile
      boxes.push(chosen);

      var tx = chosen.align === 'right' ? chosen.x + boxW - 5 : chosen.x + 5;
      var align = chosen.align === 'right' ? 'right' : 'left';
      if (chosen.align === 'center') { tx = chosen.x + boxW / 2; align = 'center'; }

      out.push({
        box: chosen, x: tx, align: align, name: name, sub: sub, color: p.color,
        nameSize: nameSize, subSize: subSize
      });
    });
    return out;
  }

  function paintLabels(labels) {
    // A dark halo rather than a filled plate: the chart stays visible through the
    // type, which matters when a label sits over the sea.
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    labels.forEach(function (l) {
      ctx.textAlign = l.align;

      ctx.font = '500 ' + l.nameSize + 'px ' + FONT_DISPLAY;
      ctx.strokeStyle = HALO;
      ctx.lineWidth = 4;
      ctx.strokeText(l.name, l.x, l.box.y);
      ctx.fillStyle = theme.label;
      ctx.fillText(l.name, l.x, l.box.y);

      if (l.sub) {
        ctx.font = '400 ' + l.subSize + 'px ' + FONT;
        ctx.strokeStyle = HALO;
        ctx.lineWidth = 4;
        ctx.strokeText(l.sub, l.x, l.box.y + l.nameSize + 3);
        ctx.fillStyle = l.color;
        ctx.fillText(l.sub, l.x, l.box.y + l.nameSize + 3);
      }
    });
  }

  // Canvas cannot read a CSS custom property, so the brand stacks are repeated
  // here. Vessel names take the display face, as headings do everywhere else;
  // the data beneath them takes the body face.
  // The halo behind chart labels sits on the page ground, so it tracks --bg.
  var HALO = 'rgba(7, 14, 22, 0.92)';

  var FONT_DISPLAY = '"Century Gothic", Jost, Questrial, system-ui, sans-serif';
  var FONT = 'Lato, system-ui, -apple-system, "Segoe UI", sans-serif';

  function labelSub(v) {
    var d = v.derived;
    // Course over ground plus a rough area still narrows a yacht down. A vessel
    // marked discreet gets its state and nothing more.
    if (d.discreet) return window.Fmt.statusLabel(d.status);
    if (d.status === 'underway' && v.fix && v.fix.sog != null) {
      return window.Fmt.speed(v.fix.sog) + '  ' + window.Fmt.bearing(v.fix.cog);
    }
    if (d.status === 'dark') return 'no signal · ' + window.Fmt.age(v.fix && v.fix.at);
    return window.Fmt.statusLabel(d.status);
  }

  // A label is allowed to sit against its own marker — that is the whole point of
  // it — but must clear every other marker and every label already placed.
  function collides(box, others, selfId) {
    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      if (o.owner && o.owner === selfId) continue;
      var padX = (o.owner || o.tight) ? 4 : 12;
      var padY = (o.owner || o.tight) ? 3 : 8;
      if (box.x < o.x + o.w + padX && box.x + box.w + padX > o.x &&
          box.y < o.y + o.h + padY && box.y + box.h + padY > o.y) return true;
    }
    return false;
  }

  // Shared with the spotlight's small locator chart so the coastline is decoded
  // once for the whole board rather than per view.
  Map.landRings = function () { return land; };
  Map._greatCircle = greatCircle;   // for tests
  Map._camScale = function () { return cam.scale; };
  Map.landBounds = function () { return landBounds; };

  Map.camera = cam;
  Map.target = target;
  window.FleetMap = Map;
})();
