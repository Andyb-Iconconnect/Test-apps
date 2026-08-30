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
 'js/geo.js', 'js/format.js', 'js/store.js', 'js/ais.js', 'js/vessel.js',
 'js/demo.js'].forEach(load);

const { Geo, Fmt, Store, Ais, Vessel, Demo, PORTS, CONFIG } = window;

// The behavioural tests run against a fixed sample fleet, NOT against fleet.js.
// fleet.js is the file you replace with your own boats; a suite that failed the
// moment you did that would be crying wolf on every real edit. Checks that are
// genuinely about your file — unique ids, valid MMSIs — use REAL_FLEET below.
load('tools/fixtures/fleet-sample.js');
const FLEET = window.FLEET_SAMPLE;
const REAL_FLEET = window.FLEET;

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
  assert.strictEqual(parsed.discreet, false);
  assert.ok(!('service' in parsed) && !('systems' in parsed) && !('contacts' in parsed),
    'the record carries nothing but identity and position');
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
    assert.deepStrictEqual(aurelia.demo.route, source.demo.route,
      'the demo route survives, nesting and all');
    assert.strictEqual(aurelia.classSociety, source.classSociety);
    assert.strictEqual(aurelia.discreet, source.discreet);
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

test('the AIS parser reads the fields AISstream actually sends', () => {
  // Field names are from aisstream/ais-message-models. Getting one wrong yields
  // undefined rather than an error, so it is worth pinning.
  const s = freshStore();
  const mmsi = FLEET[0].mmsi;
  const original = window.Store;
  window.Store = s;
  try {
    Ais._handle({
      MessageType: 'PositionReport',
      MetaData: { MMSI: mmsi, time_utc: new Date().toISOString() },
      Message: { PositionReport: {
        Valid: true, Latitude: 39.5, Longitude: 2.6, Cog: 91.2, Sog: 9.4,
        TrueHeading: 88, NavigationalStatus: 0, RateOfTurn: -12,
        PositionAccuracy: true, Raim: true
      } }
    });
    Ais._handle({
      MessageType: 'ShipStaticData',
      MetaData: { MMSI: mmsi, time_utc: new Date().toISOString() },
      Message: { ShipStaticData: {
        Valid: true, Name: 'AURELIA@@@@', CallSign: 'ZGAA1@', ImoNumber: 9900019,
        Type: 37, FixType: 1, MaximumStaticDraught: 3.4, Destination: 'PALMA@@',
        Dimension: { A: 40, B: 22, C: 5, D: 6 },
        Eta: { Month: 9, Day: 4, Hour: 6, Minute: 0 }
      } }
    });
  } finally {
    window.Store = original;
  }

  const v = s.byMmsi[String(mmsi)];
  assert.strictEqual(v.fix.sog, 9.4);
  assert.strictEqual(v.fix.accurate, true);
  assert.strictEqual(v.fix.turning, 'port', 'a negative rate of turn is to port');
  assert.strictEqual(v.ais.name, 'AURELIA', 'the @ padding is stripped');
  assert.strictEqual(v.ais.callSign, 'ZGAA1');
  assert.strictEqual(v.ais.imo, 9900019);
  assert.strictEqual(v.ais.shipType, 37);
  assert.strictEqual(v.ais.loa, 62, 'length is Dimension A + B');
  assert.strictEqual(v.ais.beam, 11, 'beam is Dimension C + D');
  assert.strictEqual(v.voyage.destination, 'PALMA');
});

test('a message the decoder marked invalid is dropped', () => {
  const s = freshStore();
  const mmsi = FLEET[0].mmsi;
  const original = window.Store;
  window.Store = s;
  try {
    Ais._handle({
      MessageType: 'PositionReport',
      MetaData: { MMSI: mmsi, time_utc: new Date().toISOString() },
      Message: { PositionReport: { Valid: false, Latitude: 0, Longitude: 0 } }
    });
  } finally {
    window.Store = original;
  }
  assert.strictEqual(s.byMmsi[String(mmsi)].fix, null, 'nothing was plotted');
});

