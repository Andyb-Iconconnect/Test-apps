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

  Vessel.removeAddition = function (id) {
    var list = Vessel.loadAdditions().filter(function (r) { return r.id !== id; });
    return saveAdditions(list);
  };

  // Locally added vessels are marked so the console can say plainly that they
  // are not in fleet.js yet.
  Vessel.mergedFleet = function (base) {
    var hidden = Vessel.hiddenIds();
    var isHidden = function (y) { return hidden.indexOf(y.id) !== -1; };

    var additions = Vessel.loadAdditions().map(function (r) {
      var copy = JSON.parse(JSON.stringify(r));
      copy.addedLocally = true;
      return copy;
    });
    var taken = {};
    base.forEach(function (y) { taken[y.mmsi] = true; taken[y.id] = true; });

    return base
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

  Vessel.slugify = function (name) {
    return String(name).toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'vessel';
  };

  // Everything not asked for on the form is left null rather than guessed, so
  // the record never quietly asserts something nobody checked.
  Vessel.buildRecord = function (fields) {
    return {
      id: Vessel.slugify(fields.name) + '-' + String(fields.mmsi).slice(-4),
      name: fields.name,
      prefix: fields.prefix || 'M/Y',
      mmsi: fields.mmsi,
      imo: fields.imo,
      callSign: fields.callSign || null,
      flag: fields.flag || null,
      flagCode: null,
      loa: fields.loa != null ? fields.loa : null,
      beam: null,
      grossTonnage: null,
      builder: fields.builder || null,
      yearBuilt: fields.yearBuilt != null ? fields.yearBuilt : null,
      lastRefit: null,
      classSociety: null,
      photo: null,
      discreet: !!fields.discreet,
      service: {
        nextEvent: fields.nextEvent || null,
        nextEventDate: fields.nextEventDate || null,
        engineer: fields.engineer || null,
        openJobs: 0,
        urgentJobs: 0,
        partsOnOrder: [],
        yardPeriod: null
      },
      systems: [],
      contacts: []
    };
  };

  /* --- fleet.js snippet ---------------------------------------------------- */

  function js(value) {
    if (value == null) return 'null';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);
    return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  }

  // Rendered to match the hand-written entries around it, so a pasted vessel is
  // indistinguishable from one typed in.
  Vessel.toSnippet = function (r) {
    var lines = [
      '  {',
      '    id: ' + js(r.id) + ',',
      '    name: ' + js(r.name) + ',',
      '    prefix: ' + js(r.prefix) + ',',
      '    mmsi: ' + js(r.mmsi) + ',',
      '    imo: ' + js(r.imo) + ',',
      '    callSign: ' + js(r.callSign) + ',',
      '    flag: ' + js(r.flag) + ',',
      '    flagCode: ' + js(r.flagCode) + ',',
      '    loa: ' + js(r.loa) + ', beam: ' + js(r.beam) + ', grossTonnage: ' + js(r.grossTonnage) + ',',
      '    builder: ' + js(r.builder) + ',',
      '    yearBuilt: ' + js(r.yearBuilt) + ', lastRefit: ' + js(r.lastRefit) + ',',
      '    classSociety: ' + js(r.classSociety) + ',',
      '    photo: null,',
      '    discreet: ' + js(r.discreet) + ',',
      '    service: {',
      '      nextEvent: ' + js(r.service.nextEvent) + ',',
      '      nextEventDate: ' + js(r.service.nextEventDate) + ',',
      '      engineer: ' + js(r.service.engineer) + ',',
      '      openJobs: 0,',
      '      urgentJobs: 0,',
      '      partsOnOrder: [],',
      '      yardPeriod: null',
      '    },',
      '    systems: [',
      "      { line: 'AV',       product: null, installed: null },",
      "      { line: 'IT',       product: null, installed: null },",
      "      { line: 'Security', product: null, installed: null }",
      '    ],',
      '    contacts: []',
      '  }'
    ];
    return lines.join('\n');
  };

  window.Vessel = Vessel;
})();
