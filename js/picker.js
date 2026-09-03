/* -----------------------------------------------------------------------------
 * picker.js — choosing between yachts that are sitting on top of each other.
 *
 * In Port Hercule, Antibes or Palma half a dozen of the fleet can occupy twenty
 * pixels. A click then always lands on whichever marker happens to be nearest,
 * and the ones behind her cannot be reached at all — they are drawn on the
 * chart and yet unselectable, which is worse than not drawing them.
 *
 * So a click on a crowd opens a small list instead of guessing. One vessel
 * under the pointer still selects her directly: a popover for a single choice
 * would be an extra click for nothing.
 *
 * Shared by the board and the console, which both have a chart and both have
 * the same problem.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Picker = {};
  var host = null;
  var onPick = null;
  var dismiss = null;

  // How close two markers must be before a click is treated as ambiguous. A
  // little wider than the marker itself, because the thing being disambiguated
  // is what the eye sees as one blob.
  Picker.RADIUS = 26;

  /**
   * Handle a click on the chart.
   *
   * `select(id)` is called with the chosen vessel's id. Returns true if the
   * click was consumed — by a selection or by opening the list — so the caller
   * can leave its own click handling alone.
   */
  Picker.handleClick = function (x, y, select) {
    Picker.close();

    // A crowd drawn as one disc must open as the crowd it stands for, not as
    // whatever happens to lie within a finger's reach of where you clicked.
    // Otherwise the number on the disc and the length of the list disagree,
    // which is the one thing a count must never do.
    var crowd = window.FleetMap.clusterAt ? window.FleetMap.clusterAt(x, y) : null;
    if (crowd) {
      open(crowd.members.map(function (p) { return { vessel: p.vessel }; }), x, y, select);
      return true;
    }

    var under = window.FleetMap.hitTestAll(x, y, Picker.RADIUS);
    if (!under.length) return false;
    if (under.length === 1) {
      select(under[0].vessel.yacht.id);
      return true;
    }
    open(under, x, y, select);
    return true;
  };

  Picker.isOpen = function () { return !!host; };

  Picker.close = function () {
    if (!host) return;
    if (dismiss) {
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
      dismiss = null;
    }
    if (host.parentNode) host.parentNode.removeChild(host);
    host = null;
    onPick = null;
  };

  function open(under, x, y, select) {
    onPick = select;
    host = document.createElement('div');
    host.className = 'chart-picker';
    host.setAttribute('role', 'listbox');
    host.setAttribute('aria-label', 'Vessels at this position');

    var head = document.createElement('div');
    head.className = 'chart-picker-head';
    head.textContent = under.length + ' vessels here';
    // Alphabetical, so the same crowd always reads the same way round.
    under = under.slice().sort(function (a, b) {
      var an = window.Vessel.publicName(a.vessel.yacht, a.vessel.index);
      var bn = window.Vessel.publicName(b.vessel.yacht, b.vessel.index);
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    host.appendChild(head);

    var list = document.createElement('div');
    list.className = 'chart-picker-list';
    under.forEach(function (hit) {
      list.appendChild(row(hit.vessel));
    });
    host.appendChild(list);

    document.body.appendChild(host);
    position(x, y);

    // Capture, so a click anywhere — including back on the chart — closes this
    // before it is read as a fresh selection.
    dismiss = function (event) {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && host && host.contains(event.target)) return;
      Picker.close();
    };
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('keydown', dismiss, true);
  }

  function row(vessel) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'chart-picker-row';
    button.setAttribute('role', 'option');

    var dot = document.createElement('span');
    dot.className = 'chart-picker-dot';
    var status = vessel.derived && vessel.derived.status;
    dot.style.background = 'var(--status-' +
      (!status || status === 'unknown' ? 'dark' : status) + ')';
    button.appendChild(dot);

    var name = document.createElement('span');
    name.className = 'chart-picker-name';
    // The same public name the chart uses, so anonymous mode is not undone by
    // the act of clicking on something.
    name.textContent = window.Vessel.publicName(vessel.yacht, vessel.index);
    button.appendChild(name);

    if (vessel.yacht.sentinel) {
      var pip = document.createElement('span');
      pip.className = 'chart-picker-sentinel';
      pip.title = 'Sentinel';
      button.appendChild(pip);
    }

    var where = document.createElement('span');
    where.className = 'chart-picker-where';
    where.textContent = window.Fmt.statusLabel(status);
    button.appendChild(where);

    button.addEventListener('click', function () {
      var pick = onPick;
      var id = vessel.yacht.id;
      Picker.close();
      if (pick) pick(id);
    });
    return button;
  }

  // Beside the click, flipped where it would otherwise leave the window. The
  // list is positioned against the viewport rather than the canvas so it is not
  // clipped by the chart's own bounds.
  function position(x, y) {
    var canvas = document.getElementById('chart-canvas');
    var rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    var left = rect.left + x + 14;
    var top = rect.top + y - 12;
    var box = host.getBoundingClientRect();

    if (left + box.width > window.innerWidth - 8) left = rect.left + x - box.width - 14;
    if (top + box.height > window.innerHeight - 8) top = window.innerHeight - box.height - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;

    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(top) + 'px';
  }

  window.Picker = Picker;
})();
