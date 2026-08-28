/* -----------------------------------------------------------------------------
 * store.js — one place that knows where every yacht is.
 *
 * Feeds (live AIS or the demo simulator) push fixes in; views pull derived state
 * out. Last known positions are cached to localStorage so that a reload, a power
 * cut, or a browser restart brings the board back with content rather than eight
 * empty cards.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var CACHE_KEY = 'fleetwatch.positions.v1';
  var MAX_TRACK_POINTS = 400;

  var Store = {
    mode: 'demo',              // 'demo' | 'live'
    connection: 'starting',    // starting | connecting | open | retrying | closed | demo
    vessels: [],               // in fleet.js order
    byMmsi: {},
    lastMessageAt: null,
    messageCount: 0,
    listeners: []
  };

  /* --- Setup ------------------------------------------------------------- */

  Store.init = function (fleet) {
    Store.vessels = fleet.map(function (yacht) {
      return {
        yacht: yacht,
        fix: null,             // { lon, lat, cog, heading, sog, navStatus, at }
        voyage: {},            // { destination, eta, draught } from AIS static messages
        track: [],             // [{ lon, lat, at }] newest last
        weather: null,
        derived: {}
      };
    });
    Store.byMmsi = {};
    Store.vessels.forEach(function (v) { Store.byMmsi[String(v.yacht.mmsi)] = v; });
    restore();
    Store.recompute();
  };

  /* --- Ingest ------------------------------------------------------------ */

  // A position fix from any source. `at` is a Date; everything else may be null.
  Store.applyFix = function (mmsi, fix) {
    var v = Store.byMmsi[String(mmsi)];
    if (!v) return false;      // not one of ours — ignore
    if (!isFinite(fix.lon) || !isFinite(fix.lat)) return false;
    if (Math.abs(fix.lat) > 90 || Math.abs(fix.lon) > 180) return false;

    var at = fix.at || new Date();
    // Ignore a fix older than the one we already hold, so an out-of-order
    // message can't drag a yacht backwards.
    if (v.fix && v.fix.at && at < v.fix.at) return false;

    v.fix = {
      lon: fix.lon, lat: fix.lat,
      cog: fix.cog != null ? fix.cog : (v.fix ? v.fix.cog : null),
      heading: fix.heading != null ? fix.heading : null,
      sog: fix.sog != null ? fix.sog : null,
      navStatus: fix.navStatus != null ? fix.navStatus : (v.fix ? v.fix.navStatus : null),
      at: at
    };

    pushTrack(v, fix.lon, fix.lat, at);
    Store.lastMessageAt = new Date();
    Store.messageCount++;
    return true;
  };

  Store.applyVoyage = function (mmsi, data) {
    var v = Store.byMmsi[String(mmsi)];
    if (!v) return false;
    if (data.destination != null) v.voyage.destination = data.destination;
    if (data.eta != null) v.voyage.eta = data.eta;
    if (data.draught != null) v.voyage.draught = data.draught;
    if (data.callSign != null) v.voyage.callSign = data.callSign;
    Store.lastMessageAt = new Date();
    return true;
  };

  Store.applyWeather = function (mmsi, weather) {
    var v = Store.byMmsi[String(mmsi)];
    if (!v) return;
    v.weather = weather;
  };

  // Only record a track point once the yacht has actually moved, otherwise a
  // vessel alongside accumulates thousands of identical points.
  function pushTrack(v, lon, lat, at) {
    var last = v.track[v.track.length - 1];
    if (last) {
      if (window.Geo.distanceNm(last.lon, last.lat, lon, lat) < 0.05 &&
          at - last.at < 600000) return;
    }
    v.track.push({ lon: lon, lat: lat, at: at });
    trimTrack(v);
  }

  function trimTrack(v) {
    var cutoff = Date.now() - window.CONFIG.display.trackHours * 3600000;
    while (v.track.length && v.track[0].at < cutoff) v.track.shift();
    while (v.track.length > MAX_TRACK_POINTS) v.track.shift();
  }

  /* --- Derived state ----------------------------------------------------- */

  Store.recompute = function () {
    var now = new Date();
    var cfg = window.CONFIG;
    Store.vessels.forEach(function (v) {
      trimTrack(v);
      var d = v.derived;
      d.ageMs = v.fix ? now - v.fix.at : null;
      d.ageMinutes = d.ageMs == null ? null : d.ageMs / 60000;
      d.stale = d.ageMinutes != null && d.ageMinutes > cfg.ais.stalePositionMinutes;
      d.dark = d.ageMinutes == null || d.ageMinutes > cfg.ais.darkPositionHours * 60;
      d.status = deriveStatus(v, d, now);
      d.discreet = !!v.yacht.discreet || !!cfg.discreetMode;

      if (v.fix) {
        // What the rest of the app should draw. In discreet mode this is a
        // deliberately coarse position and everything downstream uses it, so an
        // exact fix can never leak into the map, the labels, or the spotlight.
        var shown = d.discreet
          ? window.Geo.blur(v.fix.lon, v.fix.lat, cfg.discreetRoundingNm)
          : [v.fix.lon, v.fix.lat];
        d.lon = shown[0];
        d.lat = shown[1];
        d.port = window.Geo.nearestPort(d.lon, d.lat, window.PORTS);
        d.sun = window.Geo.sunTimes(now, d.lon, d.lat);
        d.solarAltitude = window.Geo.solarAltitude(now, d.lon, d.lat);
        d.isDaylight = d.solarAltitude > -0.833;
        // Prefer the real shore zone when the weather lookup has given us one;
        // fall back to ship's time (longitude/15) out where no shore zone applies.
        d.localTime = (v.weather && v.weather.utcOffsetSeconds != null)
          ? window.Fmt.timeAtOffset(now, v.weather.utcOffsetSeconds, false)
          : window.Fmt.nauticalTime(now, d.lon);
        d.fromOffice = window.Geo.distanceNm(cfg.office.lon, cfg.office.lat, d.lon, d.lat);
      } else {
        d.lon = d.lat = null;
        d.port = null;
        d.sun = null;
        d.fromOffice = null;
      }

      d.distance24h = trackDistance(v.track, now - 24 * 3600000);
      d.distance7d = trackDistance(v.track, now - 7 * 24 * 3600000);
    });
    notify();
  };

  function deriveStatus(v, d, now) {
    var yard = v.yacht.service && v.yacht.service.yardPeriod;
    if (yard && withinPeriod(now, yard.from, yard.to)) return 'refit';
    if (!v.fix) return 'unknown';
    if (d.dark) return 'dark';

    // AIS navigational status, where the crew have set it correctly.
    if (v.fix.navStatus === 1) return 'anchored';
    if (v.fix.navStatus === 5) return 'moored';

    var sog = v.fix.sog;
    if (sog == null) return 'unknown';
    if (sog >= 0.8) return 'underway';
    // Stationary: alongside if effectively on top of a port, else at anchor.
    if (d.port && d.port.distanceNm < 1.2) return 'moored';
    return 'anchored';
  }

  function withinPeriod(now, from, to) {
    var f = new Date(from), t = new Date(to);
    return !isNaN(f) && !isNaN(t) && now >= f && now <= t;
  }

  function trackDistance(track, sinceMs) {
    var total = 0;
    for (var i = 1; i < track.length; i++) {
      if (track[i].at < sinceMs) continue;
      total += window.Geo.distanceNm(track[i - 1].lon, track[i - 1].lat, track[i].lon, track[i].lat);
    }
    return total;
  }

  /* --- Fleet-level rollups ----------------------------------------------- */

  Store.summary = function () {
    var counts = { underway: 0, anchored: 0, moored: 0, refit: 0, dark: 0, unknown: 0 };
    var tracked = 0, totalOpenJobs = 0, totalUrgent = 0, distance7d = 0;
    Store.vessels.forEach(function (v) {
      counts[v.derived.status] = (counts[v.derived.status] || 0) + 1;
      if (v.fix && !v.derived.dark) tracked++;
      var s = v.yacht.service || {};
      totalOpenJobs += s.openJobs || 0;
      totalUrgent += s.urgentJobs || 0;
      distance7d += v.derived.distance7d || 0;
    });
    return {
      counts: counts,
      total: Store.vessels.length,
      tracked: tracked,
      openJobs: totalOpenJobs,
      urgentJobs: totalUrgent,
      distance7d: distance7d
    };
  };

  // Everything with a date attached, soonest first — drives the schedule board.
  Store.upcoming = function () {
    var items = [];
    Store.vessels.forEach(function (v) {
      var s = v.yacht.service;
      if (!s) return;
      if (s.nextEventDate) {
        items.push({ vessel: v, kind: 'event', label: s.nextEvent, date: new Date(s.nextEventDate) });
      }
      (s.partsOnOrder || []).forEach(function (p) {
        items.push({ vessel: v, kind: 'part', label: p.item, date: new Date(p.eta), port: p.port });
      });
      if (s.yardPeriod) {
        items.push({
          vessel: v, kind: 'yard',
          label: s.yardPeriod.yard,
          date: new Date(s.yardPeriod.to),
          from: new Date(s.yardPeriod.from),
          to: new Date(s.yardPeriod.to)
        });
      }
    });
    return items.filter(function (i) { return !isNaN(i.date); })
                .sort(function (a, b) { return a.date - b.date; });
  };

  /* --- Persistence ------------------------------------------------------- */

  // Wrapped because storage throws outright in some privacy configurations,
  // and a wall display must never die over a cache write.
  Store.persist = function () {
    try {
      var payload = { savedAt: Date.now(), vessels: {} };
      Store.vessels.forEach(function (v) {
        if (!v.fix) return;
        payload.vessels[v.yacht.mmsi] = {
          fix: { lon: v.fix.lon, lat: v.fix.lat, cog: v.fix.cog, heading: v.fix.heading,
                 sog: v.fix.sog, navStatus: v.fix.navStatus, at: v.fix.at.getTime() },
          voyage: v.voyage,
          track: v.track.slice(-120).map(function (p) { return [p.lon, p.lat, p.at.getTime()]; })
        };
      });
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (e) { /* no cache available; the board still works */ }
  };

  function restore() {
    var raw;
    try { raw = localStorage.getItem(CACHE_KEY); } catch (e) { return; }
    if (!raw) return;
    var payload;
    try { payload = JSON.parse(raw); } catch (e) { return; }
    if (!payload || !payload.vessels) return;

    Object.keys(payload.vessels).forEach(function (mmsi) {
      var v = Store.byMmsi[mmsi];
      if (!v) return;                       // fleet.js changed since the cache was written
      var saved = payload.vessels[mmsi];
      if (saved.fix) {
        v.fix = {
          lon: saved.fix.lon, lat: saved.fix.lat, cog: saved.fix.cog,
          heading: saved.fix.heading, sog: saved.fix.sog,
          navStatus: saved.fix.navStatus, at: new Date(saved.fix.at)
        };
      }
      v.voyage = saved.voyage || {};
      v.track = (saved.track || []).map(function (p) {
        return { lon: p[0], lat: p[1], at: new Date(p[2]) };
      });
    });
  }

  Store.clearCache = function () {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
  };

  /* --- Change notification ----------------------------------------------- */

  Store.subscribe = function (fn) { Store.listeners.push(fn); };

  function notify() {
    for (var i = 0; i < Store.listeners.length; i++) {
      try { Store.listeners[i](Store); } catch (e) { console.error('listener failed', e); }
    }
  }

  Store.setConnection = function (state) {
    if (Store.connection === state) return;
    Store.connection = state;
    notify();
  };

  window.Store = Store;
})();