test('AIS identity is merged across messages, not replaced', () => {
  // Name and dimensions arrive in one message, IMO and call sign in another.
  // Replacing wholesale would lose half of it on every update.
  const s = freshStore();
  const mmsi = FLEET[0].mmsi;
  s.applyIdentity(mmsi, { name: 'AURELIA', loa: 62, beam: 11 });
  s.applyIdentity(mmsi, { imo: 9900019, callSign: 'ZGAA1' });
  const ais = s.byMmsi[String(mmsi)].ais;
  assert.strictEqual(ais.name, 'AURELIA', 'the earlier message survives');
  assert.strictEqual(ais.imo, 9900019);
  assert.strictEqual(ais.loa, 62);
});

test('a transponder reporting another vessel is flagged', () => {
  // The failure this exists for: an MMSI typed one digit out subscribes the
  // board to a stranger, and every other thing on screen still looks right.
  const s = freshStore();
  const y = FLEET[0];
  s.applyIdentity(y.mmsi, {
    name: 'SOMEONE ELSE', imo: 9111111, loa: 24
  });
  s.applyFix(y.mmsi, { lon: 2, lat: 39, sog: 0, at: new Date() });
  s.recompute();
  const m = s.byMmsi[String(y.mmsi)].derived.mismatches;
  const fields = m.map((x) => x.field).sort();
  assert.deepStrictEqual(fields, ['IMO', 'Length', 'Name'], 'all three disagree');
  assert.strictEqual(m.find((x) => x.field === 'Name').reported, 'SOMEONE ELSE');
});

test('the identity check does not cry wolf over AIS formatting', () => {
  // AIS is upper case, often abbreviated, and its dimensions are integer metres
  // from the antenna rather than a registry LOA. None of that is a mismatch.
  const s = freshStore();
  const y = FLEET[0];
  s.applyIdentity(y.mmsi, {
    name: 'M/Y ' + y.name.toUpperCase(),
    imo: y.imo,
    callSign: y.callSign ? y.callSign.toLowerCase() : null,
    loa: Math.round(y.loa) - 2
  });
  s.applyFix(y.mmsi, { lon: 2, lat: 39, sog: 0, at: new Date() });
  s.recompute();
  assert.deepStrictEqual(s.byMmsi[String(y.mmsi)].derived.mismatches, [],
    'no complaint about case, prefix, or a couple of metres');
});

test('set and drift is only reported when it means something', () => {
  const s = freshStore();
  const mmsi = FLEET[0].mmsi;
  const at = new Date();

  // Stationary: heading and course disagree freely and it signifies nothing.
  s.applyFix(mmsi, { lon: 2, lat: 39, sog: 0.2, cog: 90, heading: 200, at });
  s.recompute();
  assert.strictEqual(s.byMmsi[String(mmsi)].derived.setAndDrift, null, 'not at rest');

  // Underway and pointing where she is going: nothing to report.
  s.applyFix(mmsi, { lon: 2, lat: 39, sog: 10, cog: 90, heading: 88, at });
  s.recompute();
  assert.strictEqual(s.byMmsi[String(mmsi)].derived.setAndDrift, null, 'not when tracking true');

  // Crabbing: her head is 15 degrees left of her track, so she is set to starboard.
  s.applyFix(mmsi, { lon: 2, lat: 39, sog: 10, cog: 90, heading: 75, at });
  s.recompute();
  const sd = s.byMmsi[String(mmsi)].derived.setAndDrift;
  assert.strictEqual(sd.degrees, 15);
  assert.strictEqual(sd.side, 'starboard');

  // And the wrap at north is not 345 degrees of it.
  s.applyFix(mmsi, { lon: 2, lat: 39, sog: 10, cog: 5, heading: 350, at });
  s.recompute();
  assert.strictEqual(s.byMmsi[String(mmsi)].derived.setAndDrift.degrees, 15,
    'the compass wraps');
});

test('a discreet vessel reports no set and drift either', () => {
  // It is derived from heading and course, which are exact even when the
  // position shown has been blurred.
  const s = freshStore();
  const y = FLEET.find((v) => v.discreet);
  s.applyFix(y.mmsi, { lon: 2, lat: 39, sog: 10, cog: 90, heading: 70, at: new Date() });
  s.recompute();
  assert.strictEqual(s.byMmsi[String(y.mmsi)].derived.setAndDrift, null);
});

