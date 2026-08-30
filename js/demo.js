/* -----------------------------------------------------------------------------
 * demo.js — a simulated fleet, so the board is worth looking at before anyone
 * has signed up for an AIS feed.
 *
 * It drives the exact same Store.applyFix() path that live AIS uses, so what you
 * see in demo mode is what you get in live mode. Nothing here runs once an API
 * key is configured.
 *
 * Time is compressed (see CONFIG.demo.timeScale) because a yacht doing 12 knots
 * in real time is, correctly, almost motionless on a world chart.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Demo = { agents: [], timer: null, running: false };

  var TICK_MS = 1000;

  Demo.start = function (vessels) {
    Demo.agents = vessels.map(makeAgent).filter(Boolean);
    seedHistory();
    Demo.running = true;
    window.Store.setConnection('demo');
    tick();
    Demo.timer = setInterval(tick, TICK_MS);
  };

  Demo.stop = function () {
    Demo.running = false;
    clearInterval(Demo.timer);
  };

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Live AIS carries a crew-typed destination and ETA in the slower static
  // message. Demo mode fills the same fields so the spotlight card shows what it
  // will actually show in service, blanks included where a yacht reports none.
  function seedVoyage(v) {
    var d = v.yacht.demo;
    if (!d || !d.destination) return;
    var eta = new Date(Date.now() + (d.etaHours || 12) * 3600000);
    window.Store.applyVoyage(v.yacht.mmsi, {
      destination: d.destination,
      eta: eta.getUTCDate() + ' ' + MONTHS[eta.getUTCMonth()] + ' ' +
           String(eta.getUTCHours()).padStart(2, '0') + ':00',
      draught: v.yacht.loa ? +(v.yacht.loa * 0.055).toFixed(1) : null
    });
  }

  // [lon, lat] for a port in data/ports.js, matched on name without regard to
  // case or accents, so 'Gocek' finds 'Göcek'.
  function portNamed(name) {
    var want = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    for (var i = 0; i < window.PORTS.length; i++) {
      var p = window.PORTS[i];
      var have = p[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (have === want) return [p[2], p[3]];
    }
    return null;
  }

  function makeAgent(v) {
    var d = v.yacht.demo;
    if (!d) return null;
    seedVoyage(v);
    var agent = {
      vessel: v,
      mmsi: v.yacht.mmsi,
      kind: d.status,
      speed: d.speed || 0,
      phase: Math.random() * Math.PI * 2      // desynchronises the anchor swing
    };

    if (d.route && d.route.length >= 2) {
      agent.route = d.route.slice();
      agent.leg = 0;
      agent.legProgress = 0;
      agent.direction = 1;
      agent.lon = agent.route[0][0];
      agent.lat = agent.route[0][1];
    } else if (d.position) {
      agent.home = d.position.slice();
      agent.lon = d.position[0];
      agent.lat = d.position[1];
    } else if (d.port) {
      // A port by name, so a yacht sitting still can be placed without anyone
      // looking up coordinates for her. Names come from data/ports.js.
      var found = portNamed(d.port);
      if (!found) {
        console.warn('demo: no port named "' + d.port + '" in data/ports.js — ' +
                     v.yacht.name + ' has no position. Add it there, or use ' +
                     'position: [lon, lat].');
        return null;
      }
      agent.home = found.slice();
      agent.lon = found[0];
      agent.lat = found[1];
    } else {
      return null;
    }

    if (d.status === 'dark') {
      agent.frozenAt = new Date(Date.now() - (d.lastSeenHoursAgo || 24) * 3600000);
      agent.course = d.course != null ? d.course : 270;
    }
    return agent;
  }

  // Lay down a plausible 24 hours of history behind each moving yacht, so the
  // track trails are populated the moment the board opens rather than drawing
  // themselves in over the following hour.
  function seedHistory() {
    var now = Date.now();
    Demo.agents.forEach(function (a) {
      if (a.kind === 'dark') {
        window.Store.applyFix(a.mmsi, {
          lon: a.lon, lat: a.lat, cog: a.course, sog: a.speed,
          heading: a.course, navStatus: 0, at: a.frozenAt
        });
        return;
      }
      if (!a.route) {
        // Stationary: one fix is enough, plus a little scatter for the anchored ones.
        var points = a.kind === 'anchored' ? 12 : 2;
        for (var s = points; s >= 0; s--) {
          var p = stationaryPosition(a, now - s * 3600000 / 2);
          window.Store.applyFix(a.mmsi, {
            lon: p[0], lat: p[1], cog: p[2], sog: a.kind === 'moored' ? 0 : a.speed,
            heading: p[2], navStatus: navStatusFor(a.kind),
            at: new Date(now - s * 3600000 / 2)
          });
        }
        return;
      }
      // Moving: walk the route backwards from the start point, then replay
      // forwards so the trail leads into the current position.
      var back = Object.assign({}, a, { legProgress: 0, leg: 0, direction: 1 });
      var steps = 24, stepHours = 1;
      var history = [];
      for (var i = 0; i < steps; i++) {
        advance(back, a.speed * stepHours);
        history.push([back.lon, back.lat, back.course]);
      }
      for (var j = 0; j < history.length; j++) {
        var h = history[j];
        window.Store.applyFix(a.mmsi, {
          lon: h[0], lat: h[1], cog: h[2], sog: a.speed, heading: h[2],
          navStatus: 0, at: new Date(now - (history.length - j) * stepHours * 3600000)
        });
      }
      a.lon = back.lon; a.lat = back.lat; a.leg = back.leg;
      a.legProgress = back.legProgress; a.direction = back.direction;
      a.course = back.course;
    });
  }

  function navStatusFor(kind) {
    if (kind === 'anchored') return 1;
    if (kind === 'moored') return 5;
    return 0;
  }

  function tick() {
    var scale = (window.CONFIG.demo && window.CONFIG.demo.timeScale) || 30;
    var simHours = (TICK_MS / 3600000) * scale;
    var now = new Date();

    Demo.agents.forEach(function (a) {
      if (a.kind === 'dark') return;         // stays exactly where it went quiet

      if (a.route) {
        advance(a, a.speed * simHours);
        window.Store.applyFix(a.mmsi, {
          lon: a.lon, lat: a.lat, cog: a.course, sog: jitter(a.speed, 0.3),
          heading: a.course, navStatus: 0, at: now
        });
      } else {
        var p = stationaryPosition(a, now.getTime());
        window.Store.applyFix(a.mmsi, {
          lon: p[0], lat: p[1], cog: p[2],
          sog: a.kind === 'anchored' ? jitter(a.speed, 0.15) : 0,
          heading: p[2], navStatus: navStatusFor(a.kind), at: now
        });
      }
    });
  }

  // A yacht at anchor yaws slowly around its ground tackle; one alongside does
  // not move at all. Both look more convincing than a frozen dot.
  function stationaryPosition(a, atMs) {
    if (a.kind === 'moored') {
      return [a.home[0], a.home[1], a.phase * 57.3 % 360];
    }
    var t = atMs / 1000 / 240 + a.phase;      // one slow swing every few minutes
    var radiusNm = 0.06;
    var heading = (t * 57.3) % 360;
    var p = window.Geo.destination(a.home[0], a.home[1], heading, radiusNm);
    return [p[0], p[1], (heading + 180) % 360];
  }

  // Move `distanceNm` along the route, turning at each waypoint and reversing at
  // the ends so the yacht shuttles back and forth indefinitely.
  function advance(a, distanceNm) {
    var guard = 0;
    while (distanceNm > 0 && guard++ < 64) {
      var from = a.route[a.leg];
      var to = a.route[a.leg + a.direction] || a.route[a.leg];
      var legLength = window.Geo.distanceNm(from[0], from[1], to[0], to[1]);
      if (legLength < 1e-6) { stepLeg(a); continue; }

      var remaining = legLength * (1 - a.legProgress);
      if (distanceNm < remaining) {
        a.legProgress += distanceNm / legLength;
        distanceNm = 0;
      } else {
        distanceNm -= remaining;
        a.legProgress = 0;
        stepLeg(a);
        continue;
      }
      var bearing = window.Geo.bearing(from[0], from[1], to[0], to[1]);
      var pos = window.Geo.destination(from[0], from[1], bearing, legLength * a.legProgress);
      a.lon = pos[0];
      a.lat = pos[1];
      a.course = bearing;
    }
  }

  function stepLeg(a) {
    var next = a.leg + a.direction;
    if (next < 0 || next >= a.route.length) {
      a.direction *= -1;                     // turn around at the end of the route
      next = a.leg + a.direction;
      if (next < 0 || next >= a.route.length) next = a.leg;
    }
    a.leg = next;
    // At the far end there is no onward leg; hold course rather than divide by zero.
    var from = a.route[a.leg];
    var to = a.route[a.leg + a.direction];
    if (from && to) a.course = window.Geo.bearing(from[0], from[1], to[0], to[1]);
  }

  function jitter(value, amount) {
    return Math.max(0, value + (Math.random() - 0.5) * amount);
  }

  window.Demo = Demo;
})();
