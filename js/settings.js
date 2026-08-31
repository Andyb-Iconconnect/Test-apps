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

  Settings.openAisDialog = function () {
    if (!dialog) dialog = buildDialog();
    refreshDialog();
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
            '<p class="field-error" id="ais-key-error" hidden></p>' +
          '</div>' +
          '<p class="sheet-note">' +
            'AIS is received by shore stations, so a yacht much beyond 40 nautical ' +
            'miles offshore stops reporting until she is back in range. There is no ' +
            'history in the feed either: tracks start building from the moment the ' +
            'key goes in.' +
          '</p>' +
        '</div>' +
        '<footer class="sheet-foot">' +
          '<button class="button-quiet" id="ais-forget" type="button">Remove key</button>' +
          '<button class="button-primary" id="ais-save" type="submit">Save and connect</button>' +
        '</footer>' +
      '</form>';
    document.body.appendChild(d);

    d.querySelector('#ais-close').addEventListener('click', function () { close(d); });
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

  function show(node, text) {
    node.textContent = text;
    node.hidden = false;
  }

  function close(d) {
    var error = d.querySelector('#ais-key-error');
    error.hidden = true;
    var input = d.querySelector('#ais-key-input');
    input.value = '';
    delete input.dataset.warned;
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }

  function refreshDialog() {
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
      state.textContent = 'A key is stored in this browser and the board is ' +
        'tracking live. Paste a different one to replace it.';
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