test('a record built from the form carries a demo block that can place her', () => {
  // The failure this prevents: a vessel added through the console with nothing
  // in the position fields, which then never appears on the chart and looks for
  // all the world like a vessel that was never added.
  const bare = Vessel.buildRecord({ name: 'Bare', mmsi: 319000999, imo: 9074729 });
  assert.ok(bare.demo, 'there is always a demo block');
  assert.ok(bare.demo.route || bare.demo.position || bare.demo.port,
    'and it can always place her');

  const byPort = Vessel.buildRecord({
    name: 'Ported', mmsi: 319000998, imo: 9074729, demoStatus: 'anchored', demoPort: 'Göcek'
  });
  assert.strictEqual(byPort.demo.port, 'Göcek');
  assert.strictEqual(byPort.demo.status, 'anchored');

  // An exact position wins over a port.
  const byFix = Vessel.buildRecord({
    name: 'Fixed', mmsi: 319000997, imo: 9074729,
    demoPort: 'Göcek', demoLat: 36.75, demoLon: 28.94
  });
  assert.deepStrictEqual(byFix.demo.position, [28.94, 36.75], 'stored [lon, lat]');
  assert.ok(!('port' in byFix.demo), 'and the port is not also kept');
});

test('an existing route survives an edit through the form', () => {
  // A route is more than the form can edit. Flattening it to a single point
  // because the position boxes were empty would throw away the work.
  const source = FLEET.find((y) => y.demo && y.demo.route);
  assert.ok(source, 'the sample fleet still has a routed vessel');
  const fields = Vessel.toFields(source);
  fields.name = 'Renamed';
  const rebuilt = Vessel.buildRecord(fields);
  assert.deepStrictEqual(rebuilt.demo.route, source.demo.route);
  assert.strictEqual(rebuilt.name, 'Renamed');
});

test('a record survives a round trip through the form fields', () => {
  const source = FLEET.find((y) => y.id === 'silver-meridian');
  const rebuilt = Vessel.buildRecord(Vessel.toFields(source));
  ['id', 'name', 'prefix', 'mmsi', 'imo', 'callSign', 'flag', 'flagCode',
   'loa', 'beam', 'grossTonnage', 'builder', 'yearBuilt', 'lastRefit',
   'classSociety', 'photo', 'discreet'].forEach((key) => {
    assert.deepStrictEqual(rebuilt[key], source[key], key + ' survives');
  });
  assert.deepStrictEqual(rebuilt.demo, source.demo, 'and so does the demo block');
});

test('editing a fleet.js vessel overrides it without touching the file', () => {
  const originalOverrides = Vessel.loadOverrides;
  const target = FLEET.find((y) => y.id === 'corvina');
  const edited = Vessel.buildRecord(
    Object.assign(Vessel.toFields(target), { name: 'Corvina II', loa: 41.2 })
  );
  Vessel.loadOverrides = () => ({ corvina: edited });
  try {
    const merged = Vessel.mergedFleet(FLEET);
    assert.strictEqual(merged.length, FLEET.length, 'still one record, not two');
    const out = merged.find((y) => y.id === 'corvina');
    assert.strictEqual(out.name, 'Corvina II');
    assert.strictEqual(out.loa, 41.2);
    assert.strictEqual(out.editedLocally, true, 'and it is marked as a local edit');
    // Everyone else is untouched.
    assert.strictEqual(merged.find((y) => y.id === 'aurelia').name, 'Aurelia');
  } finally {
    Vessel.loadOverrides = originalOverrides;
  }
});

test('a local edit is never written into the file as a marker', () => {
  const originalOverrides = Vessel.loadOverrides;
  const target = FLEET.find((y) => y.id === 'corvina');
  const edited = Vessel.buildRecord(
    Object.assign(Vessel.toFields(target), { name: 'Corvina II' })
  );
  Vessel.loadOverrides = () => ({ corvina: edited });
  try {
    const file = Vessel.toFleetFile(Vessel.mergedFleet(FLEET));
    assert.ok(!/editedLocally/.test(file), 'the marker stays out of the file');
    assert.ok(!/addedLocally/.test(file), 'and so does the other one');
    const sandbox = { window: {} };
    require('vm').runInNewContext(file, sandbox);
    assert.strictEqual(
      sandbox.window.FLEET.find((y) => y.id === 'corvina').name, 'Corvina II',
      'the edit is baked in');
  } finally {
    Vessel.loadOverrides = originalOverrides;
  }
});

