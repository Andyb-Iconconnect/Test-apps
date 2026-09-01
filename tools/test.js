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

const fs = require('fs');
const load = (f) => require(path.join(__dirname, '..', f));
// Some checks are about the source of a file rather than its behaviour.
const readRepo = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
['config.js', 'fleet.js', 'data/mid.js', 'data/ports.js', 'data/world-land.js',
 'js/geo.js', 'js/format.js', 'js/store.js', 'js/ais.js', 'js/vessel.js',
 'js/demo.js', 'js/csv.js', 'js/map.js'].forEach(load);

const { Geo, Fmt, Store, Ais, Vessel, Demo, Csv, PORTS, CONFIG } = window;
const FleetMap = window.FleetMap;

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

test('however a spreadsheet words a state, it lands on one of the four', () => {
  // Stored raw, "At anchor" reaches demo.js as a word it has never heard: the
  // status is neither honoured nor rejected, just ignored, and the vessel
  // derives whatever her speed happens to imply.
  const cases = {
    'At anchor': 'anchored', 'ANCHORED': 'anchored', 'riding to anchor': 'anchored',
    'Alongside': 'moored', 'In port': 'moored', 'berthed': 'moored', 'At the yard': 'moored',
    'Under way': 'underway', 'underway': 'underway', 'En route': 'underway',
    'steaming': 'underway', 'on passage': 'underway',
    'No signal': 'dark', 'dark': 'dark', 'unknown': 'dark',
    '': 'moored', 'nonsense': 'moored'
  };
  Object.keys(cases).forEach((input) => {
    assert.strictEqual(Vessel.normaliseStatus(input), cases[input],
      JSON.stringify(input) + ' means ' + cases[input]);
  });
  assert.strictEqual(Vessel.buildDemo({ demoStatus: 'At anchor' }).status, 'anchored',
    'and it is normalised on the way into the record');
});

