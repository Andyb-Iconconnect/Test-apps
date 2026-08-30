/* -----------------------------------------------------------------------------
 * csv.js — reading a fleet out of a spreadsheet, and writing one back.
 *
 * The fleet lives in spreadsheets and inboxes before it lives here, so the way
 * in has to be a spreadsheet. Save as CSV from Excel or Numbers and drop the
 * file on the console.
 *
 * There is no xlsx reader here on purpose: it needs a megabyte of library that
 * would have to be inlined into every offline bundle, to save one Save-as. The
 * console says so rather than failing at a .xlsx quietly.
 *
 * The parser is written out rather than split on commas, because a fleet list
 * has "Lloyd's Register" and "Feadship, Netherlands" and addresses with commas
 * in them, and splitting quietly mangles exactly those rows.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Csv = {};

  /**
   * Parse delimited text into an array of rows of strings.
   *
   * Handles quoted fields, doubled quotes inside them, newlines inside them,
   * CRLF, and a byte-order mark from Excel. The delimiter is worked out from
   * the first line unless one is given: Excel in a European locale writes
   * semicolons, and a tab-separated paste is common enough to be worth taking.
   */
  Csv.parse = function (text, delimiter) {
    var input = String(text).replace(/^﻿/, '');
    var delim = delimiter || Csv.sniffDelimiter(input);
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;

    while (i < input.length) {
      var ch = input[i];

      if (inQuotes) {
        if (ch === '"') {
          if (input[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }

      if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    // Whatever is left is the last field of the last row, unless the file ended
    // on a newline and there is nothing left at all.
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    return rows.map(function (r) {
      return r.map(function (cell) { return cell.trim(); });
    }).filter(function (r) {
      return r.some(function (cell) { return cell !== ''; });
    });
  };

  // Whichever candidate appears most on the first line, outside quotes.
  Csv.sniffDelimiter = function (text) {
    var firstLine = String(text).split(/\r?\n/)[0] || '';
    var counts = [',', ';', '\t', '|'].map(function (d) {
      var n = 0, quoted = false;
      for (var i = 0; i < firstLine.length; i++) {
        if (firstLine[i] === '"') quoted = !quoted;
        else if (!quoted && firstLine[i] === d) n++;
      }
      return { delim: d, n: n };
    }).sort(function (a, b) { return b.n - a.n; });
    return counts[0].n > 0 ? counts[0].delim : ',';
  };

  /* --- Which column is which ----------------------------------------------- */

  // A header is matched on its letters and digits alone, so "LOA (m)",
  // "loa_m" and "LOA" are the same thing.
  var normalise = function (t) {
    return String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
  };

  // Longest alias first within each field, so 'yearbuilt' is not eaten by 'year'.
  var ALIASES = {
    name: ['vesselname', 'yachtname', 'shipname', 'boatname', 'name', 'vessel', 'yacht'],
    prefix: ['prefix', 'vesseltype', 'type', 'rig'],
    mmsi: ['mmsinumber', 'mmsino', 'mmsi'],
    imo: ['imonumber', 'imono', 'imo'],
    callSign: ['callsign', 'radiocallsign', 'call'],
    flag: ['flagstate', 'flagcountry', 'registry', 'flag'],
    flagCode: ['flagcode', 'countrycode', 'iso'],
    loa: ['lengthoverall', 'loam', 'loa', 'length', 'lengthm'],
    beam: ['beamm', 'beam', 'breadth'],
    grossTonnage: ['grosstonnage', 'gross', 'tonnage', 'grt', 'gt'],
    builder: ['shipyard', 'builder', 'yard', 'manufacturer'],
    yearBuilt: ['yearbuilt', 'buildyear', 'built', 'year'],
    lastRefit: ['lastrefit', 'refityear', 'refit'],
    classSociety: ['classificationsociety', 'classsociety', 'class'],
    photo: ['photourl', 'photo', 'imageurl', 'image', 'picture'],
    discreet: ['discreet', 'discrete', 'private', 'confidential'],
    demoStatus: ['status', 'state'],
    demoPort: ['currentport', 'homeport', 'port', 'location', 'berth'],
    demoLat: ['latitude', 'lat'],
    demoLon: ['longitude', 'long', 'lng', 'lon'],
    demoDestination: ['destination', 'boundfor', 'nextport'],
    demoSpeed: ['speed', 'sog'],
    demoEtaHours: ['etahours', 'eta']
  };

  /**
   * Guess what each column holds, from its heading.
   *
   * Returns an array the same length as the header row, each entry a field name
   * or ''. A field is only claimed once — two columns both called "Name" would
   * otherwise both map to it and the second would silently win.
   */
  Csv.mapColumns = function (header) {
    var mapping = header.map(function () { return ''; });
    var taken = {};

    header.forEach(function (cell, index) {
      var key = normalise(cell);
      if (!key) return;
      var best = null;
      Object.keys(ALIASES).forEach(function (field) {
        if (taken[field] || best) return;
        var aliases = ALIASES[field];
        for (var i = 0; i < aliases.length; i++) {
          if (key === aliases[i]) { best = field; return; }
        }
      });
      if (best) { mapping[index] = best; taken[best] = true; }
    });
    return mapping;
  };

  Csv.FIELDS = Object.keys(ALIASES);

  // A spreadsheet says yes in a dozen ways and means one thing.
  Csv.truthy = function (value) {
    return /^(y|yes|true|1|x|✓|discreet|private)$/i.test(String(value).trim());
  };

  /**
   * Turn a data row into the flat fields the vessel form uses.
   * Values are left as text; buildRecord does the coercion.
   */
  Csv.rowToFields = function (row, mapping) {
    var fields = {};
    mapping.forEach(function (field, index) {
      if (!field) return;
      var value = row[index];
      if (value == null || value === '') return;
      fields[field] = value;
    });
    if (fields.discreet != null) fields.discreet = Csv.truthy(fields.discreet);
    if (fields.prefix) {
      // "motor", "M/Y", "sail", "S/Y", "sloop" all mean one of two things.
      fields.prefix = /^s|sail|sloop|ketch|schooner/i.test(String(fields.prefix).trim())
        ? 'S/Y' : 'M/Y';
    }
    return fields;
  };

  /* --- Writing one out ------------------------------------------------------ */

  var EXPORT_COLUMNS = [
    ['name', 'Name'], ['prefix', 'Type'], ['mmsi', 'MMSI'], ['imo', 'IMO'],
    ['callSign', 'Call sign'], ['flag', 'Flag'], ['flagCode', 'Flag code'],
    ['loa', 'LOA (m)'], ['beam', 'Beam (m)'], ['grossTonnage', 'Gross tonnage'],
    ['builder', 'Builder'], ['yearBuilt', 'Year built'], ['lastRefit', 'Last refit'],
    ['classSociety', 'Class society'], ['photo', 'Photo'], ['discreet', 'Discreet'],
    ['demoStatus', 'Status'], ['demoPort', 'Port'], ['demoLat', 'Latitude'],
    ['demoLon', 'Longitude'], ['demoDestination', 'Bound for'],
    ['demoSpeed', 'Speed (kn)'], ['demoEtaHours', 'ETA (hours)']
  ];

  function quote(value) {
    if (value == null) return '';
    var text = String(value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  /**
   * The fleet as a spreadsheet, in the same columns this reads back. Excel
   * needs the byte-order mark or it mangles anything not ASCII — Göcek, say.
   */
  Csv.fromFleet = function (fleet, toFields) {
    var lines = [EXPORT_COLUMNS.map(function (c) { return quote(c[1]); }).join(',')];
    fleet.forEach(function (y) {
      var fields = toFields(y);
      lines.push(EXPORT_COLUMNS.map(function (c) {
        var value = fields[c[0]];
        if (c[0] === 'discreet') return value ? 'yes' : 'no';
        return quote(value);
      }).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  };

  window.Csv = Csv;
})();