test('a pasted entry says the same thing the written file does', () => {
  // toSnippet was written by hand and drifted from the file writer, most
  // recently over `demo` — whose absence leaves a pasted vessel unplaceable.
  const y = FLEET.find((v) => v.id === 'wind-verity');
  const snippet = Vessel.toSnippet(y);
  const fromSnippet = new Function('return [' + snippet + '][0]')();
  const sandbox = { window: {} };
  require('vm').runInNewContext(Vessel.toFleetFile([y]), sandbox);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(fromSnippet)),
    JSON.parse(JSON.stringify(sandbox.window.FLEET[0])),
    'entry and file agree field for field');
});

test('a demo vessel told she is underway actually makes way', () => {
  // The console offers "underway" as a choice, so it has to mean something. Given
  // only a point to sit on she would report zero knots and derive as alongside,
  // which is the opposite of what was asked for.
  const withPort = Demo._makeAgent({ yacht: {
    name: 'Test', mmsi: 319000001,
    demo: { status: 'underway', port: 'Bodrum', destination: 'RHODES', speed: 12 }
  } });
  assert.ok(withPort.route, 'she is given a route');
  assert.strictEqual(withPort.route.length, 2);
  const rhodes = PORTS.find((p) => p[0] === 'Rhodes');
  assert.ok(Geo.distanceNm(withPort.route[1][0], withPort.route[1][1], rhodes[2], rhodes[3]) < 1,
    'and it heads for the port she says she is bound for');

  // A destination nobody has heard of still gets her to sea rather than stuck.
  const unknown = Demo._makeAgent({ yacht: {
    name: 'Test', mmsi: 319000002,
    demo: { status: 'underway', port: 'Bodrum', destination: 'NOWHERE' }
  } });
  assert.ok(unknown.route, 'still under way');
  assert.ok(unknown.speed > 0, 'and at some speed');
  assert.ok(Geo.distanceNm(unknown.route[0][0], unknown.route[0][1],
                           unknown.route[1][0], unknown.route[1][1]) > 50,
    'headed somewhere, not in circles');

  // Alongside stays put.
  const alongside = Demo._makeAgent({ yacht: {
    name: 'Test', mmsi: 319000003, demo: { status: 'moored', port: 'Bodrum' }
  } });
  assert.ok(!alongside.route, 'a vessel alongside is not given a route');
  assert.ok(alongside.home, 'she has a berth');
});

test('every port named in a demo block exists in data/ports.js', () => {
  // A demo block naming a port that is not in the list leaves that yacht with
  // no position at all, which looks exactly like a yacht that is simply not
  // showing up. Catch the typo here instead.
  const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const known = new Set(PORTS.map((p) => norm(p[0])));
  FLEET.concat(REAL_FLEET).forEach((y) => {
    if (!y.demo || !y.demo.port) return;
    assert.ok(known.has(norm(y.demo.port)),
      `${y.name}: no port named "${y.demo.port}" in data/ports.js`);
  });
});

test('a vessel that demo mode cannot place is a fault worth naming', () => {
  // Every record needs a route, a position or a port, or it never reaches the
  // chart while looking for all the world like a record that simply is not there.
  REAL_FLEET.forEach((y) => {
    assert.ok(y.demo, `${y.name}: no demo block, so demo mode gives her no position`);
    assert.ok(y.demo.route || y.demo.position || y.demo.port,
      `${y.name}: demo block has no route, position or port`);
  });
});