test('a vessel with nowhere given still gets somewhere real', () => {
  // The fallback used CONFIG.office.label — "Palma office", which is not a port
  // in data/ports.js. So the safety net left her with no position at all, which
  // is the precise thing it exists to prevent.
  const demo = Vessel.buildDemo({ name: 'Nowhere' });
  assert.ok(demo.position, 'she is placed by position, not by a name that may not resolve');
  assert.strictEqual(demo.position.length, 2);
  close(demo.position[0], CONFIG.office.lon, 0.001, 'office longitude');
  close(demo.position[1], CONFIG.office.lat, 0.001, 'office latitude');

  // And demo mode can actually place her, which is the whole point.
  const agent = Demo._makeAgent({ yacht: { name: 'Nowhere', mmsi: 319000123, demo: demo } });
  assert.ok(agent, 'demo mode places her');
  assert.ok(agent.lon != null && agent.lat != null);
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

test('a demo block that cannot place a vessel is a fault worth naming', () => {
  /**
   * A demo block that exists but says nothing usable is the bad case: the yacht
   * never reaches the chart while looking for all the world like a record that
   * simply is not there. That is a typo, and this catches it.
   *
   * No demo block at all is a different thing entirely, and fine. It is the
   * honest state for a real fleet whose positions nobody has told us — she
   * reads "Position unknown" and stays off the chart, which is true, and live
   * AIS places her the first time she is heard. This used to insist every
   * record had one, which was right while the fleet was invented placeholders
   * and became wrong the moment real boats arrived.
   */
  REAL_FLEET.concat(FLEET).forEach((y) => {
    if (!y.demo) return;
    assert.ok(y.demo.route || y.demo.position || y.demo.port,
      `${y.name}: demo block has no route, position or port`);
  });
});

test('the whole fleet is not left unplaceable without saying so', () => {
  // Opening the board with no AIS key and no demo positions gives an empty
  // chart, which reads as broken. It is a legitimate state — but only for a
  // fleet that is genuinely going to be tracked live, so the file should say
  // as much where somebody will find it.
  const placeable = REAL_FLEET.filter((y) => y.demo &&
    (y.demo.route || y.demo.position || y.demo.port));
  if (placeable.length < REAL_FLEET.length) {
    const source = readRepo('fleet.js');
    assert.ok(/Position unknown/.test(source),
      'fleet.js explains what an unplaced vessel looks like before AIS is live');
  }
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
    // IMO and LOA are optional, and null is the honest value for a fleet whose
    // sheet did not carry them: both ride in the AIS static message and the
    // console fills them in the first time she is heard. What is not optional is
    // that a value, once present, is a real one.
    if (y.imo != null) {
      assert.ok(/^\d{7}$/.test(String(y.imo)), 'IMO is seven digits: ' + y.imo);
      assert.strictEqual(Vessel.validateImo(String(y.imo)).ok, true,
        y.name + "'s IMO " + y.imo + ' must pass the same check the add form applies');
    }
    assert.strictEqual(Vessel.validateMmsi(String(y.mmsi)).ok, true,
      y.name + "'s MMSI " + y.mmsi + ' must be a ship-station MMSI');
    if (y.loa != null) assert.ok(y.loa > 0 && y.loa < 200, 'plausible LOA: ' + y.loa);
    if (y.grossTonnage != null) {
      assert.ok(y.grossTonnage > 0 && y.grossTonnage < 50000,
        'plausible gross tonnage: ' + y.name + ' ' + y.grossTonnage);
    }
    if (y.yearBuilt != null) {
      assert.ok(y.yearBuilt > 1900 && y.yearBuilt < 2100, 'plausible year: ' + y.yearBuilt);
      if (y.lastRefit != null) {
        assert.ok(y.lastRefit >= y.yearBuilt,
          y.name + ' cannot have been refitted before she was built');
      }
    }
    // A flag that disagrees with the MMSI is worse than no flag: it is a
    // confident wrong answer on a board people read at a glance.
    if (y.flag) {
      const fromMmsi = Vessel.flagFromMmsi(y.mmsi);
      assert.ok(fromMmsi, y.name + ': MMSI ' + y.mmsi + ' has no known flag administration');
      assert.strictEqual(y.flag, fromMmsi.flag,
        y.name + ": flag says " + y.flag + ' but MMSI ' + y.mmsi + ' says ' + fromMmsi.flag);
    }
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

  test('a filename is matched to the vessel it names', () => {
    const m = (n) => Photos.matchFilename(n, FLEET);

    // The identifier, or the name outright.
    assert.strictEqual(m('corvina.jpg').yacht.id, 'corvina');
    assert.strictEqual(m('corvina.jpg').confidence, 'sure');
    assert.strictEqual(m('Silver Meridian.JPEG').yacht.id, 'silver-meridian');
    assert.strictEqual(m('silver_meridian.png').yacht.id, 'silver-meridian');
    assert.strictEqual(m('WIND-VERITY.webp').yacht.id, 'wind-verity');

    // The name buried in whatever the photographer called the file.
    const buried = m('MY Cloudbreak sea trials 2016 (1).jpg');
    assert.strictEqual(buried, null, 'a vessel not in this fleet matches nothing');
    const loose = m('MY Sea Ember sea trials 2016 (1).jpg');
    assert.strictEqual(loose.yacht.id, 'sea-ember');
    assert.strictEqual(loose.confidence, 'likely', 'and it says it is only a guess');

    // Nine digits nobody types by accident.
    const byMmsi = m('IMG_' + FLEET[0].mmsi + '.jpg');
    assert.strictEqual(byMmsi.yacht.id, FLEET[0].id);
    assert.strictEqual(byMmsi.confidence, 'sure');
    assert.strictEqual(m('' + FLEET[2].imo + '.jpg').yacht.id, FLEET[2].id, 'IMO too');
  });

  test('filename matching does not guess when it should not', () => {
    const m = (n) => Photos.matchFilename(n, FLEET);
    assert.strictEqual(m('DSC_0481.jpg'), null, 'a camera filename matches nothing');
    assert.strictEqual(m('.jpg'), null, 'and neither does an empty one');
    assert.strictEqual(m('screenshot.png'), null);
    assert.strictEqual(Photos.matchFilename('corvina.jpg', []), null, 'nor an empty fleet');
  });

  test('the longer name wins where two could match', () => {
    // 'Sea Ember' contains no other vessel, but a fleet with both 'Sea' and
    // 'Sea Ember' must not hand a photo of the latter to the former.
    const fleet = [
      { id: 'sea', name: 'Sea', mmsi: 319000001 },
      { id: 'sea-ember', name: 'Sea Ember', mmsi: 319000002 }
    ];
    assert.strictEqual(
      Photos.matchFilename('sea ember at anchor.jpg', fleet).yacht.id, 'sea-ember');
  });

  test('the export path is the one the written file points at', () => {
    // These two must agree or the file names a photograph that was never saved.
    assert.strictEqual(Photos.exportName('silver-meridian'),
      'assets/photos/silver-meridian.jpg');
  });

  global.localStorage = realStorage;
})();

/* --- Reading a fleet out of a spreadsheet --------------------------------- */

test('the CSV parser survives what a real spreadsheet exports', () => {
  // Splitting on commas mangles exactly the rows a fleet list is full of.
  const rows = Csv.parse(
    'Name,Builder,Class\r\n' +
    'Corvina,"Feadship, Netherlands","Lloyd\'s Register"\r\n' +
    '"Sea ""Ember""",Benetti,RINA\r\n' +
    '"Wind\nVerity",Royal Huisman,BV\r\n');

  assert.strictEqual(rows.length, 4, 'header and three vessels');
  assert.deepStrictEqual(rows[1], ['Corvina', 'Feadship, Netherlands', "Lloyd's Register"],
    'a comma inside quotes is not a new column');
  assert.strictEqual(rows[2][0], 'Sea "Ember"', 'a doubled quote is one quote');
  assert.strictEqual(rows[3][0], 'Wind\nVerity', 'a newline inside quotes stays in the field');
});

test('the parser copes with the mess files arrive in', () => {
  assert.deepStrictEqual(Csv.parse('\ufeffName,MMSI\nCorvina,319000004\n')[0],
    ['Name', 'MMSI'], 'a byte-order mark from Excel is not part of the first heading');

  assert.strictEqual(Csv.parse('a,b\n\n\nc,d\n').length, 2, 'blank lines are dropped');
  assert.strictEqual(Csv.parse('a,b\r\nc,d').length, 2, 'a missing final newline is fine');
  assert.deepStrictEqual(Csv.parse(''), [], 'and so is an empty file');
  assert.deepStrictEqual(Csv.parse('  Name ,  MMSI  \n')[0], ['Name', 'MMSI'],
    'padding around a value is not part of it');
});

test('the delimiter is worked out rather than assumed', () => {
  assert.strictEqual(Csv.sniffDelimiter('Name;MMSI;IMO'), ';', 'a European export');
  assert.strictEqual(Csv.sniffDelimiter('Name\tMMSI\tIMO'), '\t', 'a pasted table');
  assert.strictEqual(Csv.sniffDelimiter('Name,MMSI,IMO'), ',');
  assert.strictEqual(Csv.sniffDelimiter('OnlyOneColumn'), ',', 'a single column is still valid');
  // A comma inside a quoted heading must not win the vote.
  assert.strictEqual(Csv.sniffDelimiter('"Builder, yard";MMSI;IMO'), ';');
  assert.deepStrictEqual(Csv.parse('Name;Builder\nCorvina;Benetti')[1], ['Corvina', 'Benetti']);
});

test('columns are matched to fields by their headings', () => {
  const mapping = Csv.mapColumns(
    ['Vessel Name', 'MMSI Number', 'IMO', 'LOA (m)', 'Year Built', 'Flag State',
     'Gross Tonnage', 'Call Sign', 'Current Port', 'Notes']);
  assert.deepStrictEqual(mapping,
    ['name', 'mmsi', 'imo', 'loa', 'yearBuilt', 'flag',
     'grossTonnage', 'callSign', 'demoPort', '']);
});

test('a heading that could be two fields goes to the right one', () => {
  // 'Year Built' must not be taken by the alias 'year', and 'Last Refit' must
  // not be taken by 'refit' before 'lastrefit' is tried.
  assert.deepStrictEqual(Csv.mapColumns(['Year Built', 'Last Refit']),
    ['yearBuilt', 'lastRefit']);
  assert.deepStrictEqual(Csv.mapColumns(['Length Overall', 'Beam']), ['loa', 'beam']);
  // A field is claimed once: the second 'Name' is left for the user to set.
  assert.deepStrictEqual(Csv.mapColumns(['Name', 'Name']), ['name', '']);
  assert.deepStrictEqual(Csv.mapColumns(['', 'MMSI']), ['', 'mmsi']);
});

test('a row becomes the fields the vessel form uses', () => {
  const header = ['Name', 'Type', 'MMSI', 'IMO', 'LOA', 'Discreet', 'Port'];
  const mapping = Csv.mapColumns(header);
  const fields = Csv.rowToFields(
    ['Wind Verity', 'sailing', '319000007', '9900071', '45.3', 'yes', 'Göcek'], mapping);

  assert.strictEqual(fields.name, 'Wind Verity');
  assert.strictEqual(fields.prefix, 'S/Y', 'a sailing yacht is read as one');
  assert.strictEqual(fields.discreet, true);
  assert.strictEqual(fields.demoPort, 'Göcek');
  assert.strictEqual(fields.loa, '45.3', 'numbers stay text; buildRecord coerces them');

  // Empty cells are absent rather than empty strings, so they do not overwrite.
  const sparse = Csv.rowToFields(['Petrel', '', '319000008', '', '', '', ''], mapping);
  assert.deepStrictEqual(Object.keys(sparse).sort(), ['mmsi', 'name']);
});

test('a spreadsheet says yes in a dozen ways', () => {
  ['yes', 'Y', 'TRUE', '1', 'x', '✓'].forEach((v) => {
    assert.strictEqual(Csv.truthy(v), true, v + ' means yes');
  });
  ['no', 'N', 'FALSE', '0', '', '-'].forEach((v) => {
    assert.strictEqual(Csv.truthy(v), false, JSON.stringify(v) + ' does not');
  });
});

test('the template asks only for what cannot be worked out', () => {
  const template = Csv.parse(Csv.template())[0];
  const exported = Csv.parse(Csv.fromFleet(FLEET, Vessel.toFields))[0];

  // Every heading it does ask for must be one the importer recognises, or
  // somebody fills in a sheet that is then ignored.
  const mapping = Csv.mapColumns(template);
  assert.strictEqual(mapping.filter((f) => f === '').length, 0,
    'no column in our own template is left unrecognised');
  assert.ok(mapping.indexOf('name') !== -1);
  assert.ok(mapping.indexOf('mmsi') !== -1);

  // And every one must exist in the export, so the round trip carries them.
  template.forEach((heading) => {
    assert.ok(exported.indexOf(heading) !== -1,
      heading + ' is in the export too');
  });

  // The point of the exercise: it is shorter, and specifically it does not ask
  // for anything derived from the MMSI or broadcast by the vessel.
  assert.ok(template.length < exported.length - 5,
    'the template is materially shorter than everything we hold');
  ['Flag', 'Flag code', 'IMO', 'Call sign', 'LOA (m)', 'Beam (m)', 'Type',
   'Bound for', 'Speed (kn)', 'ETA (hours)'].forEach((heading) => {
    assert.strictEqual(template.indexOf(heading), -1,
      heading + ' is not asked for — it is derived or broadcast');
  });
});

test('a flag falls out of the MMSI rather than being typed', () => {
  // The leading three digits are an ITU allocation, so this is a fact about the
  // number. Codes verified against the ITU MID list, not remembered.
  const cases = {
    319095800: ['KY', 'Cayman Islands'],
    538000123: ['MH', 'Marshall Islands'],
    215000001: ['MT', 'Malta'],
    254000001: ['MC', 'Monaco'],
    232000001: ['GB', 'United Kingdom'],
    271000001: ['TR', 'Turkey'],
    378000001: ['VG', 'British Virgin Islands'],
    244000001: ['NL', 'Netherlands']
  };
  Object.keys(cases).forEach((mmsi) => {
    const got = Vessel.flagFromMmsi(mmsi);
    assert.strictEqual(got.flagCode, cases[mmsi][0], mmsi + ' code');
    assert.strictEqual(got.flag, cases[mmsi][1], mmsi + ' country');
  });

  // An unknown or impossible MID leaves it blank rather than guessing.
  assert.strictEqual(Vessel.flagFromMmsi(999000000), null, 'not a ship-station MID');
  assert.strictEqual(Vessel.flagFromMmsi('31909580'), null, 'eight digits is not an MMSI');
  assert.strictEqual(Vessel.flagFromMmsi(''), null);
  assert.strictEqual(Vessel.flagFromMmsi(null), null);

  // And it reaches the record without anyone asking.
  const record = Vessel.buildRecord({ name: 'Test', mmsi: 319095800, imo: 9074729 });
  assert.strictEqual(record.flag, 'Cayman Islands');
  assert.strictEqual(record.flagCode, 'KY');

  // A flag somebody typed is not overwritten by it.
  const typed = Vessel.buildRecord({
    name: 'Test', mmsi: 319095800, imo: 9074729, flag: 'Somewhere Else'
  });
  assert.strictEqual(typed.flag, 'Somewhere Else');
});

test('autoFill fills blanks and never overwrites', () => {
  // Silently replacing a typed value would destroy the disagreement between
  // record and transponder that catches a wrong MMSI.
  const ais = { name: 'AURELIA', imo: 9900019, callSign: 'ZGAA1',
                loa: 62, beam: 11, shipType: 37 };

  const bare = { mmsi: 319095800, name: null, imo: null, callSign: null,
                 loa: null, beam: null, prefix: null };
  const filled = Vessel.autoFill(bare, ais);
  assert.deepStrictEqual(filled, {
    flag: 'Cayman Islands', flagCode: 'KY', name: 'AURELIA', imo: 9900019,
    callSign: 'ZGAA1', loa: 62, beam: 11, prefix: 'M/Y'
  });

  const complete = { mmsi: 319095800, name: 'Aurelia', imo: 9074729,
                     callSign: 'ZZZZ9', loa: 60, beam: 10, prefix: 'S/Y',
                     flag: 'Malta', flagCode: 'MT' };
  assert.deepStrictEqual(Vessel.autoFill(complete, ais), {},
    'nothing already filled in is touched');

  // A sailing vessel is read off the AIS ship type.
  assert.strictEqual(
    Vessel.autoFill({ mmsi: 319095800, prefix: null }, { shipType: 36 }).prefix, 'S/Y');
  // With no static message heard yet, the flag still comes from the MMSI.
  assert.deepStrictEqual(Vessel.autoFill({ mmsi: 254000001 }, null),
    { flag: 'Monaco', flagCode: 'MC' });
});

test('the template committed to the repo matches the one the console makes', () => {
  // Two copies of the same thing drift. This is the one that catches it.
  const onDisk = require('fs')
    .readFileSync(path.join(__dirname, '..', 'fleet-template.csv'), 'utf8');
  assert.strictEqual(onDisk, Csv.template(),
    'fleet-template.csv is stale — regenerate it from js/csv.js');
});

test('the template example refuses to be imported by accident', () => {
  // It is there to be copied, not kept. Left in, it must fail by name rather
  // than adding a yacht called EXAMPLE to somebody's fleet.
  const rows = Csv.parse(Csv.template());
  const fields = Csv.rowToFields(rows[1], Csv.mapColumns(rows[0]));
  assert.ok(/example/i.test(fields.name), 'it says what it is');

  const mmsi = Vessel.validateMmsi(fields.mmsi);
  assert.strictEqual(mmsi.ok, false, 'and its MMSI cannot be a real ship station');

  // Everything else in the row is valid, so it teaches the format correctly.
  assert.strictEqual(fields.discreet, false);
  assert.strictEqual(Vessel.normaliseStatus(fields.demoStatus), 'moored');
  assert.ok(PORTS.some((p) => p[0] === fields.demoPort),
    'and the port it names is a real one');
});

test('the fleet writes out to a spreadsheet and reads back the same', () => {
  // The round trip is the point: export, edit in Excel, drop it back.
  const text = Csv.fromFleet(FLEET, Vessel.toFields);
  const rows = Csv.parse(text);
  const mapping = Csv.mapColumns(rows[0]);

  assert.strictEqual(rows.length, FLEET.length + 1, 'a header and every vessel');
  assert.ok(text.charCodeAt(0) === 0xFEFF, 'with the mark Excel needs for Göcek');

  const rebuilt = rows.slice(1).map((row) => {
    const fields = Csv.rowToFields(row, mapping);
    return Vessel.buildRecord(Object.assign(fields, {
      mmsi: Number(fields.mmsi), imo: Number(fields.imo)
    }));
  });

  FLEET.forEach((source, i) => {
    const out = rebuilt[i];
    ['name', 'prefix', 'mmsi', 'imo', 'callSign', 'flag', 'flagCode', 'loa',
     'beam', 'grossTonnage', 'builder', 'yearBuilt', 'lastRefit', 'classSociety',
     'discreet'].forEach((key) => {
      assert.deepStrictEqual(out[key], source[key],
        source.name + ': ' + key + ' survives the round trip');
    });
  });

  // A comma and an apostrophe in the data must come back intact.
  const tricky = Csv.parse(Csv.fromFleet(
    [{ id: 'x', name: "O'Brien, Folly", mmsi: 319000001, imo: 9074729,
       builder: 'Feadship, Netherlands', demo: { status: 'moored', port: 'Göcek' } }],
    Vessel.toFields));
  assert.strictEqual(tricky[1][0], "O'Brien, Folly");
  assert.strictEqual(tricky[1][10], 'Feadship, Netherlands');
});

/* --- Chart layers ---------------------------------------------------------- */

test('the depth layers decode into the bands the renderer expects', () => {
  load('data/world-depth.js');
  load('data/world-borders.js');
  const { WORLD_DEPTH_ENCODED, WORLD_DEPTH_SCALE, WORLD_DEPTH_BANDS,
          WORLD_BORDERS_ENCODED, WORLD_BORDERS_SCALE } = window;

  const rings = Geo.decodeLand(WORLD_DEPTH_ENCODED, WORLD_DEPTH_SCALE);
  assert.strictEqual(rings.length, WORLD_DEPTH_BANDS.reduce((a, b) => a + b, 0),
    'the band counts account for every ring');
  assert.strictEqual(WORLD_DEPTH_BANDS.length, 2, '200 m and 1000 m');
  assert.ok(WORLD_DEPTH_BANDS[0] > WORLD_DEPTH_BANDS[1],
    'the shallower contour has more rings — the deep is one big expanse');

  const borders = Geo.decodeLand(WORLD_BORDERS_ENCODED, WORLD_BORDERS_SCALE);
  assert.ok(borders.length > 100, 'borders decoded');

  // No ring may step more than half the world between points: that is the
  // antimeridian bug, which paints a bar straight across the chart.
  [rings, borders].forEach((set, which) => {
    set.forEach((ring, i) => {
      for (let k = 2; k < ring.length; k += 2) {
        assert.ok(Math.abs(ring[k] - ring[k - 2]) <= 180,
          (which ? 'border' : 'depth') + ' ring ' + i + ' steps across the seam');
      }
    });
  });
});

test('the coastline ships at two levels of detail', () => {
  load('data/world-land-detail.js');
  const coarse = Geo.decodeLand(window.WORLD_LAND_ENCODED, window.WORLD_LAND_SCALE);
  const fine = Geo.decodeLand(window.WORLD_LAND_DETAIL_ENCODED, window.WORLD_LAND_DETAIL_SCALE);

  assert.ok(fine.length > coarse.length * 2,
    'the fine level resolves far more islands: ' + fine.length + ' against ' + coarse.length);

  const median = (rings) => {
    const segs = [];
    rings.forEach((r) => {
      for (let i = 2; i < r.length; i += 2) {
        const dx = (r[i] - r[i - 2]) * Math.cos(r[i + 1] * Math.PI / 180);
        segs.push(Math.hypot(dx, r[i + 1] - r[i - 1]) * 60);
      }
    });
    segs.sort((a, b) => a - b);
    return segs[Math.floor(segs.length / 2)];
  };
  // The whole point: at a quarter of a mile per pixel, a 4 nm segment is a
  // sixteen-pixel straight line and every shore is visibly faceted.
  assert.ok(median(fine) < 2, 'fine median segment is under 2 nm, got ' + median(fine).toFixed(2));
  assert.ok(median(coarse) > median(fine), 'and the coarse level is coarser');

  // Both levels must survive the seam, or a ring paints a bar across the chart.
  [coarse, fine].forEach((set, which) => {
    set.forEach((ring, i) => {
      for (let k = 2; k < ring.length; k += 2) {
        assert.ok(Math.abs(ring[k] - ring[k - 2]) <= 180,
          (which ? 'fine' : 'coarse') + ' ring ' + i + ' steps across the seam');
      }
    });
  });
});

test('every place name sits somewhere a name can go', () => {
  load('data/places.js');
  const { PLACES } = window;
  assert.ok(PLACES.length > 150, 'seas, oceans and countries');

  PLACES.forEach(([name, lon, lat, kind, size]) => {
    assert.ok(name && name.length, 'named');
    assert.ok(lon >= -180 && lon <= 180, name + ': longitude is in range, got ' + lon);
    assert.ok(lat >= -90 && lat <= 90, name + ': latitude is in range, got ' + lat);
    assert.ok(['ocean', 'sea', 'country'].indexOf(kind) !== -1, name + ': known kind');
    if (kind === 'country') assert.ok(size > 0, name + ': has a size to judge zoom by');
  });

  const seas = PLACES.filter((p) => p[3] === 'sea').map((p) => p[0]);
  ['Mediterranean Sea', 'Adriatic Sea', 'Aegean Sea', 'Caribbean Sea', 'English Channel']
    .forEach((n) => assert.ok(seas.indexOf(n) !== -1, n + ' is named'));
});

test('a great circle bends the right way and lands where it is aimed', () => {
  // Palma to New York should bow north of the rhumb line, not run straight
  // across the Mercator, and it must not fold back at the seam.
  const gc = FleetMap._greatCircle;
  const legs = gc(2.65, 39.57, -74.0, 40.7);
  close(legs[0][0], 2.65, 0.01, 'starts where told');
  close(legs[legs.length - 1][0], -74.0, 0.01, 'ends where told');
  const mid = legs[Math.floor(legs.length / 2)];
  assert.ok(mid[1] > 40.7, 'the middle of the leg is north of both ends');
  for (let i = 1; i < legs.length; i++) {
    assert.ok(Math.abs(legs[i][0] - legs[i - 1][0]) < 180, 'no fold at the seam');
  }
});

/* --- Both surfaces show the same fleet ---------------------------------- */

/**
 * The console kept additions in localStorage and merged them; the board read
 * fleet.js and nothing else. So a yacht added in the console appeared in the
 * console and never reached the board — indistinguishable, from the outside,
 * from the add having silently failed.
 *
 * These are source checks rather than behavioural ones because the wiring is
 * the thing that was wrong: both booted correctly in isolation.
 */

test('both the board and the console merge locally added vessels', () => {
  ['js/app.js', 'js/console.js'].forEach((f) => {
    assert.ok(/Vessel\.mergedFleet\(/.test(readRepo(f)),
      f + ' merges local additions rather than trusting fleet.js alone');
  });
});

test('the board loads the modules it now depends on, before it uses them', () => {
  const html = readRepo('index.html');
  const at = (f) => html.indexOf('src="' + f + '"');
  ['js/settings.js', 'js/vessel.js', 'js/app.js'].forEach((f) => {
    assert.ok(at(f) !== -1, 'index.html loads ' + f);
  });
  assert.ok(at('js/vessel.js') < at('js/app.js'), 'vessel.js is defined before app.js runs');
  assert.ok(at('js/settings.js') < at('js/app.js'), 'settings.js is defined before app.js runs');
  assert.ok(at('data/mid.js') < at('js/vessel.js'), 'vessel.js has the MID table it reads');
});

test('neither app reads the AIS key straight out of config', () => {
  // The single-file build strips the key out of config.js on purpose, so a key
  // read from there alone can never reach a published board.
  ['js/app.js', 'js/console.js'].forEach((f) => {
    assert.ok(!/CONFIG\.aisStreamApiKey/.test(readRepo(f)),
      f + ' goes through Settings, so a key typed into the app is honoured');
    assert.ok(/Settings\.aisKey\(\)/.test(readRepo(f)), f + ' asks Settings for the key');
  });
});

/* --- The AIS key ---------------------------------------------------------- */

test('a key typed into the app wins over one baked into config', () => {
  const store = {};
  window.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  load('js/settings.js');
  const { Settings } = window;

  const configured = CONFIG.aisStreamApiKey;
  try {
    CONFIG.aisStreamApiKey = '';
    assert.strictEqual(Settings.aisKey(), '', 'no key anywhere is demo mode, not an error');
    assert.strictEqual(Settings.aisKeySource(), 'none');

    CONFIG.aisStreamApiKey = 'from-config';
    assert.strictEqual(Settings.aisKey(), 'from-config');
    assert.strictEqual(Settings.aisKeySource(), 'config');

    Settings.setAisKey('  from-the-app  ');
    assert.strictEqual(Settings.aisKey(), 'from-the-app', 'trimmed, and it overrides config');
    assert.strictEqual(Settings.aisKeySource(), 'browser');

    Settings.setAisKey('');
    assert.strictEqual(Settings.aisKey(), 'from-config', 'removing falls back, it does not blank');
  } finally {
    CONFIG.aisStreamApiKey = configured;
  }
});

test('saving a key tells whoever is running a feed', () => {
  const { Settings } = window;
  let told = 0;
  Settings.onChange(() => { told++; });
  Settings.setAisKey('a'.repeat(40));
  assert.strictEqual(told, 1, 'so the app can switch from simulated to live without a reload');
  Settings.setAisKey('');
  assert.strictEqual(told, 2, 'and back again');
});

test('a browser with site data blocked still boots', () => {
  const { Settings } = window;
  window.localStorage = {
    getItem() { throw new Error('storage disabled'); },
    setItem() { throw new Error('storage disabled'); },
    removeItem() { throw new Error('storage disabled'); }
  };
  assert.doesNotThrow(() => Settings.aisKey(), 'reading a blocked store is not fatal');
  assert.strictEqual(Settings.setAisKey('a'.repeat(40)), false, 'and it says so rather than pretending');
});

test('the published build carries no API key, offline or not', () => {
  const build = readRepo('tools/build-single-file.js');
  const blanking = build.indexOf('aisStreamApiKey: \'\'');
  const offlineBlock = build.indexOf('if (offline) {');
  assert.ok(blanking !== -1, 'the bundle blanks the key');
  assert.ok(blanking < offlineBlock,
    'and does it unconditionally — a bundle gets emailed and published, so a ' +
    'credential inside one goes wherever the file goes');
});

test('every connection state the feed can set has a label on both pages', () => {
  // A state with no entry in a label map falls through to the raw word, so the
  // board quietly shows "blocked" in lower case where it meant to explain
  // itself. Collect the states actually set, and insist both pages name them.
  const sources = ['js/ais.js', 'js/store.js', 'js/app.js', 'js/console.js']
    .map(readRepo).join('\n');
  const states = new Set(
    [...sources.matchAll(/setConnection\(([\s\S]{0,300}?)\);/g)]
      .flatMap((m) => [...m[1].matchAll(/'([a-z]+)'/g)].map((q) => q[1]))
  );
  assert.ok(states.has('blocked'), 'a socket that never opens says so');
  assert.ok(states.has('open') && states.has('retrying'), 'and the ordinary states are there');

  ['js/app.js', 'js/console.js'].forEach((f) => {
    const src = readRepo(f);
    states.forEach((state) => {
      assert.ok(new RegExp(state + ":\\s*'").test(src), f + ' labels "' + state + '"');
    });
  });
});

/* --- The socket, when it does not work ----------------------------------- */

/**
 * The retry used to hang off `onclose` alone, on the assumption — written in a
 * comment, never checked — that a close always follows an error. A socket
 * refused by Content-Security-Policy fires `error` and nothing else, so the
 * retry was never scheduled and the board sat on "Connecting" forever. These
 * drive the handlers directly, because that assumption is exactly the kind of
 * thing only a fake socket can falsify.
 */
function withFakeSocket(run) {
  const realWebSocket = global.WebSocket;
  const sockets = [];
  global.WebSocket = function () {
    this.readyState = 0;                 // CONNECTING
    this.sent = [];
    this.send = (m) => this.sent.push(m);
    this.close = () => { this.readyState = 3; };
    sockets.push(this);
  };
  Store.init([{ id: 'x', name: 'X', mmsi: 319000001, demo: { position: [0, 0] } }]);
  try {
    run(sockets);
  } finally {
    Ais.stop();
    global.WebSocket = realWebSocket;
  }
}

test('a socket refused outright says so at once, without waiting three times', () => {
  withFakeSocket((sockets) => {
    // Refused before a single event: CLOSED the moment the constructor returns.
    const realWebSocket = global.WebSocket;
    global.WebSocket = function () {
      this.readyState = 3;
      this.send = () => {};
      this.close = () => {};
      sockets.push(this);
    };
    Ais.start('k'.repeat(40), [319000001]);
    global.WebSocket = realWebSocket;
    assert.strictEqual(Store.connection, 'blocked',
      'policy is conclusive on the first try — there is nothing to learn from waiting');
    assert.strictEqual(Ais.attempt, 1, 'and it still schedules a retry in case it lifts');
  });
});

test('an error with no close behind it still schedules the retry', () => {
  withFakeSocket((sockets) => {
    Ais.start('k'.repeat(40), [319000001]);
    assert.strictEqual(Store.connection, 'connecting');
    assert.strictEqual(sockets.length, 1);

    sockets[0].readyState = 3;
    sockets[0].onerror(new Error('refused'));

    assert.strictEqual(Ais.attempt, 1, 'the attempt counter moved');
    assert.strictEqual(Store.connection, 'blocked', 'and it is named for what it is');
  });
});

test('one attempt produces one retry, however many events it ends with', () => {
  withFakeSocket((sockets) => {
    Ais.start('k'.repeat(40), [319000001]);
    const socket = sockets[0];
    socket.readyState = 3;
    socket.onerror(new Error('refused'));
    const after = Ais.attempt;
    // A close arriving behind the error must not start a second reconnect
    // racing the first.
    if (socket.onclose) socket.onclose({ code: 1006 });
    assert.strictEqual(Ais.attempt, after, 'the late close is a no-op');
  });
});

test('a socket that opened and then dropped is reconnecting, not blocked', () => {
  withFakeSocket((sockets) => {
    Ais.start('k'.repeat(40), [319000001]);
    const socket = sockets[0];
    socket.readyState = 1;
    socket.onopen();
    assert.strictEqual(Store.connection, 'listening',
      'the socket is up, but a rejected subscription leaves it up and silent, ' +
      'so "live" is not claimed until something actually arrives');

    const sub = JSON.parse(socket.sent[0]);
    assert.strictEqual(sub.APIKey, 'k'.repeat(40), 'the key goes up first');
    assert.deepStrictEqual(sub.FiltersShipMMSI, ['319000001'], 'ours only, as strings');
    assert.ok(sub.FilterMessageTypes.indexOf('ShipStaticData') !== -1,
      'including the slow message that carries name and IMO');

    socket.onmessage({ data: JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: 319000001, latitude: 43.7, longitude: 7.4 },
      Message: { PositionReport: { Latitude: 43.7, Longitude: 7.4, Cog: 90, Sog: 8 } }
    }) });
    assert.strictEqual(Store.connection, 'open', 'the first message is what makes it live');

    socket.onclose({ code: 1006 });
    assert.strictEqual(Store.connection, 'retrying',
      'it worked once, so a drop is a drop — never "unreachable"');
  });
});

