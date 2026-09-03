/* -----------------------------------------------------------------------------
 * cluster.js — what to draw when the fleet is standing on its own feet.
 *
 * At fleet zoom the western Mediterranean is a hundred pixels wide and holds a
 * third of the fleet. Drawn one mark each, that is a pile of chevrons with a
 * wind arrow and a speed beside every one of them, and the label layout gives
 * up and prints three names out of fifteen. The board then shows less than it
 * would if it drew nothing at all: you cannot count what is there, you cannot
 * read what is there, and you cannot click what is there.
 *
 * So a crowd is drawn as a crowd — one disc carrying its count, which splits
 * back into vessels as soon as there is room for them. The number is the point:
 * "nine of ours are in the Golfe-Juan / Antibes stretch" is a fact a wall board
 * can state at a glance, and fifteen overlapping arrows never stated it.
 *
 * Two rules keep it honest:
 *   - the selected yacht is never swallowed; you asked for her by name
 *   - a Sentinel yacht inside a crowd still shows gold, because "where are my
 *     out-of-hours customers" must survive the crowd it is asked about
 *
 * Pure geometry, no canvas: the map paints the answer, the tests can read it.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Cluster = {};

  // How close two markers sit before the eye reads them as one blob. A vessel
  // marker is about nine pixels across the middle, so at 26 they are properly
  // overlapping rather than merely near each other.
  Cluster.RADIUS = 26;

  // Two markers side by side are still two readable markers, and collapsing
  // them into a disc reading "2" trades a shape and a heading for a digit.
  // Three is where the pile starts.
  Cluster.MIN = 3;

  /**
   * Group placed vessels into clusters and singles.
   *
   * `placed` is the map's own list: { vessel, x, y, color }. `keepId` names a
   * yacht that must stay a single — the one under the spotlight or selected in
   * the console.
   *
   * Deterministic for a given set of positions: seeds are taken in a fixed
   * order, so the same frame drawn twice groups the same way and a cluster does
   * not shimmer between renders.
   */
  Cluster.group = function (placed, radius, keepId) {
    var r = radius == null ? Cluster.RADIUS : radius;
    var min = Cluster.MIN;
    var singles = [];
    var pool = [];

    for (var i = 0; i < placed.length; i++) {
      var p = placed[i];
      // Held out of the pool entirely rather than pulled back afterwards: a
      // selected yacht must not drag a cluster's centre around with her.
      if (keepId && p.vessel.yacht.id === keepId) singles.push(p);
      else if (p.vessel.derived && p.vessel.derived.discreet) singles.push(p);
      else pool.push(p);
    }

    // A stable order. Screen position first so the seeds run left to right down
    // the chart, then the id, so two yachts at the same pixel never swap.
    pool.sort(function (a, b) {
      if (a.x !== b.x) return a.x - b.x;
      if (a.y !== b.y) return a.y - b.y;
      return a.vessel.yacht.id < b.vessel.yacht.id ? -1 : 1;
    });

    var used = [];
    var clusters = [];

    for (var s = 0; s < pool.length; s++) {
      if (used[s]) continue;
      var group = [pool[s]];
      var index = [s];
      for (var j = s + 1; j < pool.length; j++) {
        if (used[j]) continue;
        if (Math.hypot(pool[j].x - pool[s].x, pool[j].y - pool[s].y) <= r) {
          group.push(pool[j]);
          index.push(j);
        }
      }

      if (group.length >= min) {
        for (var k = 0; k < index.length; k++) used[index[k]] = true;
        clusters.push(build(pool[s], group));
      } else {
        // The others stay in the pool: a seed with one neighbour may well be
        // that neighbour's third member a moment later in the sweep.
        used[s] = true;
        singles.push(pool[s]);
      }
    }

    // A vessel left over on the edge of a crowd belongs to it. Without this she
    // sits alone against the disc with her own name and speed, which reads as
    // "one yacht here, and separately nine" when there are ten.
    //
    // Measured against the SEED, never the running centre. Absorbing against a
    // centre that moves as it absorbs walks the crowd across the chart: on a
    // Mediterranean season this swallowed all sixty-one vessels from Gibraltar
    // to Antalya into a single disc. Every member is within one radius of a
    // point that never moves, so a crowd can never be wider than the eye reads
    // as one blob.
    for (var m = singles.length - 1; m >= 0; m--) {
      var lone = singles[m];
      if (keepId && lone.vessel.yacht.id === keepId) continue;
      if (lone.vessel.derived && lone.vessel.derived.discreet) continue;
      var host = nearestSeed(clusters, lone, r);
      if (!host) continue;
      host.members.push(lone);
      singles.splice(m, 1);
    }

    for (var c2 = 0; c2 < clusters.length; c2++) recentre(clusters[c2]);
    return { clusters: clusters, singles: singles };
  };

  function nearestSeed(clusters, p, r) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < clusters.length; i++) {
      var d = Math.hypot(p.x - clusters[i].seedX, p.y - clusters[i].seedY);
      if (d <= r && d < bestD) { bestD = d; best = clusters[i]; }
    }
    return best;
  }

  function build(seed, members) {
    var c = {
      members: members, seedX: seed.x, seedY: seed.y,
      x: 0, y: 0, r: 0, sentinel: false, underway: 0
    };
    recentre(c);
    return c;
  }

  function recentre(c) {
    var sx = 0, sy = 0;
    var sentinel = false, underway = 0;
    for (var i = 0; i < c.members.length; i++) {
      var p = c.members[i];
      sx += p.x;
      sy += p.y;
      if (p.vessel.yacht.sentinel) sentinel = true;
      if (p.vessel.derived && p.vessel.derived.status === 'underway') underway++;
    }
    c.x = sx / c.members.length;
    c.y = sy / c.members.length;
    c.sentinel = sentinel;
    c.underway = underway;
    c.r = Cluster.radiusFor(c.members.length);
  }

  // Grows with the count, but by the square root: a crowd of twenty must not
  // draw a disc four times the area of a crowd of five and swallow the coast.
  Cluster.radiusFor = function (count) {
    return 11 + Math.min(7, Math.sqrt(Math.max(1, count) - 1) * 2.2);
  };

  window.Cluster = Cluster;
})();