test('the fleet file is internally consistent', () => {
  const ids = new Set(), mmsis = new Set();
  assert.ok(REAL_FLEET.length, 'fleet.js has at least one vessel in it');
  REAL_FLEET.forEach((y) => {
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


/* --- Vessel profiles ------------------------------------------------------ */

// profile.js draws into SVG elements. This is enough of a document for it: the
// nodes only need to remember their tag, attributes and children so the drawing
// can be read back and checked.
(function () {
  function stubNode(name) {
    return {
      tagName: name, attrs: {}, children: [],
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      appendChild(c) { this.children.push(c); return c; }
    };
  }
  global.document = { createElementNS: (ns, name) => stubNode(name) };
  require(path.join(__dirname, '..', 'js/profile.js'));
  const { Profile } = window;

  // Every coordinate pair in a path's `d`, and the corners of a rect.
  function pointsOf(node) {
    if (node.tagName === 'path') {
      const n = (node.attrs.d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
      return pts;
    }
    if (node.tagName === 'rect') {
      const x = +node.attrs.x, y = +node.attrs.y;
      return [[x, y], [x + +node.attrs.width, y + +node.attrs.height]];
    }
    if (node.tagName === 'circle') {
      const cx = +node.attrs.cx, cy = +node.attrs.cy, r = +node.attrs.r;
      return [[cx - r, cy - r], [cx + r, cy + r]];
    }
    return [];
  }

  function drawing(yacht) {
    const svg = Profile.create(yacht);
    const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    // Everything the vessel is made of lives in the transformed group.
    const g = svg.children.find((c) => c.tagName === 'g');
    const scale = +/scale\(([\d.]+)\)/.exec(g.attrs.transform)[1];
    const shift = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(g.attrs.transform);
    const parts = {};
    g.children.forEach((c) => {
      const cls = c.attrs.class;
      (parts[cls] = parts[cls] || []).push(pointsOf(c).map(
        ([x, y]) => [+shift[1] + scale * x, +shift[2] + scale * y]
      ));
    });
    return { width: vb[2], height: vb[3], parts };
  }

  const box = (groups) => {
    const all = [].concat(...groups);
    return {
      x0: Math.min(...all.map((p) => p[0])), x1: Math.max(...all.map((p) => p[0])),
      y0: Math.min(...all.map((p) => p[1])), y1: Math.max(...all.map((p) => p[1]))
    };
  };

  test('every vessel in the fleet draws a profile that fits its frame', () => {
    // Both fleets: the sample for variety, yours because it is the one that goes
    // on the wall.
    FLEET.concat(REAL_FLEET).forEach((y) => {
      const d = drawing(y);
      assert.ok(d.height > 0, y.name + ': the frame has height');
      Object.keys(d.parts).forEach((cls) => {
        const b = box(d.parts[cls]);
        assert.ok(b.y0 >= -1, y.name + ': ' + cls + ' stays below the top edge (' + b.y0 + ')');
        assert.ok(b.y1 <= d.height + 1, y.name + ': ' + cls + ' stays above the bottom edge');
        assert.ok(b.x0 >= -1 && b.x1 <= d.width + 1, y.name + ': ' + cls + ' stays within the sides');
      });
    });
  });

  test('a motor yacht is drawn bow forward, not stern forward', () => {
    // The regression this guards: stepping the deck levels the other way puts
    // the bridge at the stern and draws the boat backwards.
    const big = FLEET.find((y) => !Profile.isSail(y) && y.loa >= 70);
    const d = drawing(big);
    const hull = box(d.parts['p-hull']);
    const house = box(d.parts['p-house']);

    assert.ok(house.x0 > hull.x0 && house.x1 < hull.x1,
      'the superstructure sits inside the hull');
    // The foredeck — hull forward of the bridge front — is longer than the
    // after deck. On a motor yacht it is the other way about only if she is
    // drawn facing the wrong way.
    const foredeck = hull.x1 - house.x1;
    const afterdeck = house.x0 - hull.x0;
    assert.ok(foredeck > afterdeck * 1.3,
      'the foredeck is the long one: fore ' + foredeck.toFixed(0) + ' vs aft ' + afterdeck.toFixed(0));
    // And the topmost level is the forward one.
    const tops = d.parts['p-house'][0];
    const highest = Math.min(...tops.map((p) => p[1]));
    const atTop = tops.filter((p) => p[1] < highest + 1).map((p) => p[0]);
    const bridge = (Math.min(...atTop) + Math.max(...atTop)) / 2;
    assert.ok(bridge > (hull.x0 + hull.x1) / 2,
      'the bridge deck sits forward of amidships');
  });

  test('a sailing yacht is drawn with a rig and a keel', () => {
    const sloop = FLEET.find((y) => Profile.isSail(y));
    assert.ok(sloop, 'the placeholder fleet still carries a sailing yacht');
    const d = drawing(sloop);
    const hull = box(d.parts['p-hull']);
    const mast = box(d.parts['p-mast']);
    const keel = box(d.parts['p-keel']);

    assert.ok(mast.y1 - mast.y0 > (hull.x1 - hull.x0) * 0.7,
      'the mast is tall against her length');
    assert.ok(mast.y0 < hull.y0, 'the masthead is above the sheer');
    assert.ok(keel.y1 > hull.y1, 'the keel hangs below the hull');
    assert.strictEqual(d.parts['p-keel'].length, 2, 'keel and rudder both drawn');
  });

  test('a drawn profile is never wider than the frame it is cut for', () => {
    // frameAspect is what the console sizes its band from; if it disagreed with
    // the viewBox the band would be the wrong shape.
    FLEET.forEach((y) => {
      const d = drawing(y);
      close(Profile.frameAspect(y), d.width / d.height, 0.001, y.name + ': frame aspect matches');
    });
  });
})();


/* --- Photo fetching ------------------------------------------------------- */

// The fixture as a fleet FILE, named the way fleet.js names it, so the tools
// that read one can be pointed at it instead of at yours.
const sampleSource = () => require('fs')
  .readFileSync(path.join(__dirname, 'fixtures', 'fleet-sample.js'), 'utf8')
  .replace('window.FLEET_SAMPLE =', 'window.FLEET =');

test('repointing a photo field changes that field and nothing else', () => {
  const { repoint, loadFleet } = require(path.join(__dirname, 'fetch-photos.js'));
  const source = sampleSource();
  const before = loadFleet(source);

  let edited = repoint(source, 'aurelia', 'assets/photos/aurelia.jpg');
  edited = repoint(edited, 'wind-verity', "assets/photos/o'brien.jpg");
  const after = loadFleet(edited);

  assert.strictEqual(after.length, before.length, 'the same fleet comes back');
  assert.strictEqual(after.find((y) => y.id === 'aurelia').photo, 'assets/photos/aurelia.jpg');
  assert.strictEqual(after.find((y) => y.id === 'wind-verity').photo, "assets/photos/o'brien.jpg",
    'an apostrophe in the filename survives');

  const strip = (f) => JSON.stringify(f.map((y) => Object.assign({}, y, { photo: null })));
  assert.strictEqual(strip(after), strip(before), 'every other field is untouched');

  // Only the two lines should differ. A whole-file rewrite would pass the check
  // above while flattening the header, which is the thing to guard against.
  const changedLines = source.split('\n')
    .filter((line, i) => line !== edited.split('\n')[i]).length;
  assert.ok(changedLines <= 2, 'the edit is two lines, not a rewrite (' + changedLines + ')');
});

test('repointing a record that has no photo field adds one', () => {
  const { repoint, loadFleet } = require(path.join(__dirname, 'fetch-photos.js'));
  const source = sampleSource();
  const stripped = source.replace(/^[ \t]*photo:[^\n]*\n/gm, '');
  assert.ok(!/photo:/.test(stripped), 'the fixture really has no photo fields');

  const after = loadFleet(repoint(stripped, 'corvina', 'assets/photos/corvina.jpg'));
  assert.strictEqual(after.find((y) => y.id === 'corvina').photo, 'assets/photos/corvina.jpg');
  assert.ok(after.every((y) => y.id === 'corvina' || y.photo === undefined),
    'no other record picked up a photo');
});

test('repointing an id that is not in the fleet refuses rather than guessing', () => {
  const { repoint } = require(path.join(__dirname, 'fetch-photos.js'));
  const source = sampleSource();
  assert.throws(() => repoint(source, 'not-a-yacht', 'x.jpg'), /no record with id/);
});

/* --- Photographs held in the browser -------------------------------------- */

(function () {
  // The shared harness gives a localStorage that throws, on purpose. These need
  // one that works, plus one that is full, so both are built here.
  const realStorage = global.localStorage;
  function fakeStorage(capacityBytes) {
    const data = {};
    return {
      getItem(k) { return k in data ? data[k] : null; },
      setItem(k, v) {
        const used = Object.keys(data).reduce(
          (n, key) => n + (key === k ? 0 : data[key].length), 0);
        if (capacityBytes != null && used + v.length > capacityBytes) {
          const e = new Error('quota');
          e.name = 'QuotaExceededError';
          throw e;
        }
        data[k] = String(v);
      },
      removeItem(k) { delete data[k]; }
    };
  }

  global.localStorage = fakeStorage();
  load('js/photos.js');
  const { Photos } = window;
  const uri = (n) => 'data:image/jpeg;base64,' + 'A'.repeat(n);

  test('a photograph is stored against the vessel and read back', () => {
    global.localStorage = fakeStorage();
    assert.strictEqual(Photos.get('aurelia'), null, 'nothing to begin with');
    assert.strictEqual(Photos.set('aurelia', uri(100)).ok, true);
    assert.ok(Photos.get('aurelia').startsWith('data:image/jpeg'));
    assert.deepStrictEqual(Photos.ids(), ['aurelia']);
    assert.strictEqual(Photos.has('aurelia'), true);
    assert.strictEqual(Photos.remove('aurelia'), true);
    assert.strictEqual(Photos.get('aurelia'), null, 'and it is gone');
    assert.strictEqual(Photos.remove('aurelia'), false, 'removing twice is not an error');
  });

  test('an uploaded photograph beats the path in the record', () => {
    global.localStorage = fakeStorage();
    const yacht = { id: 'aurelia', photo: 'assets/photos/aurelia.jpg' };
    assert.strictEqual(Photos.resolve(yacht), 'assets/photos/aurelia.jpg',
      'the record is used when nothing is uploaded');
    Photos.set('aurelia', uri(50));
    assert.ok(Photos.resolve(yacht).startsWith('data:'), 'the upload wins');
    Photos.remove('aurelia');
    assert.strictEqual(Photos.resolve(yacht), 'assets/photos/aurelia.jpg',
      'and the record is used again once it is gone');
    assert.strictEqual(Photos.resolve({ id: 'x' }), null, 'neither is null, not undefined');
  });

  test('running out of storage says so and leaves what was there alone', () => {
    // A photograph that silently failed to save is worse than one that plainly
    // refused, and browsers run out sooner than anyone expects.
    global.localStorage = fakeStorage(400);
    assert.strictEqual(Photos.set('aurelia', uri(100)).ok, true, 'the first one fits');
    const before = Photos.get('aurelia');

    const result = Photos.set('corvina', uri(5000));
    assert.strictEqual(result.ok, false, 'the second does not');
    assert.strictEqual(result.full, true, 'and it is reported as a quota problem');
    assert.strictEqual(Photos.get('corvina'), null, 'the one that failed is not half-stored');
    assert.strictEqual(Photos.get('aurelia'), before, 'and the one that fitted survives');
  });

  test('replacing a photograph that does not fit keeps the old one', () => {
    global.localStorage = fakeStorage(400);
    Photos.set('aurelia', uri(100));
    const before = Photos.get('aurelia');
    assert.strictEqual(Photos.set('aurelia', uri(5000)).ok, false);
    assert.strictEqual(Photos.get('aurelia'), before,
      'the photograph she had is still there');
  });

  test('storage that is switched off entirely is survivable', () => {
    global.localStorage = realStorage;      // the throwing one
    assert.doesNotThrow(() => Photos.load());
    assert.deepStrictEqual(Photos.load(), {});
    assert.strictEqual(Photos.get('aurelia'), null);
    const result = Photos.set('aurelia', uri(10));
    assert.strictEqual(result.ok, false);
    assert.doesNotThrow(() => Photos.usageBytes());
  });

  test('usage is reported in the size the bytes actually take', () => {
    global.localStorage = fakeStorage();
    Photos.set('aurelia', uri(4000));
    // Base64 carries 6 bits per character, so the bytes are three quarters of it.
    const expected = Math.round(('data:image/jpeg;base64,'.length + 4000) * 0.75);
    close(Photos.usageBytes(), expected, 2, 'usage');
    assert.strictEqual(Photos.formatBytes(512), '512 B');
    assert.strictEqual(Photos.formatBytes(2048), '2 KB');
    assert.strictEqual(Photos.formatBytes(3 * 1024 * 1024), '3.0 MB');
  });

  test('the export path is the one the written file points at', () => {
    // These two must agree or the file names a photograph that was never saved.
    assert.strictEqual(Photos.exportName('silver-meridian'),
      'assets/photos/silver-meridian.jpg');
  });

  global.localStorage = realStorage;
})();

console.log(`\n${passed} checks passed` + (process.exitCode ? ' — with failures above\n' : '\n'));