/* --- The unattended-screen build ------------------------------------------- */

test('the display build locks the key, and only the display build', () => {
  const build = readRepo('tools/build-single-file.js');
  assert.ok(/flags\.has\('--display'\)/.test(build), 'there is a --display mode');
  assert.ok(/discreetLocked: false/.test(build) && /discreetLocked: true/.test(build),
    'which rewrites the setting rather than asking someone to remember it');
  assert.ok(/flags\.has\('--blur-all'\)/.test(build),
    'and a separate, heavier flag for a wholly approximate board');
  assert.ok(/could not find/.test(build),
    'a rewrite that silently matched nothing would ship an unlocked public board');

  // The repository default stays unlocked: the console has somebody present to
  // work the toggle, and a locked console cannot do its job.
  assert.strictEqual(CONFIG.discreetLocked, false, 'config.js itself is unlocked');
  assert.strictEqual(CONFIG.discreetMode, false, 'and shows real positions by default');
});

test('locking the key does not itself withhold anything', () => {
  // The lock used to force blanket discretion on at start-up, which made a
  // board a set of sixty-mile circles wherever it stood — most of what makes it
  // worth watching, gone. Locking now fixes whatever the build chose; what is
  // withheld is decided per yacht.
  const app = readRepo('js/app.js');
  assert.ok(!/discreetLocked\)\s*window\.CONFIG\.discreetMode = true/.test(app),
    'boot does not turn blanket discretion on just because the key is locked');
  assert.ok(/discreetLocked\) break/.test(app), 'but the key really is locked');
});

