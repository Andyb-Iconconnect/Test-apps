/* -----------------------------------------------------------------------------
 * vessel.js — validating and adding vessel records.
 *
 * fleet.js stays the source of truth: it is version-controlled, it is shared by
 * both pages, and at five new yachts a year hand-editing it costs minutes. What
 * this adds is a way to do that without hand-writing JavaScript — the console's
 * form validates the identifiers, holds the vessel in this browser so you can
 * see it straight away, and hands you the fleet.js entry to paste in.
 *
 * A locally added vessel is exactly that: local. It is in this browser only
 * until the snippet reaches fleet.js, which is why the console says so.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Vessel = {};
  var STORE_KEY = 'fleetwatch.additions.v1';

  /* --- IMO ---------------------------------------------------------------- */

  // An IMO number carries its own check digit: multiply the first six digits by
  // 7, 6, 5, 4, 3, 2, sum them, and the last digit of the total is the seventh.
  // It catches most transpositions and mistyped digits, which is the whole point
  // of asking for the IMO rather than trusting a name.
  Vessel.imoCheckDigit = function (firstSix) {
    var weights = [7, 6, 5, 4, 3, 2];
    var sum = 0;
    for (var i = 0; i < 6; i++) sum += parseInt(firstSix.charAt(i), 10) * weights[i];
    return sum % 10;
  };

  Vessel.validateImo = function (input) {
    var raw = String(input == null ? '' : input).trim().replace(/^IMO[\s:]*/i, '').replace(/\s/g, '');
    if (!raw) return { ok: false, error: 'Enter an IMO number.' };
    if (!/^\d{7}$/.test(raw)) {
      return { ok: false, error: 'An IMO number is exactly seven digits.' };
    }
    var expected = Vessel.imoCheckDigit(raw);
    if (expected !== parseInt(raw.charAt(6), 10)) {
      return {
        ok: false,
        error: 'That is not a valid IMO number — the check digit should be ' +
               expected + ', not ' + raw.charAt(6) + '. Worth re-reading it off the certificate.'
      };
    }
    return { ok: true, value: parseInt(raw, 10) };
  };

  /* --- MMSI --------------------------------------------------------------- */

  // The first three digits are the Maritime Identification Digits — the flag.
  // Ship stations sit in 201–775; anything else is a coast station, an aid to
  // navigation, a handheld, or a group call, none of which is a yacht.
  Vessel.validateMmsi = function (input) {
    var raw = String(input == null ? '' : input).trim().replace(/\s/g, '');
    if (!raw) {
      return { ok: false, error: 'Enter an MMSI. AIS broadcasts on MMSI, not IMO — without it there is nothing to track.' };
    }
    if (!/^\d{9}$/.test(raw)) return { ok: false, error: 'An MMSI is exactly nine digits.' };
    var mid = parseInt(raw.slice(0, 3), 10);
    if (mid < 201 || mid > 775) {
      return {
        ok: false,
        error: 'That is not a ship-station MMSI. The first three digits identify the flag ' +
               'and should be between 201 and 775; ' + raw.slice(0, 3) + ' is a coast station, ' +
               'an aid to navigation, or a handheld.'
      };
    }
    return { ok: true, value: parseInt(raw, 10) };
  };

  /* --- Local additions ----------------------------------------------------- */

  Vessel.loadAdditions = function () {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return []; }
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  };

  function saveAdditions(list) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;   // private browsing, or storage disabled
    }
  }

  Vessel.addAddition = function (record) {
    var list = Vessel.loadAdditions();
    list.push(record);
    return saveAdditions(list);
  };

  /* --- Hiding a vessel from fleet.js --------------------------------------- */

  // A browser cannot edit fleet.js, so removing a vessel that came from the file
  // is recorded as a local hide and paired with the instruction to delete its
  // entry. Same bargain as adding: it takes effect here immediately, and the
  // file is what makes it true for everybody.
  /* --- Edits to vessels that came from fleet.js ---------------------------- */

  // fleet.js is read-only at runtime, so editing one of its vessels is stored
  // as an override keyed on id and applied over the top when the fleet is
  // merged. Writing the file out bakes them in and they can then be cleared.
  var OVERRIDE_KEY = 'fleetwatch.overrides.v1';

  Vessel.loadOverrides = function () {
    var raw;
    try { raw = localStorage.getItem(OVERRIDE_KEY); } catch (e) { return {}; }
    if (!raw) return {};
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) { return {}; }
  };

  function saveOverrides(map) {
    try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(map)); return true; }
    catch (e) { return false; }
  }

  Vessel.setOverride = function (id, record) {
    var map = Vessel.loadOverrides();
    map[id] = record;
    return saveOverrides(map);
  };

  Vessel.clearOverride = function (id) {
    var map = Vessel.loadOverrides();
    if (!(id in map)) return false;
    delete map[id];
    return saveOverrides(map);
  };

  Vessel.clearAllOverrides = function () { return saveOverrides({}); };

  Vessel.overriddenIds = function () { return Object.keys(Vessel.loadOverrides()); };

  var HIDDEN_KEY = 'fleetwatch.hidden.v1';

  Vessel.hiddenIds = function () {
    var raw;
    try { raw = localStorage.getItem(HIDDEN_KEY); } catch (e) { return []; }
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  };

  function saveHidden(ids) {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids)); return true; }
    catch (e) { return false; }
  }

  Vessel.hideVessel = function (id) {
    var ids = Vessel.hiddenIds();
    if (ids.indexOf(id) === -1) ids.push(id);
    return saveHidden(ids);
  };

  Vessel.unhideVessel = function (id) {
    return saveHidden(Vessel.hiddenIds().filter(function (x) { return x !== id; }));
  };

  Vessel.unhideAll = function () { return saveHidden([]); };

  Vessel.updateAddition = function (id, record) {
    var list = Vessel.loadAdditions();
    var i = list.findIndex ? list.findIndex(function (r) { return r.id === id; }) : -1;
    if (i === -1) {
      for (var j = 0; j < list.length; j++) { if (list[j].id === id) { i = j; break; } }
    }
    if (i === -1) return false;
    list[i] = record;
    return saveAdditions(list);
  };

  Vessel.removeAddition = function (id) {
    var list = Vessel.loadAdditions().filter(function (r) { return r.id !== id; });
    return saveAdditions(list);
  };

  // Locally added vessels are marked so the console can say plainly that they
  // are not in fleet.js yet.
  Vessel.mergedFleet = function (base) {
    var hidden = Vessel.hiddenIds();
    var isHidden = function (y) { return hidden.indexOf(y.id) !== -1; };

    var overrides = Vessel.loadOverrides();

    var additions = Vessel.loadAdditions().map(function (r) {
      var copy = JSON.parse(JSON.stringify(r));
      copy.addedLocally = true;
      return copy;
    });
    var taken = {};
    base.forEach(function (y) { taken[y.mmsi] = true; taken[y.id] = true; });

    // An override replaces the fleet.js record outright rather than merging
    // field by field: the form hands back a whole record, and a half-applied
    // edit would be worse than either version.
    var edited = base.map(function (y) {
      if (!overrides[y.id]) return y;
      var copy = JSON.parse(JSON.stringify(overrides[y.id]));
      copy.id = y.id;
      copy.editedLocally = true;
      return copy;
    });

    return edited
      .concat(additions.filter(function (r) { return !taken[r.mmsi] && !taken[r.id]; }))
      .filter(function (y) { return !isHidden(y); });
  };

  // Those hidden, resolved back to their records so they can be listed and put
  // back. An id left over from an edited fleet.js simply resolves to nothing.
  Vessel.hiddenVessels = function (base) {
    var hidden = Vessel.hiddenIds();
    return base.filter(function (y) { return hidden.indexOf(y.id) !== -1; });
  };

  /* --- Building a record --------------------------------------------------- */

  /**
   * Her flag, from her MMSI.
   *
   * The leading three digits are allocated by the ITU to a flag administration,
   * so this is a fact about the number rather than a lookup: no network, no
   * typing, and right the moment the MMSI is. Returns null for a MID that is
   * not in the table, which leaves the field blank to be filled in by hand —
   * honest, where a guess would not be.
   */
  Vessel.flagFromMmsi = function (mmsi) {
    var digits = String(mmsi == null ? '' : mmsi).replace(/\D/g, '');
    if (digits.length !== 9) return null;
    var entry = window.MID && window.MID[Number(digits.slice(0, 3))];
    return entry ? { flagCode: entry[0], flag: entry[1] } : null;
  };

  /**
   * Fields the app can supply that a record has not got.
   *
   * Only ever fills a blank. A field somebody has typed stays as it is and goes
   * on being cross-checked against what the transponder says — silently
   * replacing it would destroy the very disagreement that catches a wrong MMSI.
   */
  Vessel.autoFill = function (yacht, ais) {
    var out = {};
    var blank = function (key) {
      return yacht[key] == null || yacht[key] === '';
    };

    var flag = Vessel.flagFromMmsi(yacht.mmsi);
    if (flag) {
      if (blank('flag')) out.flag = flag.flag;
      if (blank('flagCode')) out.flagCode = flag.flagCode;
    }

    if (!ais) return out;
    if (blank('name') && ais.name) out.name = ais.name;
    if (blank('imo') && ais.imo) out.imo = ais.imo;
    if (blank('callSign') && ais.callSign) out.callSign = ais.callSign;
    if (blank('loa') && ais.loa) out.loa = ais.loa;
    if (blank('beam') && ais.beam) out.beam = ais.beam;
    // 36 is a sailing vessel, 37 a pleasure craft. Nothing else tells us.
    if (blank('prefix') && ais.shipType === 36) out.prefix = 'S/Y';
    if (blank('prefix') && ais.shipType === 37) out.prefix = 'M/Y';
    return out;
  };

  Vessel.slugify = function (name) {
    return String(name).toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'vessel';
  };

  var text = function (v) {
    if (v == null) return null;
    var t = String(v).trim();
    return t.length ? t : null;
  };
  var num = function (v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  };

  // Everything not filled in is left null rather than guessed, so the record
  // never quietly asserts something nobody checked.
  Vessel.buildRecord = function (fields) {
    // The flag is in the MMSI. Nobody should be typing it.
    var fromMmsi = Vessel.flagFromMmsi(fields.mmsi);
    return {
      id: fields.id || (Vessel.slugify(fields.name) + '-' + String(fields.mmsi).slice(-4)),
      name: fields.name,
      prefix: text(fields.prefix),
      mmsi: fields.mmsi,
      imo: num(fields.imo),
      callSign: text(fields.callSign),
      flag: text(fields.flag) || (fromMmsi && fromMmsi.flag) || null,
      flagCode: (text(fields.flagCode) ? text(fields.flagCode).toUpperCase() : null) ||
                (fromMmsi && fromMmsi.flagCode) || null,
      loa: num(fields.loa),
      beam: num(fields.beam),
      grossTonnage: num(fields.grossTonnage),
      builder: text(fields.builder),
      yearBuilt: num(fields.yearBuilt),
      lastRefit: num(fields.lastRefit),
      classSociety: text(fields.classSociety),
      photo: text(fields.photo),
      discreet: !!fields.discreet,
      demo: Vessel.buildDemo(fields)
    };
  };

  /**
   * The demo block, from form fields.
   *
   * Without one, demo mode gives a vessel no position at all and she never
   * reaches the chart — which looks exactly like a vessel that was never added.
   * So this always returns a block, falling back to the office if nothing else
   * was given, rather than returning null and losing her.
   *
   * An existing hand-written `route` is preserved: routes are more than a form
   * can sensibly edit, and silently flattening one to a single point would
   * throw away work.
   */
  Vessel.buildDemo = function (fields) {
    var demo = {
      status: Vessel.normaliseStatus(fields.demoStatus)
    };
    if (fields.demoRoute && fields.demoRoute.length >= 2) {
      demo.route = fields.demoRoute;
    } else if (num(fields.demoLat) != null && num(fields.demoLon) != null) {
      demo.position = [num(fields.demoLon), num(fields.demoLat)];
    } else if (text(fields.demoPort)) {
      demo.port = text(fields.demoPort);
    } else {
      // The office, by position rather than by name. `office.label` is "Palma
      // office", which is not a port in data/ports.js — falling back to it left
      // the vessel with no position at all, which is the exact thing this
      // fallback exists to prevent.
      var office = (window.CONFIG && window.CONFIG.office) || {};
      demo.position = [
        office.lon != null ? office.lon : 2.6502,
        office.lat != null ? office.lat : 39.5696
      ];
    }
    if (num(fields.demoSpeed) != null) demo.speed = num(fields.demoSpeed);
    if (text(fields.demoDestination)) demo.destination = text(fields.demoDestination).toUpperCase();
    if (num(fields.demoEtaHours) != null) demo.etaHours = num(fields.demoEtaHours);
    return demo;
  };

  /**
   * The four states the rest of the app knows, from however they were written.
   *
   * A spreadsheet says "At anchor", "Alongside", "In port", "Under way", "No
   * signal". Stored raw, they reach demo.js as words it has never heard: the
   * status is then neither honoured nor rejected, just quietly ignored, and the
   * vessel derives whatever her speed happens to imply.
   */
  Vessel.normaliseStatus = function (value) {
    var t = String(value == null ? '' : value).toLowerCase().replace(/[^a-z]/g, '');
    if (!t) return 'moored';
    if (/anchor|riding|swinging/.test(t)) return 'anchored';
    if (/underway|underway|steaming|passage|enroute|sailing|making|transit/.test(t)) return 'underway';
    if (/dark|nosignal|silent|off|unknown|notracking/.test(t)) return 'dark';
    if (/moor|alongside|berth|dock|quay|marina|inport|tied|refit|yard/.test(t)) return 'moored';
    return 'moored';
  };

  // The reverse: a record back into flat form fields.
  Vessel.toFields = function (y) {
    var d = y.demo || {};
    return {
      id: y.id, name: y.name, prefix: y.prefix, mmsi: y.mmsi, imo: y.imo,
      callSign: y.callSign, flag: y.flag, flagCode: y.flagCode,
      loa: y.loa, beam: y.beam, grossTonnage: y.grossTonnage,
      builder: y.builder, yearBuilt: y.yearBuilt, lastRefit: y.lastRefit,
      classSociety: y.classSociety, photo: y.photo, discreet: !!y.discreet,
      demoStatus: Vessel.normaliseStatus(d.status),
      demoPort: d.port || null,
      demoLat: d.position ? d.position[1] : null,
      demoLon: d.position ? d.position[0] : null,
      demoRoute: d.route || null,
      demoSpeed: d.speed != null ? d.speed : null,
      demoDestination: d.destination || null,
      demoEtaHours: d.etaHours != null ? d.etaHours : null
    };
  };

  /* --- The whole file ------------------------------------------------------ */

  // Hiding a vessel only takes it off this browser. Truly removing one means
  // changing fleet.js, so the console can hand over the entire file with every
  // local change already applied — additions in, removals out. Save it over
  // fleet.js and the change is real for the office display and everyone else.
  var INDENT = '  ';

  function literal(value, depth) {
    var pad = new Array(depth + 1).join(INDENT);
    var padInner = pad + INDENT;

    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'string') {
      return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
    }
    if (Array.isArray(value)) {
      if (!value.length) return '[]';
      // Keep short, flat records on one line; they read better that way.
      var flat = value.every(function (v) { return v === null || typeof v !== 'object'; });
      if (flat) return '[' + value.map(function (v) { return literal(v, depth); }).join(', ') + ']';
      return '[\n' + value.map(function (v) {
        return padInner + literal(v, depth + 1);
      }).join(',\n') + '\n' + pad + ']';
    }
    var keys = Object.keys(value).filter(function (k) {
      return k !== 'addedLocally' && k !== 'editedLocally';
    });
    if (!keys.length) return '{}';
    var inline = keys.every(function (k) {
      var v = value[k];
      return v === null || typeof v !== 'object';
    }) && keys.length <= 4;
    if (inline) {
      return '{ ' + keys.map(function (k) { return k + ': ' + literal(value[k], depth); }).join(', ') + ' }';
    }
    return '{\n' + keys.map(function (k) {
      return padInner + k + ': ' + literal(value[k], depth + 1);
    }).join(',\n') + '\n' + pad + '}';
  }

  Vessel.toFleetFile = function (fleet) {
    var header = [
      '/* ---------------------------------------------------------------------------',
      ' * THE FLEET — this is the file you swap.',
      ' *',
      ' * Written out by the Fleet Console with every local change applied. Save it',
      ' * over fleet.js and the change reaches the office display and every other',
      ' * console. See the console for what each field means.',
      ' *',
      ' * Generated ' + new Date().toISOString().slice(0, 10) + '.',
      ' * ------------------------------------------------------------------------ */',
      '',
      'window.FLEET = ['
    ].join('\n');

    var entries = fleet.map(function (y) { return INDENT + literal(y, 1); }).join(',\n\n');
    return header + '\n' + entries + '\n];\n';
  };

  /* --- fleet.js snippet ---------------------------------------------------- */

  // Rendered to match the hand-written entries around it, so a pasted vessel is
  // indistinguishable from one typed in.
  // One entry, rendered exactly as the whole-file writer renders it. Written
  // by hand once, it drifted from the file the moment a field was added — most
  // recently `demo`, whose absence leaves a pasted vessel with no position at
  // all. Same serializer, no drift.
  Vessel.toSnippet = function (r) {
    return INDENT + literal(r, 1);
  };

  window.Vessel = Vessel;
})();
