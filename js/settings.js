/* -----------------------------------------------------------------------------
 * settings.js — the few settings that belong to this browser rather than to the
 * repository.
 *
 * config.js is committed, and the single-file build deliberately strips the AIS
 * key out of it (tools/build-single-file.js), so that a published board cannot
 * carry a credential to whoever opens it. That is the right call, but it left
 * nowhere at all to put a key: the only way to go live was to edit config.js and
 * rebuild, which the person standing in front of the display cannot do.
 *
 * So the key lives here instead, in localStorage, entered in the running app.
 * It never reaches fleet.js, never reaches a commit, and never reaches the
 * published HTML — it stays in the browser that typed it.
 *
 * The consequence to be honest about: localStorage is per origin. The board and
 * the console published as two separate pages do not share it, so the key is
 * entered once on each.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var KEY = 'fleetwatch.settings.v1';

  var Settings = { listeners: [] };

  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function write(obj) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * The key to use, whatever its source.
   *
   * A key typed into the app wins over one baked into config.js, so that a
   * display can be corrected without a rebuild. Both being empty is the normal
   * state and means demo mode, not an error.
   */
  Settings.aisKey = function () {
    var local = read().aisKey;
    if (local && String(local).trim()) return String(local).trim();
    var cfg = (window.CONFIG && window.CONFIG.aisStreamApiKey) || '';
    return String(cfg).trim();
  };

  // Where the key in force came from, for the wording in the dialog.
  Settings.aisKeySource = function () {
    var local = read().aisKey;
    if (local && String(local).trim()) return 'browser';
    var cfg = (window.CONFIG && window.CONFIG.aisStreamApiKey) || '';
    return String(cfg).trim() ? 'config' : 'none';
  };

  /**
   * The stored key, masked, for display.
   *
   * Shown at all times rather than only inside a diagnostic, because a key that
   * is not a key is invisible behind a password field. One was: the text of an
   * earlier report, pasted from the clipboard and forced past the shape check,
   * while the sheet went on cheerfully saying a key was stored and the board was
   * tracking live. Four characters at each end is enough to recognise your own
   * key and not enough to be worth stealing.
   */
  Settings.maskedKey = function () {
    var key = Settings.aisKey();
    if (!key) return '';
    if (key.length <= 12) return key.replace(/./g, '\u2022');
    return key.slice(0, 4) + '\u2026' + key.slice(-4) + '  (' + key.length + ' characters)';
  };

  // Whether what is stored even looks like an AISstream key: 40 hexadecimal
  // characters. Forcing a save past the warning stays possible, but not silent.
  Settings.aisKeyLooksRight = function () {
    return /^[0-9a-f]{40}$/i.test(Settings.aisKey());
  };

  Settings.setAisKey = function (value) {
    var obj = read();
    var trimmed = String(value == null ? '' : value).trim();
    if (trimmed) obj.aisKey = trimmed; else delete obj.aisKey;
    var ok = write(obj);
    if (ok) notify();
    return ok;
  };

  Settings.onChange = function (fn) { Settings.listeners.push(fn); };

  function notify() {
    Settings.listeners.forEach(function (fn) {
      try { fn(); } catch (e) {}
    });
  }

  /* --- The dialog -------------------------------------------------------- */

  /**
   * Built in JavaScript rather than written into both index.html and
   * console.html, because two copies of the same markup drift apart and the
   * board's copy is the one nobody looks at.
   */
  var dialog = null;

  var countsTimer = null;

  Settings.openAisDialog = function () {
    if (!dialog) dialog = buildDialog();
    refreshDialog();
    renderCounts();
    clearInterval(countsTimer);
    countsTimer = setInterval(renderCounts, 1000);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    var input = dialog.querySelector('#ais-key-input');
    input.value = '';
    input.focus();
  };

  function buildDialog() {
    var d = document.createElement('dialog');
    d.className = 'sheet';
    d.id = 'ais-dialog';
    d.innerHTML =
      '<form method="dialog" id="ais-form" novalidate>' +
        '<header class="sheet-head">' +
          '<h2>Live AIS tracking</h2>' +
          '<button class="sheet-close" id="ais-close" type="button" aria-label="Close">&times;</button>' +
        '</header>' +
        '<div class="sheet-body">' +
          '<p class="sheet-note" id="ais-state"></p>' +
          '<div class="field-pair">' +
            '<label for="ais-key-input">AISstream.io API key</label>' +
            '<input id="ais-key-input" type="password" autocomplete="off" ' +
              'spellcheck="false" placeholder="Paste the key from aisstream.io">' +
            '<p class="field-hint">' +
              'Stored in this browser only. It is never written into fleet.js, ' +
              'never committed, and never carried in the published page — which ' +
              'also means it has to be entered separately on each screen that ' +
              'shows the fleet.' +
            '</p>' +
            '<p class="stored-key" id="ais-stored"></p>' +
            '<p class="field-error" id="ais-key-error" hidden></p>' +
          '</div>' +
          '<p class="sheet-note">' +
            'AIS is received by shore stations, so a yacht much beyond 40 nautical ' +
            'miles offshore stops reporting until she is back in range. There is no ' +
            'history in the feed either: tracks start building from the moment the ' +
            'key goes in.' +
          '</p>' +
          '<div class="ais-check">' +
            '<p class="build-stamp" id="ais-build"></p>' +
            '<p class="sheet-note" id="ais-counts"></p>' +
            '<button class="button-quiet ais-test" id="ais-test" type="button">' +
              'Nothing arriving? Ask the server why' +
            '</button>' +
            '<button class="button-quiet ais-test" id="ais-coverage" type="button">' +
              'Only some of the fleet? Find out why (about 12 minutes)' +
            '</button>' +
            '<pre class="ais-log" id="ais-log" hidden></pre>' +
          '</div>' +
        '</div>' +
        '<footer class="sheet-foot">' +
          '<button class="button-quiet" id="ais-forget" type="button">Remove key</button>' +
          '<button class="button-primary" id="ais-save" type="submit">Save and connect</button>' +
        '</footer>' +
      '</form>';
    document.body.appendChild(d);

    d.querySelector('#ais-close').addEventListener('click', function () { close(d); });
    d.querySelector('#ais-test').addEventListener('click', function () { runDiagnosis(d); });
    d.querySelector('#ais-coverage').addEventListener('click', function () { runCoverage(d); });
    d.querySelector('#ais-forget').addEventListener('click', function () {
      Settings.setAisKey('');
      close(d);
    });
    d.querySelector('#ais-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = d.querySelector('#ais-key-input');
      var error = d.querySelector('#ais-key-error');
      var value = input.value.trim();
      if (!value) {
        show(error, 'Paste a key, or use Remove key to go back to demo mode.');
        return;
      }
      // AISstream issues a 40-character hex key. Checking the shape here turns
      // a silent socket that never opens into an answer given straight away.
      if (!/^[0-9a-f]{40}$/i.test(value)) {
        show(error, 'That does not look like an AISstream key — they are 40 ' +
                    'hexadecimal characters. Saved anyway if you are sure: press ' +
                    'Save again.');
        if (!input.dataset.warned) { input.dataset.warned = '1'; return; }
      }
      Settings.setAisKey(value);
      close(d);
    });
    return d;
  }

  /* --- Asking the server why nothing is arriving --------------------------- */

  var cancelDiagnosis = null;

  /**
   * What the board currently knows about its own feed, in the two numbers that
   * separate the cases a green pill cannot: messages of any kind, and messages
   * for one of ours.
   */
  function renderCounts() {
    if (!dialog) return;
    var node = dialog.querySelector('#ais-counts');
    var ais = window.Ais;
    var store = window.Store;
    if (!ais || !store || store.mode !== 'live') { node.textContent = ''; return; }

    // A test stops the feed for the duration. Its counters then describe a
    // socket that is not running, and reading them as the state of the feed —
    // "1 message received, none for this fleet" — points at a fault that is not
    // there. The result is in the log below, not here.
    if (cancelDiagnosis) {
      node.textContent = 'The feed is stopped while the test runs. ' +
        'Its progress is below; these counts resume when it finishes.';
      return;
    }

    if (ais.lastError) {
      node.textContent = 'The server refused the subscription: "' + ais.lastError + '"';
      return;
    }
    // Store's counters, not the socket's: these run against feedStartedAt, so
    // the count and the duration describe the same stretch of time.
    var heard = store.heard || 0;
    var matched = store.matched || 0;
    if (!heard) {
      node.textContent = 'Connected, and nothing has arrived yet.';
    } else if (heard && store.unreadable === heard) {
      node.textContent = heard + ' messages received and none of them readable — ' +
        'a fault at this end, not at theirs.';
    } else if (!matched) {
      node.textContent = heard + ' message' + (heard === 1 ? '' : 's') +
        ' received, none of them for a vessel in this fleet.';
    } else {
      var r = window.Store.reception();
      node.textContent = heard + ' messages received, ' + matched + ' for this fleet. ' +
        r.heard + ' of ' + r.total + ' vessels heard from' +
        (r.since ? ' in ' + window.Fmt.duration(r.since) : '') + '.' +
        (r.settling
          ? '\nStill assembling — a yacht alongside broadcasts every three ' +
            'minutes, so give it ten before reading anything into a gap.'
          : r.waiting
            ? '\nThe other ' + r.waiting + ' have said nothing. Beyond ten minutes ' +
              'that is out of range or transponder off, not late.'
            : '');
    }
  }

  function runDiagnosis(d) {
    var button = d.querySelector('#ais-test');
    var log = d.querySelector('#ais-log');

    if (cancelDiagnosis) {
      cancelDiagnosis();
      cancelDiagnosis = null;
      button.textContent = 'Nothing arriving? Ask the server why';
      return;
    }

    var key = Settings.aisKey();
    if (!key) {
      log.hidden = false;
      log.textContent = 'No key stored, so there is nothing to test.';
      return;
    }
    var fleet = (window.FLEET || []).map(function (y) { return y.mmsi; });

    log.hidden = false;
    log.textContent = 'Starting…';
    button.textContent = 'Stop';

    // The board's own feed and a probe would be two subscriptions on one key,
    // which some servers refuse. Stand the feed down for the duration.
    var wasLive = window.Store && window.Store.mode === 'live';
    if (wasLive) window.Ais.stop();

    /**
     * Drawn from the results array every time, never accumulated.
     *
     * The first version wrote one line per probe into a list at the moment that
     * probe STARTED — before its socket had opened — and only refreshed it when
     * a message arrived. With no messages, nothing ever refreshed it, so every
     * line read "never opened" while the verdict, computed from the real final
     * state, said the server had connected and hung up. The report contradicted
     * itself, and the half that was stale was the half that looked like evidence.
     */
    function describe(r) {
      if (!r.opened) return r.closed || r.failed ? 'never opened' : 'opening…';
      if (r.closed) {
        return 'opened, then closed after ' + r.seconds + 's' +
          (r.closed.reason ? ' — "' + r.closed.reason + '"'
           : r.closed.code ? ' (code ' + r.closed.code + ')' : '');
      }
      return r.heard + ' heard' +
        (r.unreadable ? ', ' + r.unreadable + ' unreadable' : '') +
        ', ' + r.matched + ' ours' +
        (r.seconds ? ' in ' + r.seconds + 's' : '');
    }

    var PROBES_IN_COVERAGE = 4;

    function render(step) {
      if (step.total) PROBES_IN_COVERAGE = step.total;
      var lines = step.results.map(function (r, i) {
        return '  ' + (i + 1) + '/' + PROBE_COUNT + '  ' + r.name + ' — ' + describe(r);
      });
      var sent = step.results.filter(function (r) { return r.sent; })[0];
      log.textContent = buildLabel() + '\n\n' + (step.done ? '' :
        'Each test listens for ' + window.Ais.SECONDS_PER_PROBE + ' seconds.\n\n') +
        lines.join('\n') +
        (step.done ? '\n\n' + step.verdict : '') +
        (step.done && sent ? '\n\nSubscription sent (key masked):\n  ' + sent.sent : '');
    }

    var PROBE_COUNT = 3;
    cancelDiagnosis = window.Ais.diagnose(key, fleet, function (step) {
      if (step.total) PROBE_COUNT = step.total;
      render(step);
      if (step.done) {
        cancelDiagnosis = null;
        button.textContent = 'Run it again';
        if (wasLive) notify();      // whoever owns the feed restarts it
      }
    });
  }

  /**
   * The longer test, for when part of the fleet reports and the rest does not.
   * Every probe runs to completion — the point is the comparison between them,
   * so stopping at the first that hears something would answer nothing.
   */
  function runCoverage(d) {
    var button = d.querySelector('#ais-coverage');
    var log = d.querySelector('#ais-log');

    if (cancelDiagnosis) {
      cancelDiagnosis();
      cancelDiagnosis = null;
      button.textContent = 'Only some of the fleet? Find out why (about 12 minutes)';
      return;
    }

    var key = Settings.aisKey();
    if (!key) { log.hidden = false; log.textContent = 'No key stored.'; return; }

    var fleet = (window.FLEET || []).map(function (y) { return y.mmsi; });
    var missing = (window.Store.vessels || [])
      .filter(function (v) { return !v.firstHeardAt; })
      .map(function (v) { return v.yacht.mmsi; });

    if (!missing.length) {
      log.hidden = false;
      log.textContent = buildLabel() + '\n\nEvery vessel has been heard from. ' +
        'Nothing to investigate.';
      return;
    }

    log.hidden = false;
    button.textContent = 'Stop';
    var wasLive = window.Store && window.Store.mode === 'live';
    if (wasLive) window.Ais.stop();

    function render(step) {
      var lines = step.results.map(function (r, i) {
        var found = Object.keys(r.missingFound).length;
        var ours = Object.keys(r.ours).length;
        return '  ' + (i + 1) + '/' + PROBES_IN_COVERAGE + '  ' + r.name + '\n' +
          '        ' + r.frames + ' frames, ' + ours + ' of the fleet, ' +
          found + ' of the silent ones' +
          (r.error ? '  — ' + r.error : '') +
          (r.seconds ? '  (' + r.seconds + 's)' : '  — listening…');
      });
      log.textContent = buildLabel() + '\n\n' +
        (step.done ? '' : 'Each stage listens for ' +
          Math.round(window.Ais.COVERAGE_SECONDS / 60) + ' minutes — a yacht ' +
          'alongside only speaks every three.\n\n') +
        lines.join('\n') + (step.done ? '\n\n' + step.verdict : '');
    }

    cancelDiagnosis = window.Ais.diagnoseCoverage(key, fleet, missing, function (step) {
      render(step);
      if (step.done) {
        cancelDiagnosis = null;
        button.textContent = 'Run it again';
        if (wasLive) notify();
      }
    });
  }

  function show(node, text) {
    node.textContent = text;
    node.hidden = false;
  }

  function close(d) {
    clearInterval(countsTimer);
    if (cancelDiagnosis) {
      cancelDiagnosis();
      cancelDiagnosis = null;
      // A test takes the feed down while it runs. Closing the sheet used to
      // cancel the test and leave it down, so the board sat dead until somebody
      // reloaded it — and the sheet had just told them everything was fine.
      notify();
    }
    var log = d.querySelector('#ais-log');
    if (log) { log.hidden = true; log.textContent = ''; }
    d.querySelector('#ais-test').textContent = 'Nothing arriving? Ask the server why';
    d.querySelector('#ais-coverage').textContent =
      'Only some of the fleet? Find out why (about 12 minutes)';
    var error = d.querySelector('#ais-key-error');
    error.hidden = true;
    var input = d.querySelector('#ais-key-input');
    input.value = '';
    delete input.dataset.warned;
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }

  // The date and commit this file was built from, or a note that it is being
  // served from a folder and is therefore whatever is on disk.
  function buildLabel() {
    var stamp = (window.CONFIG && window.CONFIG.buildStamp) || '';
    return stamp ? 'Build ' + stamp : 'Running from a folder, not a build';
  }

  function refreshDialog() {
    dialog.querySelector('#ais-build').textContent = buildLabel();
    var stored = dialog.querySelector('#ais-stored');
    var masked = Settings.maskedKey();
    stored.textContent = masked ? 'Stored: ' + masked : '';
    stored.classList.toggle('wrong', !!masked && !Settings.aisKeyLooksRight());
    var state = dialog.querySelector('#ais-state');
    var forget = dialog.querySelector('#ais-forget');
    var source = Settings.aisKeySource();
    var blocked = window.Store && window.Store.connection === 'blocked';
    if (blocked) {
      state.textContent = 'A key is stored, but the connection to aisstream.io ' +
        'has never opened. That is usually one of two things: the key was ' +
        'rejected, or outbound sockets are not permitted here — a published ' +
        'page blocks them outright, and so do some office networks. Run the ' +
        'board from a folder or from the single file on the machine itself ' +
        'and the same key will connect.';
      forget.hidden = false;
    } else if (source === 'browser') {
      state.textContent = Settings.aisKeyLooksRight()
        ? 'A key is stored in this browser. Paste a different one to replace it.'
        : 'What is stored does not look like an AISstream key \u2014 those are 40 ' +
          'hexadecimal characters. Nothing will arrive until it is replaced.';
      forget.hidden = false;
    } else if (source === 'config') {
      state.textContent = 'A key is baked into config.js. Anything pasted here ' +
        'overrides it on this screen.';
      forget.hidden = true;
    } else {
      state.textContent = 'No key yet, so every position on the board is ' +
        'simulated. A free key from aisstream.io turns that into live tracking.';
      forget.hidden = true;
    }
  }

  window.Settings = Settings;
})();
