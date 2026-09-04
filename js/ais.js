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
 *
 * It is a STREAM, and only a stream. There is no history endpoint and no
 * backfill: a track begins the moment this board first hears the yacht, and
 * everything before that is gone. What the board has, it kept itself.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Ais = {
    socket: null, attempt: 0, stopped: false, timer: null,
    // heard: every message the server sent us, of any kind, for any vessel.
    // matched: those for an MMSI in our fleet. The two apart tell you whether
    // the feed is working and our boats are quiet, or nothing is arriving at
    // all — which look identical from a green pill.
    heard: 0, matched: 0, unreadable: 0, lastError: null
  };

  // Sentinel values the AIS standard uses for "not available".
  var COG_UNAVAILABLE = 360;
  var SOG_UNAVAILABLE = 102.3;
  var HEADING_UNAVAILABLE = 511;
  var ROT_UNAVAILABLE = -128;

  // How many attempts may fail without the socket ever having opened before we
  // stop calling it "reconnecting" and say what it actually is. Once it has
  // opened even once, a drop really is a drop and this never applies again.
  var BLOCKED_AFTER = 3;

  Ais.start = function (apiKey, mmsiList) {
    Ais.apiKey = apiKey;
    Ais.mmsiList = mmsiList.map(String);
    Ais.stopped = false;
    Ais.everOpened = false;
    Ais.attempt = 0;
    Ais.heard = 0;
    Ais.matched = 0;
    Ais.unreadable = 0;
    Ais.lastError = null;
    connect();
  };

  // How long a socket may sit in CONNECTING before we give up on it. A network
  // that silently swallows the connection never fails, it just never answers,
  // and without this the board says "Connecting" for the rest of the day.
  var CONNECT_TIMEOUT_MS = 12000;

  Ais.stop = function () {
    Ais.stopped = true;
    clearTimeout(Ais.timer);
    clearTimeout(Ais.openTimer);
    if (Ais.socket) {
      release(Ais.socket);
      try { Ais.socket.close(); } catch (e) {}
      Ais.socket = null;
    }
  };

  // Every handler off a socket we are done with, so a late event from it cannot
  // schedule a second reconnect alongside the one already running.
  function release(socket) {
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
  }

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

    /**
     * Exactly one of these outcomes per attempt.
     *
     * This used to hang off `onclose` alone, on the assumption — stated in a
     * comment, never checked — that a close always follows an error. It does
     * not. A socket refused by Content-Security-Policy fires `error` and
     * nothing else: no close, ever. So the retry was never scheduled, the
     * attempt counter never moved off zero, and the board sat on "Connecting"
     * indefinitely, which is precisely what a published page does.
     */
    var settled = false;
    function failed(refused) {
      if (settled) return;
      settled = true;
      clearTimeout(Ais.openTimer);
      release(socket);
      try { socket.close(); } catch (e) {}
      if (Ais.socket === socket) Ais.socket = null;
      if (!Ais.stopped) scheduleReconnect(refused);
    }

    // A socket that is already CLOSED before a single event has fired was
    // refused outright rather than attempted — policy, not network. That is
    // conclusive on the first try, so there is nothing to be learnt from
    // waiting for three.
    if (socket.readyState === 3) { failed(true); return; }

    Ais.openTimer = setTimeout(function () { failed(false); }, CONNECT_TIMEOUT_MS);

    socket.onopen = function () {
      if (settled) return;
      clearTimeout(Ais.openTimer);
      Ais.attempt = 0;
      Ais.everOpened = true;
      // The subscription must be the first thing sent, within a second or so,
      // or the server drops the connection.
      /**
       * Nothing is filtered at the server. Not message types, not MMSIs.
       *
       * FilterMessageTypes went first. It named the five types this code
       * understands, which looked tidy and cost most of the fleet: a probe
       * sending the same key, the same box and the same sixty-one MMSIs
       * WITHOUT that field heard nine vessels the board had never once heard in
       * a day of running.
       *
       * FiltersShipMMSI is the same mistake, one layer down, and it took a day
       * of real running to see it. Thirty-one of sixty-one, holding steady,
       * while a second provider had every one of the silent ones reporting
       * within minutes. Unfiltered, this key floods — five and a half thousand
       * frames in under a minute. aisstream's own issue tracker carries the
       * same report from other people more than once: filtered by MMSI returns
       * little or nothing, unfiltered returns everything.
       *
       * So the fleet is picked out here instead, where it can be seen to
       * happen. `Store.applyFix` already ignores an MMSI that is not ours, and
       * `handle` drops one before it does any work, so the cost is a lookup per
       * message. What it buys is that no vessel can go missing in a filter
       * nobody can inspect.
       *
       * The traffic that costs is measured and shown in the AIS panel rather
       * than guessed at. Set `CONFIG.ais.filterAtServer` if it ever needs to go
       * back to asking for only our own.
       */
      var sub = {
        APIKey: Ais.apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]]    // note: [lat, lon] pairs
      };
      if (window.CONFIG.ais.filterAtServer) sub.FiltersShipMMSI = Ais.mmsiList;
      socket.send(JSON.stringify(sub));
      // Not 'open' yet: the socket is up, but a subscription the server rejects
      // leaves it up and silent. 'open' is claimed on the first message.
      window.Store.setConnection('listening');
    };

    receive(socket, function (payload, problem) {
      if (problem) {
        // Counted, never silent. A frame we cannot read is still a frame that
        // arrived, and the difference between "nothing is coming" and "plenty is
        // coming and we cannot read it" is the whole diagnosis.
        Ais.heard++; window.Store.heard++;
        Ais.unreadable++; window.Store.unreadable++;
        return;
      }
      handle(payload);
    });

    // An error before the socket ever opened, with no close behind it, is the
    // refusal case. Treat it as terminal for this attempt either way; `settled`
    // makes a close arriving afterwards a no-op.
    socket.onerror = function () {
      failed(!Ais.everOpened && socket.readyState === 3);
    };

    socket.onclose = function () { failed(false); };
  }

  function scheduleReconnect(refused) {
    var cfg = window.CONFIG.ais;
    var delay = Math.min(cfg.reconnectMaxMs, cfg.reconnectBaseMs * Math.pow(2, Ais.attempt));
    // Jitter, so a network blip doesn't produce a synchronised reconnect storm
    // if several screens are running off the same feed.
    delay = delay * (0.7 + Math.random() * 0.6);
    Ais.attempt++;
    /**
     * A socket that has never once opened is not a flaky network. It is a key
     * the server rejected, or an environment that forbids the connection
     * outright — a published artifact blocks every outbound socket, and so do
     * some corporate networks. "Reconnecting" forever is the least useful thing
     * the board could say about either, so after a few tries it says the true
     * thing instead.
     */
    var neverWorked = !Ais.everOpened;
    window.Store.setConnection(
      neverWorked && (refused || Ais.attempt >= BLOCKED_AFTER) ? 'blocked' : 'retrying');
    clearTimeout(Ais.timer);
    Ais.timer = setTimeout(connect, delay);
  }

  /**
   * Anything the server says that is not an AIS message.
   *
   * The handler used to switch on MessageType and drop everything it did not
   * recognise, which included the server's own error replies. A rejected
   * subscription therefore looked exactly like a working one that nobody had
   * sailed past yet: socket open, pill green, silence. Whatever the server is
   * complaining about, the person watching should be told.
   */
  function serverComplaint(payload) {
    var text = payload.error || payload.Error || payload.message || payload.Message;
    if (typeof text !== 'string' || !text) return null;
    // A "Message" that is an AIS body is an object, not a string, so a string
    // here really is prose meant for a human.
    return text;
  }

  /* --- Frames ---------------------------------------------------------------- */

  /**
   * AISstream sends BINARY frames, not text ones.
   *
   * A browser hands a binary frame to onmessage as a Blob by default, and
   * `JSON.parse(aBlob)` stringifies it to "[object Blob]" and throws. This code
   * caught that and returned — so every message the server sent was silently
   * dropped, for as long as the feed has existed. The socket was open, the
   * subscription accepted, thousands of frames arriving, and the board showed an
   * empty chart and said "nothing has arrived yet".
   *
   * Setting binaryType to 'arraybuffer' makes the payload synchronously
   * decodable. The string branch stays because nothing guarantees a server keeps
   * using binary frames, and a feed that breaks on that is not worth having.
   */
  var decoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;

  function frameText(data) {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) {
      return decoder ? decoder.decode(new Uint8Array(data))
                     : String.fromCharCode.apply(null, new Uint8Array(data));
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(data)) {
      return decoder ? decoder.decode(data) : String.fromCharCode.apply(null, data);
    }
    return null;              // a Blob, if binaryType was never set — read async
  }

  // Everything a socket needs to receive our frames, in one place, so the feed
  // and the probe cannot disagree about it again.
  function receive(socket, onPayload) {
    try { socket.binaryType = 'arraybuffer'; } catch (e) {}
    socket.onmessage = function (event) {
      // Measured off the wire, before anything is decoded. Taking the whole
      // world instead of asking for sixty-one vessels has a cost on somebody's
      // office connection, and it should be a figure they can read rather than
      // an assurance from me.
      window.Store.bytes += frameBytes(event.data);
      var text = frameText(event.data);
      if (text === null && event.data && typeof event.data.text === 'function') {
        // Last resort: a Blob arrived anyway. Asynchronous, but never dropped.
        event.data.text().then(function (t) { parseInto(t, onPayload); });
        return;
      }
      parseInto(text, onPayload);
    };
  }

  // Bytes as they arrived. A UTF-8 string is counted at its byte length rather
  // than its character count, or a feed full of accented ship names reads light.
  function frameBytes(data) {
    if (data == null) return 0;
    if (typeof data === 'string') {
      return typeof Blob === 'function' ? new Blob([data]).size : data.length;
    }
    if (typeof data.byteLength === 'number') return data.byteLength;
    if (typeof data.size === 'number') return data.size;
    return 0;
  }

  function parseInto(text, onPayload) {
    if (text === null) { onPayload(null, 'undecodable'); return; }
    var payload;
    try { payload = JSON.parse(text); } catch (e) { onPayload(null, 'unparseable'); return; }
    onPayload(payload, null);
  }

  /* --- What is actually on the feed? --------------------------------------- */

  /**
   * How often does this feed hear a vessel — any vessel — and does it hear ours
   * any differently?
   *
   * The counts panel can say "two hundred thousand messages, a hundred and four
   * of them ours" without either number meaning anything on its own. Ours works
   * out at one message per vessel per five minutes. Whether that is bad depends
   * entirely on what the feed manages for everybody else, and nothing until now
   * has measured that.
   *
   * Two answers, and they point opposite ways:
   *
   *   - the median vessel on the feed is also heard once every few minutes.
   *     Then the network is simply thin — a scatter of volunteer receivers
   *     hearing whoever is in range — and no filter, box or key will change it.
   *     The fix is a different provider, and knowing that is worth more than
   *     another week of tuning this one.
   *
   *   - the median vessel is heard every few SECONDS and ours every few
   *     minutes. Then ours are being treated differently, and the survey says
   *     how: Class B transponders, which broadcast at a fraction of the power
   *     and a fraction of the rate, are the first suspect on a fleet of
   *     yachts.
   *
   * Bounded by design: it counts for a fixed window and then stops, so a map of
   * every MMSI on earth cannot grow all afternoon behind a panel nobody closed.
   */
  Ais.survey = function (seconds, onProgress, onDone) {
    var counts = {};       // mmsi -> messages
    var types = {};        // MessageType -> messages
    var total = 0;
    var startedAt = Date.now();
    var stopped = false;

    Ais.observer = function (mmsi, payload) {
      total++;
      counts[mmsi] = (counts[mmsi] || 0) + 1;
      var type = payload && payload.MessageType;
      if (type) types[type] = (types[type] || 0) + 1;
    };

    var tick = setInterval(function () {
      if (stopped) return;
      var elapsed = (Date.now() - startedAt) / 1000;
      if (elapsed >= seconds) { finish(); return; }
      if (onProgress) onProgress({ elapsed: Math.round(elapsed), seconds: seconds, total: total });
    }, 1000);

    function finish() {
      if (stopped) return;
      stopped = true;
      clearInterval(tick);
      Ais.observer = null;
      if (onDone) onDone(summarise(counts, types, total, (Date.now() - startedAt) / 1000));
    }

    return function cancel() {
      if (stopped) return;
      stopped = true;
      clearInterval(tick);
      Ais.observer = null;
    };
  };

  // Which transponder a message came from. Class B is the small-vessel set —
  // 2 watts against 12.5, and a position every 30 seconds against every 2 to 10.
  var CLASS_B_TYPES = {
    StandardClassBPositionReport: true,
    ExtendedClassBPositionReport: true,
    StaticDataReport: true
  };

  function summarise(counts, types, total, seconds) {
    var all = [];
    var ours = [];
    var mmsis = Object.keys(counts);
    for (var i = 0; i < mmsis.length; i++) {
      var n = counts[mmsis[i]];
      all.push(n);
      if (window.Store.byMmsi[mmsis[i]]) ours.push({ mmsi: mmsis[i], n: n });
    }
    all.sort(function (a, b) { return a - b; });

    var classB = 0;
    var typeNames = Object.keys(types);
    for (var t = 0; t < typeNames.length; t++) {
      if (CLASS_B_TYPES[typeNames[t]]) classB += types[typeNames[t]];
    }

    return {
      seconds: Math.round(seconds),
      total: total,
      rate: seconds ? total / seconds : 0,
      vessels: all.length,
      // Per vessel, over the window. The median is the honest middle: a handful
      // of ferries running circuits in front of a receiver would drag a mean
      // anywhere.
      median: pick(all, 0.5),
      upper: pick(all, 0.9),
      best: all.length ? all[all.length - 1] : 0,
      classBShare: total ? classB / total : 0,
      types: types,
      ours: ours.sort(function (a, b) { return b.n - a.n; }),
      oursTotal: ours.reduce(function (a, b) { return a + b.n; }, 0),
      fleet: window.Store.vessels.length
    };
  }

  function pick(sorted, q) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  }

  Ais._summarise = summarise;      // for tests

  /* --- Is she on the feed under a different number? ------------------------- */

  /**
   * Chase the vessels that have never been heard from.
   *
   * "Class A, reported two minutes ago, never once on our board" is not
   * coverage and not a ceiling. A Class A transponder puts out 12.5 watts every
   * few seconds; if a network hears anything in that sea it hears her. So
   * either this feed genuinely does not carry her, or it does and we are not
   * recognising her.
   *
   * The second is very much possible: sixty-one MMSIs were read off another
   * site and typed in by hand, and a wrong one fails silently for ever — the
   * board simply tracks nobody, or worse, tracks a stranger. Nothing so far
   * could tell the two apart.
   *
   * This can, because AIS carries the vessel's NAME as well as her number. It
   * watches the live feed and reports two things:
   *
   *   - which of the silent MMSIs turned up at all
   *   - any vessel on the feed broadcasting one of OUR names under a number
   *     that is not the one in our records
   *
   * The second is the answer to a typo, and it names the correction.
   */
  Ais.chase = function (seconds, onProgress, onDone) {
    var wanted = {};        // mmsi we have never heard -> yacht
    var byName = {};        // normalised name -> yacht
    var vessels = window.Store.vessels || [];
    for (var i = 0; i < vessels.length; i++) {
      var y = vessels[i].yacht;
      if (!vessels[i].firstHeardAt) wanted[String(y.mmsi)] = y;
      var key = normaliseName(y.name);
      if (key) byName[key] = y;
    }

    var found = {};         // mmsi -> messages, for the silent ones
    var impostors = {};     // ourMmsi + '|' + feedMmsi -> { name, feedMmsi, yacht, n }
    var total = 0;
    var startedAt = Date.now();
    var stopped = false;

    Ais.observer = function (mmsi, payload) {
      total++;
      if (wanted[mmsi]) {
        found[mmsi] = (found[mmsi] || 0) + 1;
        return;
      }
      // A name we know, arriving under a number we do not. Checked only for
      // MMSIs that are not ours at all, so a vessel reporting normally never
      // registers here.
      var meta = payload && payload.MetaData;
      var name = meta && normaliseName(meta.ShipName);
      if (!name || !byName[name]) return;
      if (window.Store.byMmsi[mmsi]) return;      // already one of ours, fine
      var yacht = byName[name];
      var k = yacht.mmsi + '|' + mmsi;
      if (!impostors[k]) {
        impostors[k] = { name: yacht.name, ourMmsi: String(yacht.mmsi), feedMmsi: mmsi, n: 0 };
      }
      impostors[k].n++;
    };

    var tick = setInterval(function () {
      if (stopped) return;
      var elapsed = (Date.now() - startedAt) / 1000;
      if (elapsed >= seconds) { finish(); return; }
      if (onProgress) {
        onProgress({
          elapsed: Math.round(elapsed), seconds: seconds, total: total,
          found: Object.keys(found).length, named: Object.keys(impostors).length
        });
      }
    }, 1000);

    function report() {
      return {
        seconds: Math.round((Date.now() - startedAt) / 1000),
        total: total,
        silent: Object.keys(wanted).length,
        found: Object.keys(found).map(function (m) {
          return { mmsi: m, name: wanted[m].name, n: found[m] };
        }),
        impostors: Object.keys(impostors).map(function (k) { return impostors[k]; })
          .sort(function (a, b) { return b.n - a.n; })
      };
    }

    function release() {
      stopped = true;
      clearInterval(tick);
      Ais.observer = null;
    }

    function finish() {
      if (stopped) return;
      release();
      if (onDone) onDone(report());
    }

    // Returns what it has. Stopping a five-minute watch after four is not a
    // reason to throw away four minutes of answer — and it is what lets a test
    // drive the observer by hand and then read the result.
    return function cancel() {
      if (stopped) return null;
      release();
      return report();
    };
  };

  /**
   * A name as it can be compared.
   *
   * AIS pads names to twenty characters with '@', and yards, brokers and
   * registries disagree about spacing and punctuation — "LADY M II" against
   * "Lady M. II". Case, padding and everything that is not a letter or a digit
   * come out, which is the same treatment portNamed() gives a port.
   */
  function normaliseName(raw) {
    if (!raw) return '';
    return String(raw).replace(/@+$/, '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  Ais._normaliseName = normaliseName;   // for tests

  /* --- Why is only part of the fleet reporting? ----------------------------- */

  /**
   * A different question from "why is nothing arriving", and it needs a
   * different test.
   *
   * When some of the fleet reports and most does not, the first probe hears
   * something and stops — by design, because for the original question one
   * answer settles it. So the comparisons that matter here never run at all.
   *
   * These run to completion and compare. Each listens long enough to mean
   * something: a yacht alongside broadcasts every three minutes, so a
   * twelve-second window proves nothing about her, and the whole run takes about
   * ten minutes. There is no shortcut — that is how often the vessels speak.
   */
  Ais.COVERAGE_SECONDS = 180;

  Ais.diagnoseCoverage = function (apiKey, fleetMmsis, missingMmsis, onStep) {
    var fleet = fleetMmsis.map(String);
    var missing = missingMmsis.map(String);
    // A deliberately short list. If a long one is the problem, a short one is
    // the control that shows it.
    var shortList = missing.slice(0, 20);

    /**
     * The first probe is the control, and it matters more than it looks.
     *
     * Without it this trusted the caller's list of silent vessels and compared a
     * short list against nothing — so a server honouring its filter perfectly
     * well still got blamed for the list length. The comparison has to be made
     * inside one run, in the same conditions: the full fleet list against a
     * short one, over the same window.
     */
    var probes = [
      { name: 'the full fleet list, exactly as the board subscribes',
        filter: fleet, box: [[[-90, -180], [90, 180]]] },
      { name: shortList.length + ' of the silent vessels, on a short list',
        filter: shortList, box: [[[-90, -180], [90, 180]]] },
      { name: 'everything, no MMSI filter at all',
        filter: null, box: [[[-90, -180], [90, 180]]] },
      { name: 'everything, bounding box the other way round',
        filter: null, box: [[[-180, -90], [180, 90]]] }
    ];

    var results = [];
    var socket = null, timer = null, cancelled = false;

    function step(i) {
      if (cancelled) return;
      if (i >= probes.length) { finish(); return; }
      var probe = probes[i];
      var result = {
        name: probe.name, frames: 0, ours: {}, missingFound: {},
        opened: false, error: null, seconds: 0
      };
      var began = Date.now();
      results.push(result);
      onStep({ running: probe.name, index: i, total: probes.length, results: results });

      try { socket = new WebSocket(window.CONFIG.ais.endpoint); }
      catch (e) { result.error = 'could not open a socket'; step(i + 1); return; }

      var done = false;
      function moveOn() {
        if (done) return;
        done = true;
        result.seconds = Math.round((Date.now() - began) / 1000);
        clearTimeout(timer);
        if (socket) {
          socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
          try { socket.close(); } catch (e) {}
          socket = null;
        }
        step(i + 1);          // every probe runs; nothing stops early
      }

      socket.onopen = function () {
        result.opened = true;
        var sub = { APIKey: apiKey, BoundingBoxes: probe.box };
        if (probe.filter) sub.FiltersShipMMSI = probe.filter;
        socket.send(JSON.stringify(sub));
      };
      receive(socket, function (payload, problem) {
        result.frames++;
        if (problem) return;
        var complaint = serverComplaint(payload);
        if (complaint) { result.error = complaint; moveOn(); return; }
        var meta = payload.MetaData || {};
        var mmsi = meta.MMSI != null ? String(meta.MMSI) : null;
        if (!mmsi) return;
        if (fleet.indexOf(mmsi) !== -1) result.ours[mmsi] = true;
        if (missing.indexOf(mmsi) !== -1) result.missingFound[mmsi] = true;
        onStep({ running: probe.name, index: i, total: probes.length, results: results });
      });
      socket.onerror = function () { result.error = result.error || 'the connection failed'; };
      socket.onclose = function () { moveOn(); };

      timer = setTimeout(moveOn, Ais.COVERAGE_SECONDS * 1000);
    }

    /**
     * Enough of a difference to mean something.
     *
     * Nine against seven, out of sixty-one, in one three-minute sample of world
     * traffic, is noise — and a plain `>` read it as a finding and named the
     * bounding box. A cause that only shows up as a couple of vessels either way
     * has not been demonstrated; a real one shows up as a gulf.
     */
    /**
   * Appended to any verdict that blames the MMSI filter.
   *
   * It used to be the finding and the fix in one. It is now only the finding:
   * the board stopped filtering after a day of real running said the same
   * thing. Without this line the report reads as a job to do, and somebody
   * spends an afternoon making a change that is already in the file.
   */
  var ALREADY_UNFILTERED = '\n\nThe board no longer sends that filter — it ' +
    'takes the whole feed and picks this fleet out of it. So this is a ' +
    'confirmation, not something left to do.';

  function materiallyMore(a, b) {
      return a >= b + 5 && a >= b * 1.5;
    }

    function finish() {
      var n = function (r) { return r ? Object.keys(r.missingFound).length : 0; };

      /**
       * Whether this run can distinguish anything at all.
       *
       * The stages run one after another, not together, so each samples a
       * DIFFERENT three minutes — and a yacht at rest speaks once every three.
       * Which vessels turn up in a given window is close to a coin toss, and two
       * consecutive runs of this test disagreed by a factor of nine on the same
       * stage. Comparing counts across separately sampled windows is not a
       * controlled experiment, and small differences between them mean nothing
       * whatsoever.
       *
       * So when the numbers are this thin, the honest answer is that the test
       * cannot tell — not a winner picked from noise.
       */
      var biggest = Math.max(n(full), n(shortRun), n(unfiltered), n(reversed));
      if (biggest > 0 && biggest < 5) {
        onStep({ done: true, results: results, verdict:
          'Too few to tell. The most any stage found was ' + biggest +
          ' of the silent vessels, and the stages run one after another rather ' +
          'than together — each samples a different three minutes, and a yacht ' +
          'at rest speaks once every three. Differences this small are the ' +
          'sampling, not a cause.\n\n' +
          'This test cannot answer the question at these numbers. What can: leave ' +
          'the board running and watch "heard since" over a few hours. That ' +
          'measures the thing you actually care about, over a window long enough ' +
          'for the vessels\' own timing to average out.' });
        return;
      }
      var full = results[0], shortRun = results[1];
      var unfiltered = results[2], reversed = results[3];
      var verdict;

      if (shortRun && materiallyMore(n(shortRun), n(full))) {
        verdict = 'A short list of ' + shortList.length + ' found ' + n(shortRun) +
          ' of the silent vessels in ' + shortRun.seconds + ' seconds. The full list ' +
          'of ' + fleet.length + ', over the same window and in the same conditions, ' +
          'found ' + n(full) + '.\n\nThey are transmitting, and the only difference ' +
          'between the two requests was the length of the MMSI list. A subscription ' +
          'filtering ' + fleet.length + ' vessels is not being honoured in full.' +
          ALREADY_UNFILTERED;
      } else if (unfiltered && materiallyMore(n(unfiltered), n(full))) {
        verdict = 'With no MMSI filter at all, ' + n(unfiltered) + ' of the silent ' +
          'vessels came through; with the full list, ' + n(full) + '. They are ' +
          'transmitting and the filter is dropping them — not the key, not the box.' +
          ALREADY_UNFILTERED;
      } else if (reversed && materiallyMore(n(reversed), n(unfiltered))) {
        verdict = 'The reversed bounding box heard ' + n(reversed) + ' of the silent ' +
          'vessels where ours heard ' + n(unfiltered) + '. The server reads the box ' +
          '[longitude, latitude] and the board sends [latitude, longitude], so ' +
          'anything outside the overlap has been invisible.';
      } else if (n(full) > 0) {
        /**
         * The board's own MMSI list found them, and quickly. The one thing this
         * stage does NOT send that the live feed does is FilterMessageTypes — so
         * that is the only difference left between a subscription that delivers
         * these vessels and one that has not delivered them all day.
         */
        verdict = n(full) + ' vessels the board has never heard from reported within ' +
          full.seconds + ' seconds, on the board\'s own MMSI list.\n\n' +
          'That list is not the problem, and neither is the key, the box or the ' +
          'network. The one thing this test does not send that the live feed does ' +
          'is FilterMessageTypes — the board asks for five message types, this ' +
          'asked for all of them. That is the only difference left between a ' +
          'subscription that delivers these vessels in three minutes and one that ' +
          'has not delivered them in a day.';
      } else {
        var minutes = Math.max(1, Math.round(probes.length * Ais.COVERAGE_SECONDS / 60));
        var seen = unfiltered ? Object.keys(unfiltered.ours).length : 0;
        verdict = 'Across about ' + minutes + ' minute' + (minutes === 1 ? '' : 's') +
          ', including ' + (unfiltered ? unfiltered.frames : 0) +
          ' frames of unfiltered world traffic, not one of the silent vessels ' +
          'appeared' + (seen ? ' (' + seen + ' of the fleet did)' : '') + '.\n\n' +
          'They are not being filtered out — they are not being received. AIS is ' +
          'heard from shore, so a yacht beyond about 40 nautical miles, alongside ' +
          'in a shed, or with her transponder off is simply not in this feed. ' +
          'That is worth checking against where you know they actually are.';
      }
      onStep({ done: true, verdict: verdict, results: results });
    }

    step(0);
    return function cancel() {
      cancelled = true;
      clearTimeout(timer);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try { socket.close(); } catch (e) {}
        socket = null;
      }
    };
  };

  /* --- Finding out why nothing is arriving --------------------------------- */

  /**
   * A green pill and no vessels has several possible causes that look identical
   * from outside: a rejected key, a subscription the server did not like, a
   * fleet that is genuinely all out of range, or a bounding box the server reads
   * differently from the way we wrote it.
   *
   * That last one is not paranoia. AISstream's own examples disagree with each
   * other about the axis order — the Go, Java and Dart ones send
   * [[-90,-180],[90,180]] and call it "the entire world", while the JavaScript,
   * TypeScript and Rust ones send [[-180,-90],[180,90]] — and the published
   * schema says only "an array of two numbers". One of those is our whole-world
   * box and the other has a latitude of -180 in it.
   *
   * So rather than argue, ask the server. Each probe subscribes for a few
   * seconds and counts what comes back; the first that hears anything at all
   * tells you which layer the problem is in. Nothing here is applied to the
   * board — it is a question, not a feed.
   */
  var PROBES = [
    { name: 'your fleet, as the board subscribes',
      box: [[[-90, -180], [90, 180]]], filtered: true },
    { name: 'every vessel, same bounding box',
      box: [[[-90, -180], [90, 180]]], filtered: false },
    { name: 'every vessel, bounding box the other way round',
      box: [[[-180, -90], [180, 90]]], filtered: false }
  ];

  Ais.SECONDS_PER_PROBE = 12;

  /**
   * Runs the probes in order and reports as it goes. Returns a cancel function.
   * `onStep(result)` gets { name, heard, matched, error, done } per probe, and
   * one final call with `verdict` set.
   */
  Ais.diagnose = function (apiKey, mmsiList, onStep) {
    var list = mmsiList.map(String);
    var results = [];
    var socket = null;
    var timer = null;
    var cancelled = false;

    /**
     * A connection that opened and then ended early, read by its close code.
     *
     * 1006 is not a rejection. It means the connection ended with no close
     * frame at all — nobody said goodbye — and that is what a middlebox does
     * when it cuts a stream it has decided it does not like. A server turning
     * down a key normally closes properly, with 1008 and often a reason. Calling
     * 1006 "a rejected key" is a guess dressed as a finding, which is what the
     * first version of this did.
     */
    function describeHangUp(r) {
      var code = r.closed.code;
      var when = 'The connection opened and then ended after ' + r.seconds + ' seconds';

      if (r.closed.reason) {
        return when + ', and the server said why: "' + r.closed.reason + '". ' +
          'That is its own explanation — take it at face value.';
      }
      if (code === 1006 || code === 1005) {
        return when + ' with no close frame at all (code ' + code + '). Nobody ' +
          'said goodbye, which is characteristic of something between this ' +
          'browser and aisstream.io cutting the connection — a corporate ' +
          'firewall, a TLS-inspecting proxy, or antivirus that allows the ' +
          'handshake and then kills the stream. A server refusing a key usually ' +
          'closes properly and says so.\n\n' +
          'The way to tell: run this again on a different network — a phone ' +
          'hotspot is ideal. If it works there, the key is fine and the office ' +
          'network is the problem. If it fails the same way, it is the key or ' +
          'the account, and aisstream.io can say which.';
      }
      if (code === 1013 || code === 1008) {
        return when + ' and the server closed it deliberately (code ' + code + '). ' +
          (code === 1008
            ? 'That code means policy — a key it will not serve, most likely.'
            : 'That code means "try again later" — capacity or a rate limit, not ' +
              'anything wrong at this end.');
      }
      return when + ' with close code ' + code + ', and no reason given.';
    }

    function finish() {
      var verdict;
      var first = results.filter(function (r) { return r.heard > 0; })[0];
      var rejected = results.filter(function (r) { return r.error; })[0];
      var never = results.filter(function (r) { return !r.opened; })[0];
      // `never` is checked before anything the server might have said, because
      // a socket that never opened cannot have been answered by a server.
      // A socket the server hung up on well before the probe was due to end.
      var hungUp = results.filter(function (r) {
        return r.opened && r.closed && r.seconds < Ais.SECONDS_PER_PROBE - 1;
      })[0];

      var unreadable = results.filter(function (r) {
        return r.heard > 0 && r.unreadable === r.heard;
      })[0];

      if (unreadable) {
        verdict = 'The server is sending plenty — ' + unreadable.heard + ' frames in ' +
          unreadable.seconds + ' seconds — and not one of them could be read. ' +
          'The key is fine, the network is fine and the subscription is fine. ' +
          'This is a decoding fault at this end, and the board will stay empty ' +
          'until it is fixed.';
      } else if (never) {
        verdict = 'The socket never opened, so nothing was ever asked for. That is ' +
          'the network in front of you, not aisstream.io: a published page blocks ' +
          'outbound sockets outright, and so do some office firewalls. Try the ' +
          'downloaded file on a machine that can reach the internet directly.';
      } else if (rejected) {
        verdict = 'The server rejected the subscription: "' + rejected.error +
          '". Nothing will arrive until that is resolved — most often it is the key.';
      } else if (hungUp) {
        verdict = describeHangUp(hungUp);
      } else if (!first) {
        verdict = 'The connection stayed open for the full ' + Ais.SECONDS_PER_PROBE +
          ' seconds on every probe and the server sent nothing at all — not even ' +
          'for a request covering every vessel on earth, which in ' +
          Ais.SECONDS_PER_PROBE + ' seconds should be thousands of messages.\n\n' +
          'That rules out most of the obvious things. It is not your fleet being ' +
          'quiet, it is not the bounding box, and it is not the network: a ' +
          'connection that survives the full run is one nothing is cutting. The ' +
          'subscription was accepted — a malformed one gets closed — and then no ' +
          'data was served against it.\n\n' +
          'What is left is at their end, not this one: a key that is not yet ' +
          'active on the account, or another screen already connected on the same ' +
          'key. That second one is worth ruling out by closing every other window ' +
          'showing the fleet and running this again — a per-key connection limit ' +
          'is common and would look exactly like this, though aisstream.io does ' +
          'not document one either way. If neither, the subscription below is ' +
          'exactly what was sent — worth putting to aisstream.io support with the ' +
          'account, since nothing here can make them serve it.';
      } else if (results[0] && results[0].matched > 0) {
        verdict = 'Your fleet is reporting — ' + results[0].matched + ' message' +
          (results[0].matched === 1 ? '' : 's') + ' in ' + Ais.SECONDS_PER_PROBE +
          ' seconds. If the board still looks empty the fault is after the feed, ' +
          'not in it.';
      } else if (first === results[0]) {
        verdict = 'The feed is working and the filter is right, but none of your ' +
          '61 came past in ' + Ais.SECONDS_PER_PROBE + ' seconds. AIS is received ' +
          'from shore, so a yacht offshore or with her transponder off simply is ' +
          'not there. Leave it running: they arrive as they arrive.';
      } else if (first === results[1]) {
        /**
         * Traffic without the filter, none with it. Two quite different causes
         * look identical here: the filter is not matching, or your yachts
         * simply did not transmit in those few seconds. Saying "the filter is
         * broken" would be a confident answer to a question this probe has not
         * asked.
         *
         * The one thing that does separate them: whether an unfiltered probe
         * heard one of ours. If it did, the filter is at fault beyond doubt. If
         * it did not, that is weak evidence either way — sixty-one particular
         * yachts in a few seconds of world traffic is a thin sample — so say so.
         */
        if (results[1].matched > 0) {
          verdict = 'One of your vessels came through on the unfiltered probe but ' +
            'not on the filtered one, so the MMSI filter is at fault — not the key ' +
            'and not the bounding box.';
        } else {
          verdict = 'The feed is delivering, but nothing for your fleet either way. ' +
            'Most likely they are simply not transmitting in range right now, which ' +
            'is ordinary. It could also be the MMSI filter, and these few seconds ' +
            'cannot tell the two apart. Leave the board running for an hour: if ' +
            'nothing has arrived by then, the filter is the place to look.';
        }
      } else {
        verdict = 'Traffic arrives only with the bounding box written the other ' +
          'way round. The server reads it [longitude, latitude]; the board sends ' +
          '[latitude, longitude]. That is the bug, and it is a one-line fix.';
      }
      onStep({ verdict: verdict, results: results, done: true });
    }

    function step(i) {
      if (cancelled) return;
      if (i >= PROBES.length) { finish(); return; }
      var probe = PROBES[i];
      /**
       * The lifecycle, not just the count.
       *
       * The first version of this recorded only `heard` and `error`, which
       * collapsed three quite different answers into one: a socket that never
       * opened, one the server accepted and then closed on the spot, and one
       * that stayed open and said nothing for twelve seconds. All three came
       * back "0 heard, no error", and the verdict blamed the key — which is
       * right for at most one of them.
       */
      var result = {
        name: probe.name, heard: 0, matched: 0,
        // `error` is what the SERVER said, in its own words. A transport failure
        // is not the server saying anything, and keeping the two in one field
        // made a socket that never opened report as a rejected key.
        error: null, failed: false, unreadable: 0,
        opened: false, closed: null, seconds: 0, sent: null
      };
      var began = Date.now();
      results.push(result);
      onStep({ running: probe.name, index: i, total: PROBES.length, results: results });

      try {
        socket = new WebSocket(window.CONFIG.ais.endpoint);
      } catch (e) {
        result.error = 'could not open a socket';
        step(i + 1);
        return;
      }

      var moveOn = function () {
        result.seconds = Math.round((Date.now() - began) / 100) / 10;
        clearTimeout(timer);
        if (socket) {
          socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
          try { socket.close(); } catch (e) {}
          socket = null;
        }
        // A probe that heard something has answered the question; the rest
        // would only confirm it.
        if (result.heard > 0 || result.error) { finish(); return; }
        // A socket that never opened will not open on the next probe either.
        if (!result.opened) { finish(); return; }
        step(i + 1);
      };

      socket.onopen = function () {
        result.opened = true;
        var sub = { APIKey: apiKey, BoundingBoxes: probe.box };
        if (probe.filtered) sub.FiltersShipMMSI = list;
        socket.send(JSON.stringify(sub));
        // Exactly what went up, with the key masked. When the server accepts a
        // subscription and then serves nothing, the next question is always
        // "what did you actually send?" — and this answers it without anyone
        // having to open developer tools, or paste a live credential to support.
        result.sent = JSON.stringify(Object.assign({}, sub, {
          APIKey: apiKey.slice(0, 4) + '…' + apiKey.slice(-4),
          FiltersShipMMSI: sub.FiltersShipMMSI
            ? [sub.FiltersShipMMSI.length + ' MMSIs, e.g. ' + sub.FiltersShipMMSI[0]]
            : undefined
        }));
      };
      receive(socket, function (payload, problem) {
        // `heard` counts frames off the wire, before anything is understood
        // about them. It used to count only frames that parsed, which meant a
        // probe watching five thousand undecodable frames go past reported
        // "0 heard" — and sent everybody looking at the key and the network.
        result.heard++;
        if (problem) { result.unreadable++; return; }
        var complaint = serverComplaint(payload);
        if (complaint) { result.error = complaint; moveOn(); return; }
        var meta = payload.MetaData || {};
        if (meta.MMSI != null && list.indexOf(String(meta.MMSI)) !== -1) result.matched++;
        onStep({ running: probe.name, index: i, total: PROBES.length, results: results });
      });
      socket.onerror = function () { result.failed = true; };
      socket.onclose = function (event) {
        // 1006 means the connection died without a close frame; anything else is
        // the server deliberately hanging up, and the code and reason are its
        // explanation for doing so.
        result.closed = {
          code: event && event.code != null ? event.code : null,
          reason: event && event.reason ? String(event.reason) : ''
        };
        moveOn();
      };

      timer = setTimeout(moveOn, Ais.SECONDS_PER_PROBE * 1000);
    }

    step(0);

    return function cancel() {
      cancelled = true;
      clearTimeout(timer);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try { socket.close(); } catch (e) {}
        socket = null;
      }
    };
  };

  function handle(payload) {
    Ais.heard++;
    window.Store.heard++;

    var complaint = serverComplaint(payload);
    if (complaint) {
      Ais.lastError = complaint;
      window.Store.setConnection('rejected');
      return;
    }

    var meta = payload.MetaData || {};
    var mmsi = meta.MMSI != null ? String(meta.MMSI) : null;
    if (!mmsi) return;

    // A survey watches the live feed rather than opening a socket of its own.
    // The question it answers is about the traffic already arriving, so taking
    // the feed down to ask it would be absurd.
    if (Ais.observer) Ais.observer(mmsi, payload);

    // The first message of any kind means the subscription was accepted and the
    // feed is delivering. That is a different thing from having heard one of
    // ours, and the board should not claim the second when it only has the first.
    if (window.Store.connection === 'listening') window.Store.setConnection('open');

    /**
     * Now that the whole world arrives, this is the hot path: one hash lookup
     * per message and an early return for the overwhelming majority of them.
     * `indexOf` down a sixty-one-long array would be six thousand string
     * comparisons a second for nothing.
     *
     * Against the STORE's map, not a copy kept here. A second list of our own
     * MMSIs is a second thing to keep in step with a fleet edited in the
     * console — and an empty one would silence the whole board while the pill
     * stayed green, which is the failure this file has already made twice.
     * `Store.byMmsi` is what applyFix consults anyway.
     */
    if (!window.Store.byMmsi[mmsi]) return;
    Ais.matched++;
    window.Store.matched++;

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
        // Class B extended carries identity alongside the fix, which the
        // standard Class B message does not.
        applyPosition(mmsi, body.ExtendedClassBPositionReport, at);
        applyIdentity(mmsi, body.ExtendedClassBPositionReport);
        break;
      case 'ShipStaticData':
        applyStatic(mmsi, body.ShipStaticData);
        applyIdentity(mmsi, body.ShipStaticData);
        break;
      case 'StaticDataReport':
        // Message 24 — how a Class B transponder sends her name and dimensions.
        // Plenty of yachts under 300 GT carry Class B and never send a type 5.
        applyIdentity(mmsi, flattenStaticDataReport(body.StaticDataReport));
        break;
      case 'LongRangeAisBroadcastMessage':
        // Message 27: the low-rate position a Class A sends for long-range and
        // satellite reception. It was not in the old subscription's list of
        // types, and is not in the same shape as the others — its own "not
        // available" codes, and no heading at all.
        applyLongRange(mmsi, body.LongRangeAisBroadcastMessage, at);
        break;
    }
  }

  function applyPosition(mmsi, report, at) {
    if (!report) return;
    // The decoder marks a message it could not trust. Nothing good comes of
    // plotting one.
    if (report.Valid === false) return;
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
      // Class B position reports carry no navigational status at all; the store
      // falls back to speed, which is why that fallback exists.
      navStatus: report.NavigationalStatus != null ? report.NavigationalStatus : null,
      // True where the sender has a differential fix (better than 10 m), false
      // where it is plain GNSS. It is the transponder's own claim, not a
      // measurement, but it is the only quality signal AIS carries.
      accurate: typeof report.PositionAccuracy === 'boolean' ? report.PositionAccuracy : null,
      // Receiver Autonomous Integrity Monitoring: the fix was sanity-checked
      // against redundant satellites.
      raim: typeof report.Raim === 'boolean' ? report.Raim : null,
      // Only ever used for its SIGN. AIS encodes rate of turn as a square-root
      // scale, and whether a decoder hands back the raw byte or degrees per
      // minute is its own business — so "turning to starboard" is safe to say
      // and "turning at 12°/min" is not.
      turning: turnDirection(report.RateOfTurn),
      at: at
    });
  }

  function turnDirection(rot) {
    if (rot == null || rot === ROT_UNAVAILABLE) return null;
    if (rot > 0) return 'starboard';
    if (rot < 0) return 'port';
    return 'steady';
  }

  // Who the transponder says she is, and how she measures herself. Worth having
  // for its own sake, and worth checking against the record: a mistyped MMSI
  // subscribes the board to somebody else's yacht, and this is what catches it.
  /**
   * Message 24 arrives in two halves and nests them.
   *
   * ReportA carries the name; ReportB the call sign, dimensions and ship type.
   * Nothing useful sits at the top level — so handing the message straight to
   * applyIdentity, as this did, read every field as undefined and quietly
   * learned nothing. A transponder sends the halves in separate messages, which
   * is why each is merged rather than replacing what came before.
   */
  function flattenStaticDataReport(report) {
    if (!report) return null;
    var a = report.ReportA || {};
    var b = report.ReportB || {};
    return {
      Valid: report.Valid,
      Name: a.Name,
      CallSign: b.CallSign,
      Dimension: b.Dimension,
      Type: b.ShipType,
      FixType: b.FixType
    };
  }

  // Message 27's sentinels are its own: ITU M.1371 codes speed-not-available as
  // 63 and course-not-available as 511 here, where the ordinary position report
  // uses 102.3 and 360. Reusing the usual constants would have plotted a vessel
  // as doing 63 knots.
  var LR_SOG_UNAVAILABLE = 63;
  var LR_COG_UNAVAILABLE = 511;

  function applyLongRange(mmsi, report, at) {
    if (!report || report.Valid === false) return;
    var lat = report.Latitude, lon = report.Longitude;
    if (lat == null || lon == null) return;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    window.Store.applyFix(mmsi, {
      lat: lat,
      lon: lon,
      cog: report.Cog != null && report.Cog !== LR_COG_UNAVAILABLE ? report.Cog : null,
      sog: report.Sog != null && report.Sog !== LR_SOG_UNAVAILABLE ? report.Sog : null,
      heading: null,                       // message 27 carries none
      navStatus: report.NavigationalStatus != null ? report.NavigationalStatus : null,
      accurate: typeof report.PositionAccuracy === 'boolean' ? report.PositionAccuracy : null,
      raim: typeof report.Raim === 'boolean' ? report.Raim : null,
      turning: null,
      at: at
    });
  }

  function applyIdentity(mmsi, data) {
    if (!data || data.Valid === false) return;
    var dim = data.Dimension || {};
    var loa = dim.A != null && dim.B != null ? dim.A + dim.B : null;
    var beam = dim.C != null && dim.D != null ? dim.C + dim.D : null;
    window.Store.applyIdentity(mmsi, {
      name: clean(data.Name),
      callSign: clean(data.CallSign),
      imo: data.ImoNumber || null,
      shipType: data.Type != null ? data.Type : null,
      fixType: data.FixType != null ? data.FixType : null,
      loa: loa || null,
      beam: beam || null
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