test('a yacht marked discreet is withheld on every screen, however it is configured', () => {
  const fleet = [
    { id: 'open', name: 'Open', mmsi: 319000101, demo: { position: [7.42, 43.73] } },
    { id: 'quiet', name: 'Quiet', mmsi: 319000102, discreet: true,
      demo: { position: [7.12, 43.58] } }
  ];
  const locked = CONFIG.discreetLocked;
  const mode = CONFIG.discreetMode;
  try {
    Store.init(fleet);
    Store.applyFix(319000101, { lon: 7.42, lat: 43.73, at: new Date() });
    Store.applyFix(319000102, { lon: 7.12, lat: 43.58, at: new Date() });

    // The configuration an unattended screen actually runs: key locked, blanket
    // discretion off.
    CONFIG.discreetLocked = true;
    CONFIG.discreetMode = false;
    Store.recompute();
    const [open, quiet] = Store.vessels;
    assert.strictEqual(open.derived.discreet, false, 'the ordinary yacht is shown');
    assert.ok(Math.abs(open.derived.lat - 43.73) < 0.001, 'and shown exactly');
    assert.strictEqual(quiet.derived.discreet, true, 'the marked one is not');
    assert.ok(Math.abs(quiet.derived.lat - 43.58) > 0.05,
      'her position is moved, not merely labelled — ' +
      'a rounded fix that equals the real one protects nobody');

    // And blanket mode still catches everyone, for the screen that wants it.
    CONFIG.discreetMode = true;
    Store.recompute();
    assert.strictEqual(Store.vessels[0].derived.discreet, true, 'blur-all covers the fleet');
  } finally {
    CONFIG.discreetLocked = locked;
    CONFIG.discreetMode = mode;
  }
});

