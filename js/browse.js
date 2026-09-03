/* -----------------------------------------------------------------------------
 * browse.js — a hand on the chart.
 *
 * The board is a screensaver: it decides where to look and you watch. The
 * console is a desk tool, and at a desk you want to wander — drag the chart
 * about, wheel into a marina to see who is in it, wheel back out to find the
 * fleet again. This is that, and only that.
 *
 * Two things it has to get right or it feels wrong rather than merely limited.
 *
 * A drag must not select. A click and a drag begin identically, so a press is
 * only a click if the pointer barely moved and barely any time passed; anything
 * else was somebody moving the map, and firing a selection at the end of it is
 * maddening.
 *
 * And once you have taken hold of the chart, nothing should move it back. The
 * console re-aims on every store change — a fix arriving every few seconds —
 * which would drag the view out from under you while you were reading it. So
 * taking hold sets a flag, and the automatic aiming stands down until you pick
 * a vessel or press Home.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Browse = { held: false };

  // A press shorter and smaller than this is a click, not a drag.
  var CLICK_SLOP_PX = 4;
  var CLICK_SLOP_MS = 400;

  // One wheel notch. Gentle enough to feel continuous on a trackpad, definite
  // enough that a mouse wheel gets somewhere.
  var WHEEL_STEP = 1.0018;
  var KEY_STEP = 1.35;

  var onTake = null;

  /**
   * Wire a canvas for browsing.
   *
   *   onClick(x, y)   a genuine click, in canvas coordinates
   *   onTakeHold()    called the first time the user moves the chart themselves
   */
  Browse.attach = function (canvas, onClick, onTakeHold) {
    onTake = onTakeHold;
    var down = null;
    var dragging = false;

    canvas.addEventListener('mousedown', function (event) {
      if (event.button !== 0) return;
      var rect = canvas.getBoundingClientRect();
      down = { x: event.clientX, y: event.clientY, at: Date.now(),
               ox: event.clientX - rect.left, oy: event.clientY - rect.top };
      dragging = false;
    });

    // On the window, not the canvas: a drag that leaves the chart should keep
    // panning, and let go properly wherever it ends.
    window.addEventListener('mousemove', function (event) {
      if (!down) return;
      var dx = event.clientX - down.x;
      var dy = event.clientY - down.y;
      if (!dragging && Math.hypot(dx, dy) <= CLICK_SLOP_PX) return;

      if (!dragging) {
        dragging = true;
        take();
        canvas.classList.add('dragging');
      }
      window.FleetMap.panBy(event.clientX - down.x, event.clientY - down.y);
      down.x = event.clientX;
      down.y = event.clientY;
    });

    window.addEventListener('mouseup', function (event) {
      if (!down) return;
      var moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      var quick = Date.now() - down.at < CLICK_SLOP_MS;
      var wasDragging = dragging;
      var start = down;
      down = null;
      dragging = false;
      canvas.classList.remove('dragging');
      if (!wasDragging && moved <= CLICK_SLOP_PX && quick && onClick) {
        onClick(start.ox, start.oy);
      }
    });

    canvas.addEventListener('wheel', function (event) {
      // Without this the page scrolls behind the chart, which on a desk tool is
      // never what was meant.
      event.preventDefault();
      take();
      var rect = canvas.getBoundingClientRect();
      // deltaMode 1 is lines rather than pixels; a line is worth about 16 of them.
      var delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      window.FleetMap.zoomAt(event.clientX - rect.left, event.clientY - rect.top,
                             Math.pow(WHEEL_STEP, -delta));
    }, { passive: false });

    canvas.addEventListener('dblclick', function (event) {
      take();
      var rect = canvas.getBoundingClientRect();
      window.FleetMap.zoomAt(event.clientX - rect.left, event.clientY - rect.top,
                             event.shiftKey ? 1 / KEY_STEP : KEY_STEP);
    });

    // Keyboard, for a screen without a mouse to hand. Deliberately not the
    // arrow keys: those belong to whatever has focus.
    document.addEventListener('keydown', function (event) {
      if (isTyping(event.target)) return;
      var canvasRect = canvas.getBoundingClientRect();
      var cx = canvasRect.width / 2, cy = canvasRect.height / 2;
      if (event.key === '+' || event.key === '=') {
        take(); window.FleetMap.zoomAt(cx, cy, KEY_STEP);
      } else if (event.key === '-' || event.key === '_') {
        take(); window.FleetMap.zoomAt(cx, cy, 1 / KEY_STEP);
      }
    });
  };

  // Whether automatic aiming should stand down.
  Browse.hasHold = function () { return Browse.held; };

  // Give the chart back: the next scripted move takes over again.
  Browse.release = function () { Browse.held = false; };

  function take() {
    if (Browse.held) return;
    Browse.held = true;
    if (onTake) onTake();
  }

  function isTyping(node) {
    if (!node) return false;
    var tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
           node.isContentEditable;
  }

  window.Browse = Browse;
})();
