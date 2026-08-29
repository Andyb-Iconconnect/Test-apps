/* -----------------------------------------------------------------------------
 * A browser-free check of the logic behind the board: navigation maths, unit
 * formatting, the AIS message parser, and the store's state derivation.
 *
 *   node tools/test.js
 *
 * Rendering is not covered here — open index.html for that.
 * -------------------------------------------------------------------------- */

const assert = require('assert');
const path = require('path');

// A minimal browser stand-in. localStorage throws, on purpose: the store has to
// survive a browser with site data blocked.
global.window = {};
global.localStorage = {
  getItem() { throw new Error('storage disabled'); },
  setItem() { throw new Error('storage disabled'); },
  removeItem() {}
};

const load = (f) => require(path.join(__dirname, '..', f));
['config.js', 'fleet.js', 'data/ports.js', 'data/world-land.js',
 'js/geo.js', 'js/format.js', 'js/store.js', 'js/ais.js', 'js/vessel.js'].forEach(load);

const { Geo, Fmt, Store, Ais, Vessel, PORTS, CONFIG, FLEET } = window;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL  ' + name + '\n      ' + e.message);
    process.exitCode = 1;
  }
}
const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ~${b}, got ${a}`);

/* --- Navigation --------------------------------------------------------- */

test('great-circle distance matches known legs', () => {
  close(Geo.distanceNm(-0.13, 51.51, -74.01, 40.71), 3008, 8, 'London→New York');
  close(Geo.distanceNm(2.635, 39.56, 1.436, 38.908), 68, 1.5, 'Palma→Ibiza');
  assert.strictEqual(Geo.distanceNm(10, 45, 10, 45), 0);
});

test('bearing is the initial great-circle course', () => {
  close(Geo.bearing(0, 0, 0, 10), 0, 0.01, 'due north');
  close(Geo.bearing(0, 0, 10, 0), 90, 0.01, 'due east');
  close(Geo.bearing(-0.13, 51.51, -74.01, 40.71), 288, 1, 'London→New York');
});

test('destination round-trips against distance and bearing', () => {
  const [lon, lat] = Geo.destination(2.635, 39.56, 225, 68);
  close(Geo.distanceNm(2.635, 39.56, lon, lat), 68, 0.01);
  close(Geo.bearing(2.635, 39.56, lon, lat), 225, 0.1);
});

test('destination normalises across the antimeridian', () => {
  const [lon] = Geo.destination(179.5, 0, 90, 120);
  assert.ok(lon >= -180 && lon <= 180, 'longitude wrapped into range, got ' + lon);
  assert.ok(lon < 0, 'crossing east from 179.5E lands in the western hemisphere');
});

test('compass points read correctly', () => {
  assert.strictEqual(Geo.compassPoint(0), 'N');
  assert.strictEqual(Geo.compassPoint(225), 'SW');
  assert.strictEqual(Geo.compassPoint(359), 'N');
  assert.strictEqual(Geo.compassPoint(-45), 'NW');
});

test('Mercator projection round-trips and clamps at the poles', () => {
  close(Geo.latFromWorldY(Geo.worldY(39.57)), 39.57, 1e-6);
  close(Geo.lonFromWorldX(Geo.worldX(-62.85)), -62.85, 1e-9);
  assert.ok(isFinite(Geo.worldY(90)), 'the pole must not produce Infinity');
  assert.ok(isFinite(Geo.worldY(-90)));
});

/* --- Sun ----------------------------------------------------------------- */

test('sunrise and sunset match published times', () => {
  // London, midwinter: published 08:04 / 15:53 UTC.
  const london = Geo.sunTimes(new Date('2026-12-21T12:00:00Z'), -0.13, 51.51);
  close(london.sunrise.getUTCHours() * 60 + london.sunrise.getUTCMinutes(), 484, 6);
  close(london.sunset.getUTCHours() * 60 + london.sunset.getUTCMinutes(), 953, 6);
});

test('polar day and night are reported, not faked', () => {
  assert.strictEqual(Geo.sunTimes(new Date('2026-06-21T12:00:00Z'), 18.95, 69.65).polar, 'day');
  assert.strictEqual(Geo.sunTimes(new Date('2026-12-21T12:00:00Z'), 18.95, 69.65).polar, 'night');
  const temperate = Geo.sunTimes(new Date('2026-06-21T12:00:00Z'), 2.65, 39.57);
  assert.strictEqual(temperate.polar, null);
});

test('solar altitude peaks near local noon', () => {
  // Palma, late August: elevation at local apparent noon ≈ 90 - lat + declination.
  close(Geo.solarAltitude(new Date('2026-08-28T11:50:00Z'), 2.65, 39.57), 60, 2);
  assert.ok(Geo.solarAltitude(new Date('2026-08-28T23:50:00Z'), 2.65, 39.57) < 0, 'midnight');
});

test('the terminator spans the globe and picks the dark pole', () => {
  const june = Geo.terminator(new Date('2026-06-21T12:00:00Z'), 10);
  assert.strictEqual(june.points.length, 37);
  assert.strictEqual(june.nightAtNorthPole, false, 'northern midsummer');
  assert.strictEqual(Geo.terminator(new Date('2026-12-21T12:00:00Z'), 10).nightAtNorthPole, true);
});

/* --- Twilight ------------------------------------------------------------ */

test('twilight contours stay ordered toward the dark pole', () => {
  // Ordering is what lets the chart fill bands between them: if a lower contour
  // ever crossed a higher one the band would invert and paint over daylight.
  const dates = ['2026-03-20T18:00:00Z', '2026-06-21T00:00:00Z',
                 '2026-08-28T12:00:00Z', '2026-09-22T09:00:00Z',
                 '2026-12-21T06:00:00Z', '2026-01-15T21:00:00Z'];
  for (const iso of dates) {
    const date = new Date(iso);
    const result = Geo.twilightContours(date, [-6, -12, -18], 5);
    const darkSign = result.nightAtNorthPole ? 1 : -1;
    for (let i = 0; i < result.contours[0].length; i++) {
      for (let k = 1; k < result.contours.length; k++) {
        const previous = result.contours[k - 1][i][1];
        const current = result.contours[k][i][1];
        assert.ok(darkSign * (current - previous) >= -0.01,
          `${iso}: contour ${k} crosses back at lon ${result.contours[k][i][0]}`);
      }
    }
  }
});

test('every twilight contour point is a real solution, a pole, or a closed band', () => {
  const altitudes = [0, -6, -12, -18];
  for (const iso of ['2026-08-28T12:00:00Z', '2026-09-22T09:00:00Z', '2026-12-21T06:00:00Z']) {
    const date = new Date(iso);
    const result = Geo.twilightContours(date, [-6, -12, -18], 5);
    result.contours.forEach((contour, k) => {
      contour.forEach(([lon, lat], i) => {
        if (Math.abs(lat) > 89.5) return;                                   // pinned at a pole
        if (k > 0 && Math.abs(lat - result.contours[k - 1][i][1]) < 0.001) return;  // zero-width band
        close(Geo.solarAltitude(date, lon, lat), altitudes[k], 0.01,
          `${iso} contour ${altitudes[k]} at lon ${lon}`);
      });
    });
  }
});

/* --- Ports and discretion ------------------------------------------------ */

test('nearest port resolves to the right harbour', () => {
  assert.strictEqual(Geo.nearestPort(-62.83, 17.90, PORTS).name, 'Gustavia');
  assert.strictEqual(Geo.nearestPort(7.42, 43.73, PORTS).name, 'Monaco');
  const offIbiza = Geo.nearestPort(1.60, 38.95, PORTS);
  assert.strictEqual(offIbiza.name, 'Ibiza');
  assert.ok(offIbiza.distanceNm > 3 && offIbiza.distanceNm < 30, offIbiza.distanceNm);
});

test('blurring moves a fix onto a coarse grid', () => {
  const [lon, lat] = Geo.blur(7.4256, 43.7350, 60);
  assert.ok(Geo.distanceNm(7.4256, 43.7350, lon, lat) > 0.5, 'the fix actually moved');
  assert.ok(Geo.distanceNm(7.4256, 43.7350, lon, lat) < 60, 'but stays in the right area');
  // Deterministic: the same input must not wander between frames.
  assert.deepStrictEqual(Geo.blur(7.4256, 43.7350, 60), [lon, lat]);
});

/* --- Coastline ----------------------------------------------------------- */

test('coastline decodes to sane geometry', () => {
  const rings = Geo.decodeLand(window.WORLD_LAND_ENCODED, window.WORLD_LAND_SCALE);
  assert.ok(rings.length > 1000, 'ring count ' + rings.length);
  let points = 0;
  for (const r of rings) {
    assert.strictEqual(r.length % 2, 0, 'rings hold lon/lat pairs');
    for (let i = 0; i < r.length; i += 2) {
      assert.ok(r[i + 1] >= -90.5 && r[i + 1] <= 90.5, 'latitude ' + r[i + 1]);
    }
    points += r.length / 2;
  }
  assert.ok(points > 40000, 'point count ' + points);
});

// Longitudes are deliberately NOT clamped to +/-180: rings that cross the
// antimeridian are unwrapped at build time so they stay continuous. What must
// hold is that no single step jumps the seam, because a step of ~360 degrees
// draws a bar straight across the chart.
test('no ring steps across the antimeridian', () => {
  const rings = Geo.decodeLand(window.WORLD_LAND_ENCODED, window.WORLD_LAND_SCALE);
  let worst = 0, offender = null;
  for (const r of rings) {
    for (let i = 2; i < r.length; i += 2) {
      const step = Math.abs(r[i] - r[i - 2]);
      if (step > worst) { worst = step; offender = r[i]; }
    }
  }
  assert.ok(worst <= 180, `largest longitude step ${worst.toFixed(1)} deg near lon ${offender}`);
});

/* --- Formatting ---------------------------------------------------------- */

test('positions format as degrees and decimal minutes', () => {
  assert.strictEqual(Fmt.latitude(39.5696), "39° 34.18' N");
  assert.strictEqual(Fmt.longitude(2.6502), "002° 39.01' E");
  assert.strictEqual(Fmt.longitude(-62.85), "062° 51.00' W");
  assert.strictEqual(Fmt.latitude(-33.91), "33° 54.60' S");
});

test('minute rollover carries into degrees', () => {
  assert.strictEqual(Fmt.latitude(39.99999), "40° 00.00' N");
});

test('units convert on demand', () => {
  assert.strictEqual(Fmt.distance(3008), '3,008 nm');
  assert.strictEqual(Fmt.speed(12.4), '12.4 kn');
  assert.strictEqual(Fmt.temperature(24.6), '25°C');
  CONFIG.units.distance = 'km';
  CONFIG.units.temperature = 'F';
  assert.strictEqual(Fmt.distance(100), '185 km');
  assert.strictEqual(Fmt.temperature(0), '32°F');
  CONFIG.units.distance = 'nm';
  CONFIG.units.temperature = 'C';
});

test('optional vessel fields render as a dash when empty', () => {
  // A vessel added through the console's form carries only its identifiers;
  // every view has to survive that, which it did not before the form existed.
  assert.strictEqual(Fmt.metres(null), '—');
  assert.strictEqual(Fmt.metres(undefined), '—');
  assert.strictEqual(Fmt.metres(NaN), '—');
  assert.strictEqual(Fmt.metres(52.5), '52.5 m');
  assert.strictEqual(Fmt.tonnage(null), '—');
  assert.strictEqual(Fmt.tonnage(1180), '1,180 GT');
  assert.strictEqual(Fmt.year(null), '—');
  assert.strictEqual(Fmt.year(2024), '2024');
  assert.strictEqual(Fmt.text(null), '—');
  assert.strictEqual(Fmt.text(''), '—');
  assert.strictEqual(Fmt.text('Lloyd\'s Register'), "Lloyd's Register");
});

test('missing values render as a dash, never as NaN', () => {
  ['distance', 'speed', 'windSpeed', 'temperature', 'waveHeight', 'bearing'].forEach((fn) => {
    assert.strictEqual(Fmt[fn](null), '—', fn + '(null)');
    assert.strictEqual(Fmt[fn](undefined), '—', fn + '(undefined)');
  });
  assert.strictEqual(Fmt.age(null), 'no fix');
  assert.strictEqual(Fmt.date('not a date'), '—');
});

test('fix age reads in the right unit', () => {
  const now = new Date('2026-08-28T12:00:00Z');
  assert.strictEqual(Fmt.age(new Date('2026-08-28T11:59:50Z'), now), 'just now');
  assert.strictEqual(Fmt.age(new Date('2026-08-28T11:51:00Z'), now), '9 min ago');
  assert.strictEqual(Fmt.age(new Date('2026-08-28T09:00:00Z'), now), '3 h ago');
  assert.strictEqual(Fmt.age(new Date('2026-08-26T12:00:00Z'), now), '2 days ago');
});

test('countdowns handle today, tomorrow and overdue', () => {
  const now = new Date('2026-08-28T09:00:00Z');
  assert.strictEqual(Fmt.until('2026-08-28T09:00:00Z', now).text, 'today');
  assert.strictEqual(Fmt.until('2026-08-29T09:00:00Z', now).text, 'tomorrow');
  assert.strictEqual(Fmt.until('2026-09-04T09:00:00Z', now).text, 'in 7 days');
  const late = Fmt.until('2026-08-26T09:00:00Z', now);
  assert.strictEqual(late.text, 'overdue by 2 days');
  assert.strictEqual(late.overdue, true);
});

test("ship's time follows longitude; a known offset wins when we have one", () => {
  const noonUtc = new Date('2026-08-28T12:00:00Z');
  assert.strictEqual(Fmt.nauticalTime(noonUtc, -62.85).text, '08:00');
  assert.strictEqual(Fmt.nauticalTime(noonUtc, -62.85).offsetHours, -4);
  assert.strictEqual(Fmt.timeAtOffset(noonUtc, 7200, false).text, '14:00');
  assert.strictEqual(Fmt.timeAtOffset(noonUtc, 7200, false).label, 'UTC+2');
  assert.strictEqual(Fmt.timeAtOffset(noonUtc, 19800, false).label, 'UTC+5:30');
});

/* --- AIS parsing --------------------------------------------------------- */

test('AISstream timestamps parse', () => {
  const t = Ais._parseTime('2026-08-28 19:41:02.123456789 +0000 UTC');
  assert.strictEqual(t.toISOString(), '2026-08-28T19:41:02.000Z');
  assert.ok(!isNaN(Ais._parseTime('nonsense')), 'garbage falls back to now');
});

/* --- Store --------------------------------------------------------------- */

function freshStore() {
  Store.listeners = [];
  Store.init(FLEET);
  Store.vessels.forEach((v) => { v.fix = null; v.track = []; v.voyage = {}; });
  return Store;
}

test('fixes are accepted only for known vessels', () => {
  const s = freshStore();
  assert.strictEqual(s.applyFix(FLEET[0].mmsi, { lon: 2, lat: 39, at: new Date() }), true);
  assert.strictEqual(s.applyFix(999999999, { lon: 2, lat: 39, at: new Date() }), false);
});

test('impossible coordinates are rejected', () => {
  const s = freshStore();
  const mmsi = FLEET[0].mmsi;
  assert.strictEqual(s.applyFix(mmsi, { lon: 181, lat: 39, at: new Date() }), false);
  assert.strictEqual(s.applyFix(mmsi, { lon: 2, lat: 91, at: new Date() }), false);
  assert.strictEqual(s.applyFix(mmsi, { lon: NaN, lat: 39, at: new Date() }), false);
  assert.strictEqual(s.byMmsi[String(mmsi)].fix, null);
});

test('an out-of-order message cannot drag a yacht backwards', () => {
  const s = freshStore();
  const mmsi = FLEET[0].mmsi;
  const now = new Date();
  s.applyFix(mmsi, { lon: 2, lat: 39, at: now });
  assert.strictEqual(s.applyFix(mmsi, { lon: 9, lat: 44, at: new Date(now - 60000) }), false);
  assert.strictEqual(s.byMmsi[String(mmsi)].fix.lon, 2);
});

test('a vessel alongside does not accumulate track points', () => {
  const s = freshStore();
  const mmsi = FLEET[0].mmsi;
  // Relative to now, not a fixed date: the store trims anything older than
  // CONFIG.display.trackHours, so a pinned timestamp quietly stops testing what
  // it says once the calendar moves past it.
  const t0 = Date.now() - 10 * 60 * 1000;
  for (let i = 0; i < 50; i++) {
    s.applyFix(mmsi, { lon: 2.0, lat: 39.0, at: new Date(t0 + i * 10000) });
  }
  assert.strictEqual(s.byMmsi[String(mmsi)].track.length, 1);
});

test('the track window drops fixes older than it', () => {
  const s = freshStore();
  const mmsi = FLEET[0].mmsi;
  const beyond = CONFIG.display.trackHours + 2;
  s.applyFix(mmsi, { lon: 2.0, lat: 39.0, at: new Date(Date.now() - beyond * 3600000) });
  s.applyFix(mmsi, { lon: 2.5, lat: 39.5, at: new Date() });
  s.recompute();
  assert.strictEqual(s.byMmsi[String(mmsi)].track.length, 1, 'only the recent fix survives');
});

test('status derives from navigational status, speed and yard period', () => {
  const s = freshStore();
  const now = new Date();
  const [a, b, c] = [FLEET[0].mmsi, FLEET[1].mmsi, FLEET[3].mmsi];
  s.applyFix(a, { lon: -30, lat: 30, sog: 12, navStatus: 0, at: now });
  s.applyFix(b, { lon: -30, lat: 31, sog: 0.1, navStatus: 1, at: now });
  s.applyFix(c, { lon: 7.4256, lat: 43.735, sog: 0, navStatus: 5, at: now });
  s.recompute();
  assert.strictEqual(s.byMmsi[String(a)].derived.status, 'underway');
  assert.strictEqual(s.byMmsi[String(b)].derived.status, 'anchored');
  assert.strictEqual(s.byMmsi[String(c)].derived.status, 'moored');

  // A yacht sitting still far from any harbour is at anchor, not alongside.
  const s2 = freshStore();
  s2.applyFix(a, { lon: -30, lat: 30, sog: 0.1, navStatus: null, at: new Date() });
  s2.recompute();
  assert.strictEqual(s2.byMmsi[String(a)].derived.status, 'anchored');
});

test('a stale fix becomes "no signal" rather than a confident position', () => {
  const s = freshStore();
  const mmsi = FLEET[0].mmsi;
  const old = new Date(Date.now() - (CONFIG.ais.darkPositionHours + 5) * 3600000);
  s.applyFix(mmsi, { lon: -38, lat: 29, sog: 15, navStatus: 0, at: old });
  s.recompute();
  const d = s.byMmsi[String(mmsi)].derived;
  assert.strictEqual(d.status, 'dark');
  assert.strictEqual(d.dark, true);
  assert.ok(d.lat != null, 'the last known position is still shown');
});

test('a refit period beats whatever AIS is saying', () => {
  const s = freshStore();
  const refit = FLEET.find((y) => y.service && y.service.yardPeriod);
  assert.ok(refit, 'the placeholder fleet includes a yacht in refit');
  const within = new Date(refit.service.yardPeriod.from).getTime() + 86400000;
  s.applyFix(refit.mmsi, { lon: 4.39, lat: 51.9, sog: 8, navStatus: 0, at: new Date(within) });
  // recompute() uses the wall clock, so only assert when the window is current.
  const now = Date.now();
  if (now >= new Date(refit.service.yardPeriod.from) && now <= new Date(refit.service.yardPeriod.to)) {
    s.applyFix(refit.mmsi, { lon: 4.39, lat: 51.9, sog: 8, navStatus: 0, at: new Date() });
    s.recompute();
    assert.strictEqual(s.byMmsi[String(refit.mmsi)].derived.status, 'refit');
  }
});

test('discreet vessels never expose an exact position downstream', () => {
  const s = freshStore();
  const discreet = FLEET.find((y) => y.discreet);
  assert.ok(discreet, 'the placeholder fleet includes a discreet yacht');
  s.applyFix(discreet.mmsi, { lon: 14.32, lat: 40.57, sog: 10, navStatus: 0, at: new Date() });
  s.recompute();
  const d = s.byMmsi[String(discreet.mmsi)].derived;
  assert.strictEqual(d.discreet, true);
  assert.notStrictEqual(d.lon, 14.32, 'the published longitude is not the real one');
  assert.ok(Geo.distanceNm(14.32, 40.57, d.lon, d.lat) > 1, 'and it has actually moved');
});

test('global discreet mode covers the whole fleet', () => {
  const s = freshStore();
  CONFIG.discreetMode = true;
  s.applyFix(FLEET[0].mmsi, { lon: 2.0, lat: 39.0, sog: 10, navStatus: 0, at: new Date() });
  s.recompute();
  assert.strictEqual(s.byMmsi[String(FLEET[0].mmsi)].derived.discreet, true);
  CONFIG.discreetMode = false;
});

test('summary counts every vessel exactly once', () => {
  const s = freshStore();
  s.recompute();
  const summary = s.summary();
  const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, FLEET.length);
  assert.strictEqual(summary.total, FLEET.length);
});

test('the schedule is sorted and free of invalid dates', () => {
  const s = freshStore();
  const items = s.upcoming();
  assert.ok(items.length > 0);
  for (let i = 1; i < items.length; i++) {
    assert.ok(items[i].date >= items[i - 1].date, 'soonest first');
  }
  items.forEach((i) => assert.ok(!isNaN(i.date), 'no invalid dates survive'));
});

test('a hostile storage layer does not take the board down', () => {
  const s = freshStore();
  s.applyFix(FLEET[0].mmsi, { lon: 2, lat: 39, at: new Date() });
  assert.doesNotThrow(() => s.persist());
  assert.doesNotThrow(() => s.clearCache());
});

/* --- Vessel records ------------------------------------------------------ */

test('IMO check digits are computed the way the standard defines them', () => {
  // Four real, published IMO numbers.
  for (const imo of ['9074729', '9395044', '9247455', '8814275']) {
    assert.strictEqual(Vessel.validateImo(imo).ok, true, imo + ' should be valid');
  }
});

test('a mistyped IMO is rejected with the digit it should have been', () => {
  const result = Vessel.validateImo('9074728');
  assert.strictEqual(result.ok, false);
  assert.ok(/check digit should be 9/.test(result.error), result.error);
});

test('IMO input is forgiving about formatting but strict about length', () => {
  assert.strictEqual(Vessel.validateImo('IMO 9395044').value, 9395044);
  assert.strictEqual(Vessel.validateImo('  9395044  ').value, 9395044);
  assert.strictEqual(Vessel.validateImo('123').ok, false);
  assert.strictEqual(Vessel.validateImo('90747290').ok, false);
  assert.strictEqual(Vessel.validateImo('90747ab').ok, false);
  assert.strictEqual(Vessel.validateImo('').ok, false);
  assert.strictEqual(Vessel.validateImo(null).ok, false);
});

test('MMSI must be a ship station, not a coast station or a handheld', () => {
  assert.strictEqual(Vessel.validateMmsi('319000001').value, 319000001);
  assert.strictEqual(Vessel.validateMmsi('249123456').ok, true);
  assert.strictEqual(Vessel.validateMmsi('991123456').ok, false, '99x is an aid to navigation');
  assert.strictEqual(Vessel.validateMmsi('009123456').ok, false, '00x is a coast station');
  assert.strictEqual(Vessel.validateMmsi('12345').ok, false);
  assert.strictEqual(Vessel.validateMmsi('').ok, false);
});

test('a built record renders to JavaScript that actually parses', () => {
  const record = Vessel.buildRecord({
    name: "O'Brien's Folly", mmsi: 319123456, imo: 9074729,
    loa: 52.5, yearBuilt: 2024, flag: 'Cayman Islands', prefix: 'S/Y'
  });
  const snippet = Vessel.toSnippet(record);
  const parsed = new Function('return [' + snippet + '][0]')();
  assert.strictEqual(parsed.mmsi, 319123456);
  assert.strictEqual(parsed.imo, 9074729);
  assert.strictEqual(parsed.name, "O'Brien's Folly", 'an apostrophe survives the round trip');
  assert.strictEqual(parsed.prefix, 'S/Y');
  assert.strictEqual(parsed.loa, 52.5);
  assert.strictEqual(parsed.service.openJobs, 0);
  assert.ok(Array.isArray(parsed.systems) && parsed.systems.length === 3);
});

test('unknown fields are left null rather than guessed', () => {
  const record = Vessel.buildRecord({ name: 'Bare', mmsi: 319000999, imo: 9074729 });
  assert.strictEqual(record.beam, null);
  assert.strictEqual(record.grossTonnage, null);
  assert.strictEqual(record.classSociety, null);
  assert.strictEqual(record.yearBuilt, null);
});

test('storage being unavailable is survivable, not fatal', () => {
  // The harness at the top of this file has localStorage throw on every call.
  assert.doesNotThrow(() => Vessel.loadAdditions());
  assert.deepStrictEqual(Vessel.loadAdditions(), []);
  assert.strictEqual(Vessel.addAddition({ id: 'x', mmsi: 1 }), false, 'reports the failure');
  assert.deepStrictEqual(Vessel.mergedFleet(FLEET).length, FLEET.length);
});

test('merging never shadows a vessel already in the file', () => {
  const additions = [
    { id: 'aurelia', name: 'Impostor', mmsi: 999999999 },
    { id: 'brand-new', name: 'New', mmsi: 319555555 }
  ];
  const original = Vessel.loadAdditions;
  Vessel.loadAdditions = () => additions;
  try {
    const merged = Vessel.mergedFleet(FLEET);
    assert.strictEqual(merged.length, FLEET.length + 1, 'the id clash is dropped');
    assert.ok(merged.some((y) => y.id === 'brand-new'));
    assert.strictEqual(merged.filter((y) => y.id === 'aurelia').length, 1);
    assert.strictEqual(merged.find((y) => y.id === 'aurelia').name, 'Aurelia');
    assert.strictEqual(merged.find((y) => y.id === 'brand-new').addedLocally, true);
  } finally {
    Vessel.loadAdditions = original;
  }
});

test('the generated fleet.js is valid and carries every change', () => {
  // Removing a vessel for good means changing the file, so what the console
  // writes out has to be loadable as fleet.js — nested records and all.
  const additions = [Vessel.buildRecord({
    name: "Hal's Folly", mmsi: 319123456, imo: 9074729, loa: 44.2, yearBuilt: 2025
  })];
  const originalAdditions = Vessel.loadAdditions;
  const originalHidden = Vessel.hiddenIds;
  Vessel.loadAdditions = () => additions;
  Vessel.hiddenIds = () => ['corvina'];
  try {
    const merged = Vessel.mergedFleet(FLEET);
    const file = Vessel.toFleetFile(merged);

    // Run in a fresh realm, then normalise: objects built there carry that
    // realm's prototypes, which deepStrictEqual compares by identity.
    const sandbox = { window: {} };
    require('vm').runInNewContext(file, sandbox);
    const out = JSON.parse(JSON.stringify(sandbox.window.FLEET));

    assert.strictEqual(out.length, FLEET.length, 'one out, one in');
    assert.ok(!out.some((y) => y.id === 'corvina'), 'the removed vessel is gone');
    assert.ok(out.some((y) => y.name === "Hal's Folly"), 'the added one is there, apostrophe intact');
    assert.ok(!out.some((y) => 'addedLocally' in y), 'the local marker is not written out');

    // A full record must survive with its nesting.
    const aurelia = out.find((y) => y.id === 'aurelia');
    const source = JSON.parse(JSON.stringify(FLEET.find((y) => y.id === 'aurelia')));
    assert.deepStrictEqual(aurelia.systems, source.systems);
    assert.deepStrictEqual(aurelia.contacts, source.contacts);
    assert.deepStrictEqual(aurelia.service, source.service);
    assert.deepStrictEqual(aurelia.demo.route, source.demo.route);
    assert.strictEqual(aurelia.classSociety, source.classSociety);
  } finally {
    Vessel.loadAdditions = originalAdditions;
    Vessel.hiddenIds = originalHidden;
  }
});

test('writing the file out and reading it back is stable', () => {
  // Round-tripping twice must not drift, or repeated edits would rot the file.
  const once = Vessel.toFleetFile(FLEET);
  const sandbox = { window: {} };
  require('vm').runInNewContext(once, sandbox);
  const twice = Vessel.toFleetFile(sandbox.window.FLEET);
  assert.strictEqual(once, twice, 'a second pass produces identical output');
});

/* --- Fleet data ---------------------------------------------------------- */

test('the fleet file is internally consistent', () => {
  const ids = new Set(), mmsis = new Set();
  FLEET.forEach((y) => {
    assert.ok(y.id && !ids.has(y.id), 'unique id: ' + y.id);
    ids.add(y.id);
    assert.ok(/^\d{9}$/.test(String(y.mmsi)), 'MMSI is nine digits: ' + y.mmsi);
    assert.ok(!mmsis.has(y.mmsi), 'unique MMSI: ' + y.mmsi);
    mmsis.add(y.mmsi);
    assert.ok(/^\d{7}$/.test(String(y.imo)), 'IMO is seven digits: ' + y.imo);
    assert.strictEqual(Vessel.validateImo(String(y.imo)).ok, true,
      y.name + "'s IMO " + y.imo + ' must pass the same check the add form applies');
    assert.strictEqual(Vessel.validateMmsi(String(y.mmsi)).ok, true,
      y.name + "'s MMSI " + y.mmsi + ' must be a ship-station MMSI');
    assert.ok(y.loa > 0 && y.loa < 200, 'plausible LOA: ' + y.loa);
    if (y.demo && y.demo.position) {
      assert.ok(Math.abs(y.demo.position[0]) <= 180 && Math.abs(y.demo.position[1]) <= 90);
    }
    (y.demo && y.demo.route ? y.demo.route : []).forEach(([lon, lat]) => {
      assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90, y.id + ' route point');
    });
  });
});

test('the port list is well formed', () => {
  assert.ok(PORTS.length > 200, 'port count ' + PORTS.length);
  PORTS.forEach((p) => {
    assert.strictEqual(p.length, 5, 'five fields: ' + p[0]);
    assert.ok(typeof p[0] === 'string' && p[0].length, 'has a name');
    assert.ok(Math.abs(p[2]) <= 180 && Math.abs(p[3]) <= 90, 'in range: ' + p[0]);
    assert.ok(p[4] === 1 || p[4] === 2, 'tier is 1 or 2: ' + p[0]);
  });
});

console.log(`\n${passed} checks passed` + (process.exitCode ? ' — with failures above\n' : '\n'));