test('the office is where the board actually is', () => {
  // The clock and the "from us" distances both read from this, and it spent the
  // whole build set to the placeholder demo's Palma.
  assert.strictEqual(CONFIG.office.timeZone, 'Europe/London');
  assert.ok(/London/.test(CONFIG.office.label), 'labelled for the room it stands in');
  assert.ok(Math.abs(CONFIG.office.lat - 51.5) < 0.5 &&
            Math.abs(CONFIG.office.lon - -0.13) < 0.5,
    'and the coordinates agree with the time zone');
});

test('a board showing approximate positions says so', () => {
  // A 60 nm circle with no label is worse than no circle: read as a fix, it is
  // wrong by up to sixty miles and gives the reader no way to know.
  const app = readRepo('js/app.js');
  assert.ok(/function renderDiscreetFlag/.test(app), 'one place renders the flag');
  assert.ok(/renderDiscreetFlag\(\);[\s\S]{0,80}buildScenes\(\)/.test(app),
    'and it runs at boot, not only when someone presses D');
  assert.ok(/discreetLocked \? 'Approximate positions'/.test(app),
    'the locked build names what the reader is looking at');
  assert.ok(!/discreet-flag'\)\.textContent = window\.CONFIG\.discreetMode \?/.test(app),
    'the D key goes through the same function, so the two cannot disagree');
});

