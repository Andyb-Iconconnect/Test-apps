/* -----------------------------------------------------------------------------
 * photos.js — a photograph per vessel, held in this browser.
 *
 * Linking to a photograph where it already lives turns out not to work: image
 * hosts refuse to serve to another site, and a blocked photo looks exactly like
 * one nobody added. So the console takes the file itself.
 *
 * It is NOT put in the vessel's record. A 1600 px photograph is a third of a
 * megabyte, and base64 in fleet.js is a third bigger again — thirty of those
 * makes a file nobody can open and a bundle over the artifact's size limit. The
 * record keeps a path; the picture lives here, keyed on the vessel's id, and
 * `exportName` says what the file should be called when it is written out to
 * assets/photos/ for good.
 *
 * localStorage is a few megabytes, so images are scaled down on the way in. A
 * quota failure is reported rather than swallowed: a photograph that silently
 * did not save is worse than one that plainly refused.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var KEY = 'fleetwatch.photos.v1';
  var Photos = {};

  // Big enough for a 1080p panel with room to crop, small enough that a fleet
  // of thirty fits in the storage a browser gives a page.
  Photos.MAX_EDGE = 1280;
  Photos.QUALITY = 0.78;

  Photos.load = function () {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return {}; }
    if (!raw) return {};
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) { return {}; }
  };

  function save(map) {
    try {
      localStorage.setItem(KEY, JSON.stringify(map));
      return { ok: true };
    } catch (e) {
      // The name differs between browsers; the code does not.
      var full = e && (e.code === 22 || e.code === 1014 ||
                       e.name === 'QuotaExceededError' ||
                       e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      return { ok: false, full: full, error: e };
    }
  }

  Photos.get = function (id) {
    var map = Photos.load();
    return map[id] || null;
  };

  Photos.has = function (id) { return !!Photos.get(id); };

  Photos.ids = function () { return Object.keys(Photos.load()); };

  Photos.set = function (id, dataUri) {
    var map = Photos.load();
    var previous = map[id];
    map[id] = dataUri;
    var result = save(map);
    if (!result.ok && previous !== undefined) {
      // Put back what was there rather than leaving the store half-changed.
      map[id] = previous;
      save(map);
    } else if (!result.ok) {
      delete map[id];
      save(map);
    }
    return result;
  };

  Photos.remove = function (id) {
    var map = Photos.load();
    if (!(id in map)) return false;
    delete map[id];
    return save(map).ok;
  };

  // Roughly what the store is costing. Base64 is 8 bits of data in 6, hence 3/4.
  Photos.usageBytes = function () {
    var map = Photos.load();
    return Object.keys(map).reduce(function (total, id) {
      return total + Math.round(map[id].length * 0.75);
    }, 0);
  };

  /**
   * What to show for a vessel: her uploaded photograph if there is one,
   * otherwise whatever `photo` in the record points at. The upload wins because
   * it is the more recent, more deliberate act — somebody sat down and chose
   * this file for this boat.
   */
  Photos.resolve = function (yacht) {
    if (!yacht) return null;
    return Photos.get(yacht.id) || yacht.photo || null;
  };

  Photos.exportName = function (id) { return 'assets/photos/' + id + '.jpg'; };

  /* --- Taking a file in ---------------------------------------------------- */

  var TYPES = /^image\/(jpeg|png|webp|avif|gif|bmp)$/i;

  /**
   * Read a file the user chose and hand back a scaled-down JPEG data URI.
   *
   * Rejects with a message worth showing rather than an Error nobody can act
   * on. Uses createImageBitmap where it exists so that a photograph taken on a
   * phone comes out the way up it was taken — EXIF orientation is otherwise
   * quietly ignored and half the fleet ends up on its side.
   */
  Photos.fromFile = function (file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('No file chosen.'));
      if (!TYPES.test(file.type || '')) {
        return reject(new Error('That is not an image this can read. ' +
          'JPEG, PNG or WebP.'));
      }
      if (file.size > 30 * 1024 * 1024) {
        return reject(new Error('That file is over 30 MB. Anything that size is ' +
          'a camera original — export a normal JPEG first.'));
      }

      decode(file).then(function (source) {
        var w = source.width, h = source.height;
        if (!w || !h) throw new Error('That image could not be read.');
        var scale = Math.min(1, Photos.MAX_EDGE / Math.max(w, h));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext('2d');
        // JPEG has no transparency; without this a PNG's clear background
        // comes out black.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        if (source.close) source.close();
        resolve({
          dataUri: canvas.toDataURL('image/jpeg', Photos.QUALITY),
          width: canvas.width,
          height: canvas.height,
          originalWidth: w,
          originalHeight: h
        });
      }).catch(function (e) {
        reject(e instanceof Error ? e : new Error('That image could not be read.'));
      });
    });
  };

  function decode(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return viaImageElement(file); });
    }
    return viaImageElement(file);
  }

  function viaImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That image could not be read.'));
      };
      img.src = url;
    });
  }

  // "412 KB", for telling somebody what their photographs are costing.
  Photos.formatBytes = function (bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  window.Photos = Photos;
})();
