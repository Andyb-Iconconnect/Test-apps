/* -----------------------------------------------------------------------------
 * ais.js — live positions from AISstream.io over a WebSocket.
 *
 * AISstream is free and needs only an API key. On connect we send one
 * subscription naming our fleet's MMSIs, so the socket carries our eight yachts
 * rather than the world's hundred thousand ships.
 *
 * Coverage is terrestrial: receivers on shore. A yacht more than roughly 40 nm
 * offshore is out of range and simply stops reporting, and so does one whose
 * captain has switched the transponder off for the owner's privacy. Neither is
 * an error, and neither is treated as one — the store ages the last known fix
 * and the board says how old it is.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Ais = { socket: null, attempt: 0, stopped: false, timer: null };

  // Sentinel values the AIS standard uses for "not available".
  var COG_UNAVAILABLE = 360;
  var SOG_UNAVAILABLE = 102.3;
  var HEADING_UNAVAILABLE = 511;

  Ais.start = function (apiKey, mmsiList) {
    Ais.apiKey = apiKey;
    Ais.mmsiList = mmsiList.map(String);
    Ais.stopped = false;
    connect();
  };

  Ais.stop = function () {
    Ais.stopped = true;
    clearTimeout(Ais.timer);
    if (Ais.socket) {
      Ais.socket.onclose = null;
      try { Ais.socket.close(); } catch (e) {}
      Ais.socket = null;
    }
  };

  function connect() {
    if (Ais.stopped) return;
    window.Store.setConnection(Ais.attempt === 0 ? 'connecting' : 'retrying');

    var socket;
    try {
      socket = new WebSocket(window.CONFIG.ais.endpoint);
    } catch (e) {
      scheduleReconnect();
      return;
    }
    Ais.socket = socket;

    socket.onopen = function () {
      Ais.attempt = 0;
      // The subscription must be the first thing sent, within a second or so,
      // or the server drops the connection.
      socket.send(JSON.stringify({
        APIKey: Ais.apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],   // note: [lat, lon] pairs
        FiltersShipMMSI: Ais.mmsiList,
        FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport',
                             'ExtendedClassBPositionReport', 'ShipStaticData']
      }));
      window.Store.setConnection('open');
    };

    socket.onmessage = function (event) {
      var payload;
      try { payload = JSON.parse(event.data); } catch (e) { return; }
      handle(payload);
    };

    socket.onerror = function () {
      // onclose always follows, which is where the retry is scheduled.
    };

    socket.onclose = function () {
      Ais.socket = null;
      if (!Ais.stopped) scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    var cfg = window.CONFIG.ais;
    var delay = Math.min(cfg.reconnectMaxMs, cfg.reconnectBaseMs * Math.pow(2, Ais.attempt));
    // Jitter, so a network blip doesn't produce a synchronised reconnect storm
    // if several screens are running off the same feed.
    delay = delay * (0.7 + Math.random() * 0.6);
    Ais.attempt++;
    window.Store.setConnection('retrying');
    clearTimeout(Ais.timer);
    Ais.timer = setTimeout(connect, delay);
  }

  function handle(payload) {
    var meta = payload.MetaData || {};
    var mmsi = meta.MMSI != null ? String(meta.MMSI) : null;
    if (!mmsi) return;

    var at = parseTime(meta.time_utc);
    var body = payload.Message || {};

    switch (payload.MessageType) {
      case 'PositionReport':
        applyPosition(mmsi, body.PositionReport, at);
        break;
      case 'StandardClassBPositionReport':
        applyPosition(mmsi, body.StandardClassBPositionReport, at);
        break;
      case 'ExtendedClassBPositionReport':
        applyPosition(mmsi, body.ExtendedClassBPositionReport, at);
        break;
      case 'ShipStaticData':
        applyStatic(mmsi, body.ShipStaticData);
        break;
    }
  }

  function applyPosition(mmsi, report, at) {
    if (!report) return;
    var lat = report.Latitude, lon = report.Longitude;
    if (lat == null || lon == null) return;
    // AIS transmits 91/181 when a receiver has no fix to report.
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;

    window.Store.applyFix(mmsi, {
      lat: lat,
      lon: lon,
      cog: report.Cog != null && report.Cog !== COG_UNAVAILABLE ? report.Cog : null,
      sog: report.Sog != null && report.Sog !== SOG_UNAVAILABLE ? report.Sog : null,
      heading: report.TrueHeading != null && report.TrueHeading !== HEADING_UNAVAILABLE
        ? report.TrueHeading : null,
      navStatus: report.NavigationalStatus != null ? report.NavigationalStatus : null,
      at: at
    });
  }

  function applyStatic(mmsi, data) {
    if (!data) return;
    window.Store.applyVoyage(mmsi, {
      // Destination and ETA are typed in by the crew. They are frequently stale,
      // occasionally a joke, and always worth labelling "as reported".
      destination: clean(data.Destination),
      eta: formatEta(data.Eta),
      draught: data.MaximumStaticDraught || null,
      callSign: clean(data.CallSign)
    });
  }

  function clean(text) {
    if (!text) return null;
    // AIS pads fixed-width fields with '@'.
    var s = String(text).replace(/@+/g, '').trim();
    return s.length ? s : null;
  }

  // AIS carries ETA as month/day/hour/minute with no year, so it is only
  // meaningful as a label, never as a Date.
  function formatEta(eta) {
    if (!eta || !eta.Month || !eta.Day) return null;
    var months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var month = months[eta.Month] || '';
    if (!month) return null;
    var time = (eta.Hour != null && eta.Hour < 24)
      ? ' ' + window.Fmt.pad(eta.Hour, 2) + ':' + window.Fmt.pad(eta.Minute || 0, 2)
      : '';
    return eta.Day + ' ' + month + time;
  }

  function parseTime(text) {
    if (!text) return new Date();
    // AISstream sends e.g. "2026-08-28 19:41:02.123456789 +0000 UTC", which
    // Date cannot parse directly.
    var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(text));
    if (m) {
      var d = new Date(m[1] + 'T' + m[2] + 'Z');
      if (!isNaN(d)) return d;
    }
    var fallback = new Date(text);
    return isNaN(fallback) ? new Date() : fallback;
  }

  Ais._parseTime = parseTime;   // exposed for tests
  Ais._handle = handle;

  window.Ais = Ais;
})();