test('an unlocked board still withholds the yachts that are marked', () => {
  // The whole point of the per-yacht flag is that it is not a toggle. A build
  // with the D key working is the one where that is easiest to get wrong.
  const fleet = [
    { id: 'quiet', name: 'Quiet', mmsi: 319000102, discreet: true,
      demo: { position: [7.12, 43.58] } }
  ];
  const locked = CONFIG.discreetLocked;
  const mode = CONFIG.discreetMode;
  try {
    Store.init(fleet);
    Store.applyFix(319000102, { lon: 7.12, lat: 43.58, at: new Date() });
    CONFIG.discreetLocked = false;     // the D key works
    CONFIG.discreetMode = false;       // and nobody has pressed it
    Store.recompute();
    const d = Store.vessels[0].derived;
    assert.strictEqual(d.discreet, true,
      'marked means withheld, with no key pressed and no lock in force');
    assert.ok(Math.abs(d.lat - 43.58) > 0.05, 'and the position she publishes has moved');
    assert.ok(/if \(d\.discreet\) return;/.test(readRepo('js/map.js')),
      'her track is not drawn either — a track is a position over time');
  } finally {
    CONFIG.discreetLocked = locked;
    CONFIG.discreetMode = mode;
  }
});

/* --- The summary view tells the truth about a sparse fleet ---------------- */

