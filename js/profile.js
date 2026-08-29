/* -----------------------------------------------------------------------------
 * profile.js — a drawn side profile of a vessel, from her own record.
 *
 * These are illustrations, not photographs. Nothing here pretends to be a
 * likeness: the hull, the number of deck levels and the rig come from length,
 * tonnage and whether she is motor or sail, so an 88 m four-deck motor yacht
 * and a 45 m sloop are visibly different things — but the drawing is generic
 * by design. It stands in the photo slot until a real photograph is dropped in;
 * set `photo` on a vessel in fleet.js and that wins.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var Profile = {};

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function round(n) { return Math.round(n * 10) / 10; }

  // Build a path from an array of [x, y] pairs.
  function poly(points, close) {
    var d = points.map(function (p, i) {
      return (i ? 'L ' : 'M ') + round(p[0]) + ' ' + round(p[1]);
    }).join(' ');
    return close ? d + ' Z' : d;
  }

  // How many levels sit on the hull. Tonnage is the better guide than length —
  // volume is what decks are — with length as a sanity check.
  function deckLevels(yacht) {
    var gt = yacht.grossTonnage || 0;
    var loa = yacht.loa || 0;
    var levels = gt >= 2200 ? 4 : gt >= 900 ? 3 : gt >= 350 ? 2 : 1;
    if (loa >= 70) levels = Math.max(levels, 3);
    if (loa <= 40) levels = Math.min(levels, 2);
    return Math.max(1, Math.min(4, levels));
  }

  // Bigger yachts draw larger in the frame, so the fleet reads at a glance.
  // Referenced to a nominal 100 m rather than to the fleet, so adding a vessel
  // never rescales everybody else's picture. Applied to BOTH axes: scaling x
  // alone squashes a 40 m yacht into a tall, narrow caricature of herself.
  function lengthFraction(loa) {
    if (!loa) return 0.82;
    return Math.max(0.72, Math.min(1, 0.72 + (loa / 100) * 0.28));
  }

  Profile.isSail = function (yacht) {
    return (yacht.prefix || '').toUpperCase().indexOf('S') === 0;
  };

  /* --- Motor yacht --------------------------------------------------------- */

  // Bow is to the RIGHT, so x increases forward.
  //
  // Deck levels on a motor yacht do not stack symmetrically. The forward faces
  // sit almost above one another — that is the bridge front, raked slightly
  // forward as it steps down — while the after edges march a long way forward
  // with each level, opening the aft decks. Inset a tier evenly at both ends
  // and you draw a wedding cake; step it this way and you draw a yacht.
  var MOTOR_DECKS = [
    { aft: 0.155, fwd: 0.790, height: 48 },
    { aft: 0.265, fwd: 0.775, height: 42 },
    { aft: 0.385, fwd: 0.755, height: 36 },
    { aft: 0.500, fwd: 0.715, height: 31 }
  ];

  // A one- or two-deck yacht carries a shorter house on the same hull. Left at
  // the full-height proportions she reads as a small ferry.
  function decksFor(levels) {
    return MOTOR_DECKS.slice(0, levels).map(function (d, i) {
      if (levels > 2 || i > 0) return d;
      return { aft: d.aft + 0.075, fwd: d.fwd - 0.055, height: d.height - 5 };
    });
  }

  var MOTOR = { transom: 40, stem: 958, bowWater: 906, freeboardAft: 58, freeboardFwd: 92 };

  function motorProfile(g, wl, levels) {
    var m = MOTOR;

    // Sheer: the deck line, rising toward the bow.
    function deckY(x) {
      var t = Math.max(0, Math.min(1, (x - m.transom) / (m.stem - m.transom)));
      return wl - (m.freeboardAft + (m.freeboardFwd - m.freeboardAft) * t * t);
    }

    g.appendChild(el('path', {
      d: 'M ' + m.transom + ' ' + wl +
         ' L ' + m.transom + ' ' + round(deckY(m.transom)) +
         ' C 320 ' + round(deckY(320) - 2) + ', 700 ' + round(deckY(700) - 6) +
         ', ' + m.stem + ' ' + round(deckY(m.stem)) +
         ' L ' + m.bowWater + ' ' + wl + ' Z',
      class: 'p-hull'
    }));

    // Boot top, and the row of hull ports along the lower deck.
    g.appendChild(el('path', {
      d: 'M ' + (m.transom + 6) + ' ' + (wl - 11) + ' L 918 ' + (wl - 13),
      class: 'p-boot'
    }));
    if (levels >= 3) {
      g.appendChild(el('rect', {
        x: 150, y: round(deckY(400) + 20), width: 470, height: 10, rx: 5, class: 'p-window'
      }));
    }

    // One silhouette for the whole superstructure: up the stepped aft faces,
    // forward along the top, then down the raked bridge front.
    var decks = decksFor(levels);
    var aft = [], fwd = [], tops = [], i;
    for (i = 0; i < levels; i++) {
      aft.push(decks[i].aft * 1000);
      fwd.push(decks[i].fwd * 1000);
      tops.push((i ? tops[i - 1] : deckY(aft[0])) - decks[i].height);
    }

    var pts = [[aft[0], deckY(aft[0])]];
    for (i = 0; i < levels; i++) {
      pts.push([aft[i], tops[i]]);
      if (i + 1 < levels) pts.push([aft[i + 1], tops[i]]);
    }
    pts.push([fwd[levels - 1], tops[levels - 1]]);
    for (i = levels - 2; i >= 0; i--) {
      pts.push([fwd[i + 1], tops[i]]);
      pts.push([fwd[i], tops[i]]);
    }
    pts.push([fwd[0], deckY(fwd[0])]);
    g.appendChild(el('path', { d: poly(pts, true), class: 'p-house' }));

    for (i = 0; i < levels; i++) {
      var h = decks[i].height;
      var x0 = aft[i] + 20, x1 = fwd[i] - 26;
      if (x1 - x0 < 20) continue;
      g.appendChild(el('rect', {
        x: round(x0), y: round(tops[i] + h * 0.26), width: round(x1 - x0),
        height: round(h * 0.34), rx: round(h * 0.17), class: 'p-window'
      }));
      // Guard rail along the open deck this level leaves exposed below it.
      if (i > 0) {
        g.appendChild(el('path', {
          d: 'M ' + round(aft[i - 1] + 10) + ' ' + round(tops[i - 1] - 11) +
             ' L ' + round(aft[i] - 6) + ' ' + round(tops[i - 1] - 11),
          class: 'p-rail'
        }));
      }
    }

    // Bulwark along the foredeck.
    g.appendChild(el('path', {
      d: 'M ' + round(fwd[0] + 8) + ' ' + round(deckY(fwd[0]) - 9) +
         ' L 934 ' + round(deckY(934) - 9),
      class: 'p-rail'
    }));

    // Radar mast just abaft the bridge front: a spar, a scanner bar, a dome.
    var mastX = fwd[levels - 1] - 58, mastFoot = tops[levels - 1];
    g.appendChild(el('path', {
      d: 'M ' + round(mastX) + ' ' + round(mastFoot) + ' L ' + round(mastX) + ' ' + round(mastFoot - 48),
      class: 'p-mast'
    }));
    g.appendChild(el('rect', {
      x: round(mastX - 22), y: round(mastFoot - 36), width: 44, height: 6, rx: 3, class: 'p-house'
    }));
    g.appendChild(el('circle', { cx: round(mastX), cy: round(mastFoot - 52), r: 7, class: 'p-house' }));
  }

  /* --- Sailing yacht ------------------------------------------------------- */

  // A sloop's rig is nearly as tall as she is long, so her profile is a tall
  // picture where a motor yacht's is a wide one. She is drawn shorter in the
  // frame to leave the mast room rather than cropping it.
  var SAIL = { transom: 200, stem: 828, bowWater: 800, freeboardAft: 30, freeboardFwd: 50 };

  function sailProfile(g, wl) {
    var s = SAIL;

    function deckY(x) {
      var t = Math.max(0, Math.min(1, (x - s.transom) / (s.stem - s.transom)));
      return wl - (s.freeboardAft + (s.freeboardFwd - s.freeboardAft) * t * t * t);
    }

    // Fin keel and spade rudder: the clearest signal that she sails.
    g.appendChild(el('path', {
      d: poly([[440, wl - 6], [468, wl + 116], [536, wl + 116], [548, wl - 6]], true),
      class: 'p-keel'
    }));
    g.appendChild(el('path', {
      d: poly([[264, wl - 6], [272, wl + 74], [298, wl + 74], [300, wl - 6]], true),
      class: 'p-keel'
    }));

    g.appendChild(el('path', {
      d: 'M ' + s.transom + ' ' + round(wl - 4) +
         ' L ' + (s.transom + 4) + ' ' + round(deckY(s.transom)) +
         ' C 420 ' + round(deckY(420) - 4) + ', 690 ' + round(deckY(690) - 6) +
         ', ' + s.stem + ' ' + round(deckY(s.stem)) +
         ' L ' + s.bowWater + ' ' + round(wl - 4) + ' Z',
      class: 'p-hull'
    }));

    // Low coachroof with a long window band.
    var roofY = deckY(480) - 26;
    g.appendChild(el('path', {
      d: poly([[386, deckY(386) - 2], [412, roofY], [604, roofY], [624, deckY(624) - 2]], true),
      class: 'p-house'
    }));
    g.appendChild(el('rect', {
      x: 424, y: round(roofY + 8), width: 168, height: 10, rx: 5, class: 'p-window'
    }));

    // Rig.
    var mastX = 542, mastFoot = deckY(mastX) - 2, mastTop = wl - 616;
    var boomY = mastFoot - 34;
    g.appendChild(el('path', {
      d: 'M ' + mastX + ' ' + round(mastFoot) + ' L ' + mastX + ' ' + round(mastTop), class: 'p-mast'
    }));
    g.appendChild(el('path', {
      d: 'M ' + mastX + ' ' + round(boomY) + ' L 306 ' + round(boomY + 8), class: 'p-spar'
    }));
    g.appendChild(el('path', {
      d: 'M ' + mastX + ' ' + round(mastTop) + ' L ' + s.stem + ' ' + round(deckY(s.stem)), class: 'p-rigging'
    }));
    g.appendChild(el('path', {
      d: 'M ' + mastX + ' ' + round(mastTop) + ' L ' + (s.transom + 6) + ' ' + round(deckY(s.transom)),
      class: 'p-rigging'
    }));
    [0.34, 0.62].forEach(function (f) {
      var y = mastTop + (mastFoot - mastTop) * f;
      g.appendChild(el('path', {
        d: 'M ' + (mastX - 30) + ' ' + round(y) + ' L ' + (mastX + 30) + ' ' + round(y - 4), class: 'p-spar'
      }));
    });
  }

  /* --- Entry point --------------------------------------------------------- */

  // How much room the drawing needs above and below the waterline, in the same
  // units the two draw functions use. A four-deck motor yacht carries her radar
  // dome a long way up; a sloop's rig goes half as high again.
  function extent(yacht, sail, levels) {
    return sail ? { above: 645, below: 130 } : { above: 120 + levels * 40, below: 20 };
  }

  // The frame is cut to the drawing, not to the panel it goes in. A frame sized
  // to the panel leaves a small yacht marooned in a great deal of sky; cut to
  // the drawing it letterboxes, which costs only sky — the sea is drawn past
  // the frame either way and the panel clips it, so the horizon still reaches
  // the edges. `frame` is what the console asks for to shape its band.
  function frame(yacht) {
    var sail = Profile.isSail(yacht);
    var levels = sail ? 0 : deckLevels(yacht);
    var f = lengthFraction(yacht.loa);
    var ext = extent(yacht, sail, levels);
    var above = ext.above * f, below = ext.below * f;
    var height = above + below + 70 * f;
    return {
      sail: sail, levels: levels, f: f, width: 1000, height: height,
      // A little of the spare room goes under her rather than over: flush to the
      // horizon she looks hauled out.
      waterline: above + (height - above - below) * 0.62
    };
  }

  // Width / height of the drawing's own frame, for a caller sizing a panel.
  Profile.frameAspect = function (yacht) {
    var fr = frame(yacht);
    return fr.width / fr.height;
  };

  Profile.create = function (yacht) {
    var fr = frame(yacht);
    var sail = fr.sail, f = fr.f;
    var VB_W = fr.width, VB_H = fr.height, wl = fr.waterline;

    var svg = el('svg', {
      viewBox: '0 0 ' + VB_W + ' ' + round(VB_H),
      class: 'vessel-profile',
      role: 'img',
      'aria-label': (yacht.prefix || '') + ' ' + yacht.name +
                    ' — drawn profile, not a photograph'
    });

    var seaId = 'sea-' + (yacht.id || Math.random().toString(36).slice(2));
    var defs = el('defs', {});
    var gradient = el('linearGradient', { id: seaId, x1: '0', y1: '0', x2: '0', y2: '1' });
    gradient.appendChild(el('stop', { offset: '0', 'stop-color': 'var(--profile-sea-top)' }));
    gradient.appendChild(el('stop', { offset: '1', 'stop-color': 'var(--profile-sea-bottom)' }));
    defs.appendChild(gradient);
    svg.appendChild(defs);

    svg.appendChild(el('rect', {
      x: -3000, y: round(wl), width: 7000, height: 4000, fill: 'url(#' + seaId + ')'
    }));

    // Scale uniformly about the waterline, so she sits on the water at any size.
    // Scaling x alone squashes a 40 m yacht into a caricature of herself.
    var g = el('g', {
      transform: 'translate(' + round(500 * (1 - f)) + ' ' + round(wl * (1 - f)) +
                 ') scale(' + f + ')'
    });
    svg.appendChild(g);

    if (sail) sailProfile(g, wl);
    else motorProfile(g, wl, fr.levels);

    svg.appendChild(el('path', {
      d: 'M -3000 ' + round(wl) + ' L 4000 ' + round(wl), class: 'p-waterline'
    }));

    return svg;
  };

  window.Profile = Profile;
})();
