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
  var theme = {};
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
    land = window.Geo.decodeLand(window.WORLD_LAND_ENCODED, window.WORLD_LAND_SCALE);
    landBounds = land.map(ringBounds);
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
    theme = {
      ocean: v('--map-ocean', '#0a141d'),
      oceanDeep: v('--map-ocean-deep', '#07101a'),
      land: v('--map-land', '#1b2632'),
      coast: v('--map-coast', '#31435a'),
      graticule: v('--map-graticule', '#16222f'),
      night: v('--map-night', 'rgba(40, 55, 150, 0.78)'),
      duskWarm: v('--twilight-dusk', 'rgba(255, 205, 165, 0.265)'),
      civil: v('--twilight-civil', 'rgba(170, 150, 235, 0.406)'),
      nautical: v('--twilight-nautical', 'rgba(105, 120, 215, 0.546)'),
      astro: v('--twilight-astro', 'rgba(60, 78, 180, 0.679)'),
      track: v('--map-track', '#2f6ea8'),
      underway: v('--status-underway', '#3987e5'),
      anchored: v('--status-anchored', '#199e70'),
      moored: v('--status-moored', '#8b98a8'),
      refit: v('--status-refit', '#d95926'),
      dark: v('--status-dark', '#6c7a8c'),
      label: v('--text-primary', '#ffffff'),
      labelDim: v('--text-secondary', '#c3c2b7'),
      panel: v('--surface-2', '#111820')
    };
  }
  Map.readTheme = readTheme;

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

    drawOcean();
    drawGraticule();
    drawLand();
    if (opts.showNight !== false) drawNight(now);

    // Vessel labels are laid out before anything else is written over the chart,
    // so the port names can be told which space is already spoken for. Yachts
    // win; ports yield. Then everything is painted in z-order.
    var placed = locateVessels(vessels);
    var labels = opts.labels === false ? [] : layoutLabels(placed, opts);
    drawPorts(labels.map(function (l) { return l.box; }).concat(markerBoxes(placed)));
    drawTracks(vessels);
    paintMarkers(placed, opts, now);
    paintLabels(labels);

    ctx.restore();

    // Kept so a pointer can be matched against the marks. The drift offset has
    // to come with it: the markers are drawn through a translated context, so
    // their screen position is the projected position plus the drift.
    Map.lastFrame = { placed: placed, driftX: driftPx, driftY: driftPy };
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

  function drawLand() {
    var repeats = worldRepeats();
    // Stride: when zoomed out there is no point emitting a lineTo for detail
    // finer than a pixel.
    var degPerPx = (width / cam.scale) * 360 / width;
    var stride = degPerPx > 0.6 ? 4 : degPerPx > 0.25 ? 2 : 1;

    ctx.beginPath();
    for (var r = -repeats; r <= repeats; r++) {
      for (var i = 0; i < land.length; i++) {
        var b = landBounds[i];
        // Cull: off-screen, or smaller than a couple of pixels.
        if (b.spanX * cam.scale < 1.5 && b.spanY * cam.scale < 1.5) continue;
        var left = sx(b.minX + r), right = sx(b.maxX + r);
        if (right < -40 || left > width + 40) continue;
        var top = sy(b.minY), bottom = sy(b.maxY);
        if (bottom < -40 || top > height + 40) continue;

        traceRing(land[i], r, stride);
      }
    }
    ctx.fillStyle = theme.land;
    ctx.fill('evenodd');          // interior rings punch out lakes and inland seas
    // A hairline coast is what separates land from sea at world scale, where the
    // fill alone reads as haze. It costs a second pass over the path, which the
    // 30fps budget can absorb; it fades in as the chart zooms so it never turns
    // the continents into outlines.
    ctx.strokeStyle = theme.coast;
    ctx.globalAlpha = cam.scale > 1800 ? 1 : 0.55;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function traceRing(ring, worldOffset, stride) {
    var n = ring.length;
    ctx.moveTo(sx(window.Geo.worldX(ring[0]) + worldOffset), sy(window.Geo.worldY(ring[1])));
    for (var i = 2 * stride; i < n; i += 2 * stride) {
      ctx.lineTo(sx(window.Geo.worldX(ring[i]) + worldOffset), sy(window.Geo.worldY(ring[i + 1])));
    }
    ctx.closePath();
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
    return placed.map(function (p) {
      return { x: p.x - 9, y: p.y - 9, w: 18, h: 18, owner: p.vessel.yacht.id };
    });
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
    return { moored: 0, refit: 1, dark: 2, anchored: 3, underway: 4, unknown: 0 }[status] || 0;
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
      var padX = o.owner ? 4 : 12;
      var padY = o.owner ? 3 : 8;
      if (box.x < o.x + o.w + padX && box.x + box.w + padX > o.x &&
          box.y < o.y + o.h + padY && box.y + box.h + padY > o.y) return true;
    }
    return false;
  }

  // Shared with the spotlight's small locator chart so the coastline is decoded
  // once for the whole board rather than per view.
  Map.landRings = function () { return land; };
  Map.landBounds = function () { return landBounds; };

  Map.camera = cam;
  Map.target = target;
  window.FleetMap = Map;
})();
