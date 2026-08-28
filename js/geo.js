/* -----------------------------------------------------------------------------
 * geo.js — projection, navigation maths, sun position, coastline decoding.
 *
 * No dependencies. Everything the chart needs to turn a latitude and longitude
 * into a pixel, and a pixel back into something a person can read.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Geo = {};

  var EARTH_RADIUS_NM = 3440.065;
  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;

  /* --- Coastline --------------------------------------------------------- */

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64_INDEX = new Int8Array(128);
  B64_INDEX.fill(-1);
  for (var i = 0; i < 64; i++) B64_INDEX[B64.charCodeAt(i)] = i;

  // Reverses tools/build-coastline.js: '|'-separated rings of delta-encoded
  // zigzag base-64 varints become flat [lon,lat,...] Float64Arrays.
  Geo.decodeLand = function (encoded, scale) {
    var rings = [];
    var chunks = encoded.split('|');
    for (var c = 0; c < chunks.length; c++) {
      var s = chunks[c], n = s.length, i = 0, lx = 0, ly = 0;
      var out = [];
      while (i < n) {
        var vals = [0, 0];
        for (var k = 0; k < 2; k++) {
          var z = 0, shift = 0, d;
          do {
            d = B64_INDEX[s.charCodeAt(i++)];
            z |= (d & 31) << shift;
            shift += 5;
          } while (d & 32);
          vals[k] = (z & 1) ? -((z + 1) >>> 1) : (z >>> 1);
        }
        lx += vals[0];
        ly += vals[1];
        out.push(lx / scale, ly / scale);
      }
      rings.push(Float64Array.from(out));
    }
    return rings;
  };

  /* --- Web Mercator ------------------------------------------------------ */

  // Both return normalised world coordinates in [0,1]. Latitude is clamped to
  // the Mercator limit so a bad fix near the pole cannot produce Infinity.
  var MERC_MAX_LAT = 85.05112878;

  Geo.worldX = function (lon) {
    return (lon + 180) / 360;
  };

  Geo.worldY = function (lat) {
    var l = Math.max(-MERC_MAX_LAT, Math.min(MERC_MAX_LAT, lat)) * DEG;
    return (1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2;
  };

  Geo.lonFromWorldX = function (x) {
    return x * 360 - 180;
  };

  Geo.latFromWorldY = function (y) {
    return (2 * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - Math.PI / 2) * RAD;
  };

  /* --- Navigation -------------------------------------------------------- */

  // Great-circle distance in nautical miles.
  Geo.distanceNm = function (lon1, lat1, lon2, lat2) {
    var p1 = lat1 * DEG, p2 = lat2 * DEG;
    var dp = (lat2 - lat1) * DEG, dl = (lon2 - lon1) * DEG;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
  };

  // Initial great-circle bearing, degrees true.
  Geo.bearing = function (lon1, lat1, lon2, lat2) {
    var p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * RAD + 360) % 360;
  };

  // Project a point along a bearing — used by demo mode to move yachts.
  Geo.destination = function (lon, lat, bearingDeg, distanceNm) {
    var d = distanceNm / EARTH_RADIUS_NM;
    var b = bearingDeg * DEG, p1 = lat * DEG, l1 = lon * DEG;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    var l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1),
                             Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [((l2 * RAD + 540) % 360) - 180, p2 * RAD];
  };

  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  Geo.compassPoint = function (deg) {
    return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  };

  /* --- Nearest port ------------------------------------------------------ */

  // Tier-1 entries (yachting hubs, refit yards) are given a modest handicap so
  // that "18 nm E of Palma" wins over a container terminal 2 nm closer.
  var TIER_BONUS_NM = 12;

  Geo.nearestPort = function (lon, lat, ports) {
    var best = null, bestScore = Infinity;
    for (var i = 0; i < ports.length; i++) {
      var p = ports[i];
      var d = Geo.distanceNm(lon, lat, p[2], p[3]);
      var score = d - (p[4] === 1 ? TIER_BONUS_NM : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { name: p[0], country: p[1], lon: p[2], lat: p[3], distanceNm: d };
      }
    }
    if (!best) return null;
    best.bearingFromPort = Geo.bearing(best.lon, best.lat, lon, lat);
    best.compass = Geo.compassPoint(best.bearingFromPort);
    return best;
  };

  /* --- Sun --------------------------------------------------------------- */

  // NOAA solar position, good to well under a minute — far beyond what a wall
  // display needs, and it keeps the sunrise/sunset arc honest.
  function julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  function solarPosition(date) {
    var n = julianDay(date) - 2451545.0;
    var L = (280.460 + 0.9856474 * n) % 360;              // mean longitude
    var g = ((357.528 + 0.9856003 * n) % 360) * DEG;      // mean anomaly
    var lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
    var epsilon = (23.439 - 0.0000004 * n) * DEG;
    var declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda)) * RAD;
    var rightAscension = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) * RAD;
    // Greenwich mean sidereal time → subsolar longitude
    var gmst = (18.697374558 + 24.06570982441908 * n) % 24;
    var subsolarLon = ((rightAscension - gmst * 15) + 540) % 360 - 180;
    return { declination: declination, subsolarLon: subsolarLon };
  }

  Geo.solarPosition = solarPosition;

  // Into (-pi, pi].
  function normalise(rad) {
    while (rad > Math.PI) rad -= 2 * Math.PI;
    while (rad <= -Math.PI) rad += 2 * Math.PI;
    return rad;
  }

  // Sun altitude in degrees at a point, right now.
  Geo.solarAltitude = function (date, lon, lat) {
    var s = solarPosition(date);
    var ha = (lon - s.subsolarLon) * DEG;
    var d = s.declination * DEG, p = lat * DEG;
    return Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(ha)) * RAD;
  };

  // Latitude on one meridian where the sun sits at altitude h. For declination d
  // and hour angle H:
  //     sin(h) = sin(lat)sin(d) + cos(lat)cos(d)cos(H)
  // With A = sin(d) and B = cos(d)cos(H) the right-hand side is a single
  // sinusoid in lat, so it solves in closed form — but asin has two branches and
  // both can be real latitudes, because near the poles a twilight contour closes
  // into a ring. `reference` disambiguates: the answer must lie at or beyond it
  // toward the dark pole, which is what keeps a stack of contours in order.
  function contourLat(hourAngle, h, d, darkSign, reference) {
    var A = Math.sin(d);
    var B = Math.cos(d) * Math.cos(hourAngle);
    var amplitude = Math.hypot(A, B);
    if (amplitude < 1e-12) return reference;

    var raw = Math.sin(h) / amplitude;
    // No solution on this meridian: either the sun never climbs that high (so
    // every latitude is darker than h) or never sinks that low (so every
    // latitude is brighter). Both are real cases near the solstices.
    if (raw > 1) return -darkSign * 90;
    if (raw < -1) return darkSign * 90;

    var base = Math.asin(raw);
    var phase = Math.atan2(B, A);
    var candidates = [];
    [base - phase, Math.PI - base - phase].forEach(function (rad) {
      var deg = normalise(rad) * RAD;
      if (deg >= -90.001 && deg <= 90.001) candidates.push(deg);
    });
    if (!candidates.length) return reference;

    // Keep only those at or beyond the reference, then take the nearest.
    var beyond = candidates.filter(function (deg) {
      return darkSign * (deg - reference) >= -0.001;
    });
    var pool = beyond.length ? beyond : candidates;
    return pool.reduce(function (best, deg) {
      return Math.abs(deg - reference) < Math.abs(best - reference) ? deg : best;
    });
  }

  // The terminator: the altitude-0 contour, which has an unambiguous closed form
  // and so needs no disambiguation.
  Geo.terminator = function (date, stepDeg) {
    var s = solarPosition(date);
    var step = stepDeg || 2;
    var d = s.declination * DEG;
    var pts = [];
    for (var lon = -180; lon <= 180; lon += step) {
      var ha = (lon - s.subsolarLon) * DEG;
      pts.push([lon, Math.atan(-Math.cos(ha) / Math.tan(d === 0 ? 1e-9 : d)) * RAD]);
    }
    return { points: pts, nightAtNorthPole: s.declination < 0 };
  };

  // A single contour at any altitude, taken nearest the terminator. Used for the
  // narrow warm band just on the daylight side, which the ordered stack below
  // cannot express because it only ever walks toward the dark.
  Geo.altitudeContour = function (date, altitudeDeg, stepDeg) {
    var s = solarPosition(date);
    var d = s.declination * DEG;
    var darkSign = s.declination < 0 ? 1 : -1;
    var terminator = Geo.terminator(date, stepDeg || 2);
    var pts = terminator.points.map(function (p) {
      var ha = (p[0] - s.subsolarLon) * DEG;
      // Reference is the terminator, and the direction constraint is dropped by
      // passing the reference as its own bound: the nearest real solution wins.
      var lat = contourLat(ha, altitudeDeg * DEG, d, darkSign, p[1]);
      if (Math.abs(lat - p[1]) > 60) lat = p[1];   // reject a jump to the far branch
      return [p[0], lat];
    });
    return { points: pts, nightAtNorthPole: s.declination < 0 };
  };

  // A stack of contours — 0, -6, -12, -18 gives the terminator and the ends of
  // civil, nautical and astronomical twilight. They are solved together, each
  // constrained to lie at or beyond the one before it toward the dark pole, so
  // the bands drawn between them can never cross or invert.
  Geo.twilightContours = function (date, altitudes, stepDeg) {
    var s = solarPosition(date);
    var step = stepDeg || 2;
    var d = s.declination * DEG;
    var darkSign = s.declination < 0 ? 1 : -1;      // +1 when the north is dark

    var terminator = Geo.terminator(date, step);
    var contours = [terminator.points];

    for (var a = 0; a < altitudes.length; a++) {
      var h = altitudes[a] * DEG;
      var previous = contours[contours.length - 1];
      var pts = [];
      for (var i = 0; i < previous.length; i++) {
        var lon = previous[i][0];
        var ha = (lon - s.subsolarLon) * DEG;
        pts.push([lon, contourLat(ha, h, d, darkSign, previous[i][1])]);
      }
      contours.push(pts);
    }

    return {
      contours: contours,             // [terminator, ...one per altitude]
      nightAtNorthPole: s.declination < 0
    };
  };

  // Sunrise and sunset for a calendar day, as Date objects (UTC instants).
  // Returns nulls during polar day or polar night, which the UI labels instead.
  Geo.sunTimes = function (date, lon, lat) {
    var day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
    var s = solarPosition(day);
    var d = s.declination * DEG, p = lat * DEG;
    var zenith = 90.833 * DEG;   // standard refraction + solar disc
    var cosH = (Math.cos(zenith) - Math.sin(p) * Math.sin(d)) / (Math.cos(p) * Math.cos(d));
    if (cosH > 1) return { sunrise: null, sunset: null, polar: 'night' };
    if (cosH < -1) return { sunrise: null, sunset: null, polar: 'day' };

    var H = Math.acos(cosH) * RAD;                 // half-day arc, degrees
    // Solar noon at this longitude, expressed as a UTC instant on `day`.
    var noonOffsetHours = -(lon - s.subsolarLon) / 15;
    var noonMs = day.getTime() + noonOffsetHours * 3600000;
    var halfDayMs = (H / 15) * 3600000;
    return {
      sunrise: new Date(noonMs - halfDayMs),
      sunset: new Date(noonMs + halfDayMs),
      solarNoon: new Date(noonMs),
      polar: null
    };
  };

  /* --- Discretion -------------------------------------------------------- */

  // Round a fix onto a coarse grid so the yacht reads as "somewhere in this
  // area" rather than a fix a photographer could act on.
  Geo.blur = function (lon, lat, roundingNm) {
    var latStepDeg = roundingNm / 60;
    var lonStepDeg = latStepDeg / Math.max(0.15, Math.cos(lat * DEG));
    return [
      Math.round(lon / lonStepDeg) * lonStepDeg,
      Math.round(lat / latStepDeg) * latStepDeg
    ];
  };

  window.Geo = Geo;
})();