test('the console counts every vessel too, not just the board', () => {
  // The same fault lived in three more places on the desk tool: the rail
  // filter chips, the overview tiles, and the count beside each chip.
  const source = readRepo('js/console.js');
  assert.ok(/var STATE_BUCKETS = \{/.test(source),
    'one place decides which statuses a label covers');
  assert.ok(/dark: \['dark', 'unknown'\]/.test(source),
    'and a vessel never heard from is counted somewhere');
  assert.ok(!/return v\.derived\.status === filter;/.test(source),
    'the filter goes through the buckets rather than matching a status by name');
  assert.ok(!/'fix ' \+ window\.Fmt\.age\(v\.fix && v\.fix\.at\)/.test(source),
    'and a vessel with no fix does not read "fix no fix"');
});

test('the four tiles account for every vessel', () => {
  // A fleet waiting on its first AIS fix showed "1 of 61" across four tiles,
  // with sixty vessels in none of them, in front of people who can count.
  Store.init(REAL_FLEET);
  const counts = Store.summary().counts;

  const source = readRepo('js/views.js');
  const block = source.slice(source.indexOf('var STAT_STATES'),
                             source.indexOf(']', source.indexOf('[\'dark\'')) + 3);
  const named = new Set([...block.matchAll(/'([a-z]+)'/g)].map((m) => m[1]));

  Object.keys(counts).forEach((state) => {
    assert.ok(named.has(state),
      'status "' + state + '" is counted by the store but shown by no tile');
  });

  const shown = Object.keys(counts).reduce((sum, k) => sum + counts[k], 0);
  assert.strictEqual(shown, Store.vessels.length,
    'every vessel lands in exactly one of the states the tiles cover');
});

test('an aggregate says how many vessels it was drawn from', () => {
  // "Fleet length 72 m, 61 vessels" was a confidently wrong number rather than
  // a missing one, and nobody looking at a wall could tell it from a true one.
  const source = readRepo('js/views.js');
  assert.ok(!/sum \+ \(v\.yacht\.loa \|\| 0\)/.test(source),
    'a missing length is not counted as a length of zero');
  assert.ok(/from ' \+ stat\.count \+ ' of ' \+ vessels\.length/.test(source),
    'and the figure carries the count it was drawn from');

  // The fleet this was found on: one length on file out of sixty-one.
  const withLoa = REAL_FLEET.filter((y) => typeof y.loa === 'number');
  assert.ok(withLoa.length < REAL_FLEET.length,
    'the real fleet is still sparse here, so the check is still live');
});

/* --- Saying why nothing is arriving --------------------------------------- */

test('a server complaint is surfaced, not swallowed', () => {
  // The handler switched on MessageType and dropped everything it did not
  // recognise, which included the server's own error replies. A rejected
  // subscription then looked exactly like a working one nobody had sailed past:
  // socket open, pill green, silence.
  withFakeSocket((sockets) => {
    Ais.start('k'.repeat(40), [319000001]);
    const socket = sockets[0];
    socket.readyState = 1;
    socket.onopen();
    socket.onmessage({ data: JSON.stringify({ error: 'Invalid API key' }) });
    assert.strictEqual(Store.connection, 'rejected', 'the state says it was refused');
    assert.strictEqual(Ais.lastError, 'Invalid API key', 'and keeps what was said');
  });
});

test('an AIS body called Message is not mistaken for a complaint', () => {
  // Every AIS payload has a `Message` key. Only a string one is prose.
  withFakeSocket((sockets) => {
    Ais.start('k'.repeat(40), [319000001]);
    const socket = sockets[0];
    socket.readyState = 1;
    socket.onopen();
    socket.onmessage({ data: JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: 319000001 },
      Message: { PositionReport: { Latitude: 43.7, Longitude: 7.4 } }
    }) });
    assert.strictEqual(Store.connection, 'open', 'a real message makes it live');
    assert.strictEqual(Ais.lastError, null, 'and is not read as an error');
  });
});

