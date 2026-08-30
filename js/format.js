/* -----------------------------------------------------------------------------
 * format.js — turning numbers into things a person reads from across a room.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Fmt = {};
  var U = function () { return window.CONFIG.units; };

  /* --- Units ------------------------------------------------------------- */

  Fmt.distance = function (nm) {
    if (nm == null || !isFinite(nm)) return '—';
    if (U().distance === 'km') {
      var km = nm * 1.852;
      return (km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString()) + ' km';
    }
    return (nm < 10 ? nm.toFixed(1) : Math.round(nm).toLocaleString()) + ' nm';
  };

  Fmt.speed = function (knots) {
    if (knots == null || !isFinite(knots)) return '—';
    if (U().speed === 'kmh') return (knots * 1.852).toFixed(1) + ' km/h';
    return knots.toFixed(1) + ' kn';
  };

  Fmt.windSpeed = function (knots) {
    if (knots == null || !isFinite(knots)) return '—';
    var u = U().windSpeed;
    if (u === 'ms') return (knots * 0.514444).toFixed(1) + ' m/s';
    if (u === 'kmh') return Math.round(knots * 1.852) + ' km/h';
    return Math.round(knots) + ' kn';
  };

  Fmt.temperature = function (celsius) {
    if (celsius == null || !isFinite(celsius)) return '—';
    if (U().temperature === 'F') return Math.round(celsius * 9 / 5 + 32) + '°F';
    return Math.round(celsius) + '°C';
  };

  // Optional numeric fields — a vessel added with only its identifiers has most
  // of these empty, and every view must render that as a dash rather than
  // crashing on null.
  Fmt.metres = function (value, digits) {
    if (value == null || !isFinite(value)) return '—';
    return value.toFixed(digits == null ? 1 : digits) + ' m';
  };

  Fmt.tonnage = function (value) {
    if (value == null || !isFinite(value)) return '—';
    return Math.round(value).toLocaleString() + ' GT';
  };

  Fmt.year = function (value) {
    if (value == null || !isFinite(value)) return '—';
    return String(Math.round(value));
  };

  Fmt.text = function (value) {
    return value == null || value === '' ? '—' : String(value);
  };

  Fmt.waveHeight = function (metres) {
    if (metres == null || !isFinite(metres)) return '—';
    return metres.toFixed(1) + ' m';
  };

  /* --- Position ---------------------------------------------------------- */

  // Degrees and decimal minutes, the convention on a bridge.
  Fmt.latitude = function (lat) {
    return dm(Math.abs(lat), 2) + ' ' + (lat >= 0 ? 'N' : 'S');
  };

  Fmt.longitude = function (lon) {
    return dm(Math.abs(lon), 3) + ' ' + (lon >= 0 ? 'E' : 'W');
  };

  function dm(value, degDigits) {
    var deg = Math.floor(value);
    var min = (value - deg) * 60;
    if (min >= 59.995) { deg += 1; min = 0; }
    return pad(deg, degDigits) + '° ' + (min < 10 ? '0' : '') + min.toFixed(2) + "'";
  }

  Fmt.bearing = function (deg) {
    if (deg == null || !isFinite(deg)) return '—';
    return pad(Math.round(deg) % 360, 3) + '°';
  };

  function pad(n, width) {
    var s = String(Math.abs(Math.round(n)));
    while (s.length < width) s = '0' + s;
    return s;
  }
  Fmt.pad = pad;

  /* --- Time -------------------------------------------------------------- */

  Fmt.clock = function (date, timeZone) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timeZone
      }).format(date);
    } catch (e) {
      // An invalid IANA zone in config shouldn't take the whole board down.
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(date);
    }
  };

  // Local time at a longitude, when we have no IANA zone for a position at sea.
  // Nautical time is longitude/15 rounded to the nearest hour — which is exactly
  // how a ship's clock is actually set.
  Fmt.nauticalTime = function (date, lon) {
    return Fmt.timeAtOffset(date, Math.round(lon / 15) * 3600, true);
  };

  // Preferred when we know the real zone: Open-Meteo returns the shore offset for
  // the position, which is what a yacht alongside in Palma actually runs on.
  // Falls back to nautical time out at sea where no shore zone applies.
  Fmt.timeAtOffset = function (date, offsetSeconds, nautical) {
    var shifted = new Date(date.getTime() + offsetSeconds * 1000);
    var hours = offsetSeconds / 3600;
    var whole = Math.trunc(hours);
    var minutes = Math.round(Math.abs(hours - whole) * 60);
    var label = 'UTC' + (hours >= 0 ? '+' : '−') + Math.abs(whole) +
                (minutes ? ':' + pad(minutes, 2) : '');
    return {
      text: pad(shifted.getUTCHours(), 2) + ':' + pad(shifted.getUTCMinutes(), 2),
      offsetHours: hours,
      nautical: !!nautical,
      label: label + (nautical ? ' (ship)' : '')
    };
  };

  Fmt.date = function (dateish) {
    var d = dateish instanceof Date ? dateish : new Date(dateish);
    if (isNaN(d)) return '—';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  };

  // "4 min ago", "3 h ago", "2 days ago" — the age of a fix is as important as
  // the fix, so this is used everywhere a position is shown.
  Fmt.age = function (fromDate, now) {
    if (!fromDate) return 'no fix';
    var ms = (now || new Date()) - fromDate;
    if (ms < 0) ms = 0;
    var mins = ms / 60000;
    if (mins < 1) return 'just now';
    if (mins < 60) return Math.round(mins) + ' min ago';
    var hours = mins / 60;
    if (hours < 24) return Math.round(hours) + ' h ago';
    var days = hours / 24;
    if (days < 14) return Math.round(days) + (Math.round(days) === 1 ? ' day ago' : ' days ago');
    return Math.round(days / 7) + ' weeks ago';
  };

  /* --- Vessel state ------------------------------------------------------ */

  var STATUS_LABELS = {
    underway: 'Underway',
    anchored: 'At anchor',
    moored: 'Alongside',
    dark: 'No signal',
    unknown: 'Unknown'
  };

  Fmt.statusLabel = function (status) {
    return STATUS_LABELS[status] || STATUS_LABELS.unknown;
  };

  /* --- AIS code tables ---------------------------------------------------- */

  // Ship and cargo type, ITU-R M.1371 table 53. Only the codes a yacht fleet
  // will actually meet are named; the rest fall back to their decade.
  var SHIP_TYPES = {
    30: 'Fishing', 31: 'Towing', 32: 'Towing, long', 33: 'Dredging',
    34: 'Diving ops', 35: 'Military ops', 36: 'Sailing', 37: 'Pleasure craft',
    50: 'Pilot vessel', 51: 'Search and rescue', 52: 'Tug', 53: 'Port tender',
    55: 'Law enforcement', 58: 'Medical transport'
  };
  var TYPE_DECADES = {
    2: 'Wing in ground', 4: 'High-speed craft', 6: 'Passenger',
    7: 'Cargo', 8: 'Tanker', 9: 'Other'
  };

  Fmt.shipType = function (code) {
    if (code == null) return '—';
    if (SHIP_TYPES[code]) return SHIP_TYPES[code];
    var decade = TYPE_DECADES[Math.floor(code / 10)];
    return decade || 'Type ' + code;
  };

  // Electronic position fixing device, ITU-R M.1371 table 47.
  var FIX_TYPES = {
    1: 'GPS', 2: 'GLONASS', 3: 'GPS + GLONASS', 4: 'Loran-C', 5: 'Chayka',
    6: 'Integrated navigation', 7: 'Surveyed', 8: 'Galileo'
  };

  Fmt.fixType = function (code) {
    if (code == null || code === 0) return 'Undefined';
    return FIX_TYPES[code] || 'Type ' + code;
  };

  Fmt.fullName = function (yacht) {
    return yacht.prefix ? yacht.prefix + ' ' + yacht.name : yacht.name;
  };

  window.Fmt = Fmt;
})();