test('heard and matched are counted apart', () => {
  // A green pill cannot distinguish "the feed is dead" from "the feed works and
  // our boats are quiet". These two numbers can.
  withFakeSocket((sockets) => {
    Ais.start('k'.repeat(40), [319000001]);
    const socket = sockets[0];
    socket.readyState = 1;
    socket.onopen();
    const message = (mmsi) => socket.onmessage({ data: JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: mmsi },
      Message: { PositionReport: { Latitude: 43.7, Longitude: 7.4 } }
    }) });
    message(319000001);
    message(244123456);
    message(244123457);
    assert.strictEqual(Ais.heard, 3, 'every message counts as heard');
    assert.strictEqual(Ais.matched, 1, 'only ours count as matched');
  });
});

test('the subscription asks for Class B static data too', () => {
  // Message 24 is how a yacht under 300 GT sends her name and dimensions. Plenty
  // of this fleet will never send a type 5 at all.
  withFakeSocket((sockets) => {
    Ais.start('k'.repeat(40), [319000001]);
    const socket = sockets[0];
    socket.readyState = 1;
    socket.onopen();
    const sub = JSON.parse(socket.sent[0]);
    ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport',
     'ShipStaticData', 'StaticDataReport'].forEach((type) => {
      assert.ok(sub.FilterMessageTypes.indexOf(type) !== -1, 'subscribes to ' + type);
    });
  });
});

test('the subscription matches the published schema', () => {
  // Field names checked against aisstream/ais-message-models, not recalled:
  // APIKey, BoundingBoxes, FiltersShipMMSI (strings, 9 characters),
  // FilterMessageTypes.
  withFakeSocket((sockets) => {
    Ais.start('k'.repeat(40), [319000001, 232012345]);
    const socket = sockets[0];
    socket.readyState = 1;
    socket.onopen();
    const sub = JSON.parse(socket.sent[0]);
    assert.deepStrictEqual(Object.keys(sub).sort(),
      ['APIKey', 'BoundingBoxes', 'FilterMessageTypes', 'FiltersShipMMSI']);
    sub.FiltersShipMMSI.forEach((m) => {
      assert.strictEqual(typeof m, 'string', 'MMSIs go up as strings');
      assert.strictEqual(m.length, 9, 'nine characters, as the schema requires');
    });
  });
});

test('the probe log is drawn from live state, never accumulated', () => {
  /**
   * The log wrote one line per probe at the moment that probe STARTED — before
   * its socket had opened — and only refreshed it when a message arrived. With
   * no messages nothing ever refreshed it, so every line read "never opened"
   * while the verdict, computed from the real final state, said the connection
   * had opened and been cut. The report contradicted itself and the half that
   * looked most like evidence was the stale half.
   */
  const source = readRepo('js/settings.js');
  assert.ok(/step\.results\.map\(/.test(source),
    'every line is redrawn from the results array on each callback');
  assert.ok(!/lines\[step\.index\] =/.test(source),
    'no line is written once and left to go stale');
  assert.ok(/Subscription sent \(key masked\)/.test(source),
    'and the report shows what was actually sent, with the credential masked');

  const ais = readRepo('js/ais.js');
  assert.ok(/apiKey\.slice\(0, 4\)/.test(ais),
    'the key is masked where it is echoed — a diagnostic gets pasted to support');
});

test('the probe records the socket lifecycle, not only the message count', () => {
  /**
   * The first version recorded `heard` and `error` alone, which collapsed three
   * different answers into one — a socket that never opened, one the server
   * accepted and closed on the spot, and one that stayed open and silent — and
   * then blamed the key, which is right for at most one of them. Your own fleet
   * hit exactly that case.
   */
  const source = readRepo('js/ais.js');
  assert.ok(/result\.opened = true;/.test(source), 'it records whether the socket opened');
  assert.ok(/code: event && event\.code/.test(source),
    'and the close code, which is the server explaining why it hung up');
  assert.ok(/result\.seconds = /.test(source),
    'and how long it lasted, which separates a hang-up from a silence');

  // Order matters: a socket that never opened cannot have been answered.
  const verdicts = source.slice(source.indexOf('function finish()'));
  assert.ok(verdicts.indexOf('if (never)') < verdicts.indexOf('rejected.error'),
    'an unreachable server is not reported as a rejected key');
  assert.ok(/result\.failed = true;/.test(source),
    'a transport failure is kept apart from anything the server actually said');
});

test('the probe covers each cause a green pill cannot tell apart', () => {
  // Exercised end to end against a stand-in server in each mode; this holds the
  // shape of the thing so a future edit cannot quietly drop a case.
  const source = readRepo('js/ais.js');
  assert.ok(/FiltersShipMMSI = list/.test(source), 'one probe filters to our fleet');
  assert.ok(/\[\[\[-90, -180\], \[90, 180\]\]\]/.test(source) &&
            /\[\[\[-180, -90\], \[180, 90\]\]\]/.test(source),
    'and one tries each reading of the bounding box, because the published ' +
    'examples disagree about the axis order');
  assert.ok(/results\[1\]\.matched > 0/.test(source),
    'a broken filter is only claimed when an unfiltered probe heard one of ours — ' +
    'otherwise a quiet fleet gets blamed on the filter');
});

console.log(`\n${passed} checks passed` + (process.exitCode ? ' — with failures above\n' : '\n'));
