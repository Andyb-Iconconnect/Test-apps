/* -----------------------------------------------------------------------------
 * Pulls yacht photographs down into assets/photos/ and points fleet.js at the
 * local copies.
 *
 *   node tools/fetch-photos.js photos.txt
 *   node tools/fetch-photos.js photos.txt --dry-run
 *   node tools/fetch-photos.js --from-fleet
 *
 * The list is one yacht per line: the vessel's id, whitespace, then the URL.
 * Blank lines and lines starting with # are ignored.
 *
 *   aurelia          https://example.com/press/aurelia-starboard.jpg
 *   silver-meridian  https://example.com/press/silver-meridian.jpg
 *
 * --from-fleet takes the URLs already sitting in fleet.js's `photo` fields
 * instead of a list, which is the tidy way to convert a set of links you have
 * already pasted in.
 *
 * WHY BOTHER, rather than just linking to the photographs where they sit:
 *
 *   - Many image hosts refuse to serve to another site. The board does not show
 *     a broken image when that happens, it quietly falls back to the drawn
 *     profile, so a blocked photo looks like a photo you never added.
 *   - The single-file build exists so the board keeps working when the office
 *     connection does not. A remote image undoes that.
 *   - The published artifact blocks external images outright. Only a local file
 *     — which the build embeds — will appear there.
 *
 * It does not go looking for photographs. You supply the URLs, which means you
 * have decided you are entitled to use each one.
 * -------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PHOTO_DIR = path.join(ROOT, 'assets', 'photos');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const listFile = args.find((a) => !a.startsWith('--'));
const dryRun = flags.has('--dry-run');
const force = flags.has('--force');
const fromFleet = flags.has('--from-fleet');

const EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png',
  'image/webp': '.webp', 'image/avif': '.avif'
};
const MAX_BYTES = 6 * 1024 * 1024;

const FLEET_FILE = path.join(ROOT, 'fleet.js');

// Read the fleet without a browser. Only the data is wanted here; the file
// itself is edited as text, below.
function loadFleet(source) {
  const sandbox = { window: {} };
  require('vm').runInNewContext(source || fs.readFileSync(FLEET_FILE, 'utf8'), sandbox);
  return sandbox.window.FLEET;
}

/**
 * Repoint one vessel's `photo` field, editing the text in place.
 *
 * fleet.js is a hand-written file with a long explanatory header and records
 * formatted for reading. Regenerating it wholesale — which is what the console's
 * save button does, quite correctly, for a file it is handing you fresh — would
 * flatten all of that to change one string. So this finds the field and changes
 * nothing else, and the caller checks the result parses to the same fleet.
 */
function repoint(source, id, value) {
  const start = source.indexOf(`id: '${id}'`);
  if (start === -1) throw new Error(`no record with id '${id}' in fleet.js`);
  // Stop at the next record so a missing field cannot be filled in from it.
  const nextId = source.indexOf("id: '", start + 5);
  const end = nextId === -1 ? source.length : nextId;
  const block = source.slice(start, end);

  const field = /^([ \t]*)photo:[^\n]*?,[ \t]*$/m;
  const quoted = `'${value.replace(/'/g, "\\'")}'`;
  if (field.test(block)) {
    return source.slice(0, start) +
           block.replace(field, (whole, indent) => `${indent}photo: ${quoted},`) +
           source.slice(end);
  }
  // No photo field at all: put one on the line after the id.
  const idLine = /^([ \t]*)id: '[^']*',[ \t]*$/m.exec(block);
  if (!idLine) throw new Error(`could not place a photo field for '${id}'`);
  const at = start + idLine.index + idLine[0].length;
  return source.slice(0, at) + `\n${idLine[1]}photo: ${quoted},` + source.slice(at);
}

// Everything except the photo fields, for comparing before and after.
const withoutPhotos = (fleet) =>
  JSON.stringify(fleet.map((y) => Object.assign({}, y, { photo: null })));

function parseList(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line, i) => {
      const m = /^(\S+)\s+(\S+)$/.exec(line);
      if (!m) throw new Error(`line ${i + 1} is not "<id> <url>": ${line}`);
      return { id: m[1], url: m[2] };
    });
}

async function download(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    // Some hosts serve a placeholder, or nothing, to a bare programmatic
    // request. If one refuses us here it would refuse the board too, which is
    // the whole reason for copying the file down.
    headers: { 'Accept': 'image/avif,image/webp,image/png,image/jpeg,*/*' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) throw new Error(`not an image we can use: content-type ${type || 'missing'}`);

  const body = Buffer.from(await res.arrayBuffer());
  if (!body.length) throw new Error('empty response');
  if (body.length > MAX_BYTES) {
    throw new Error(`${Math.round(body.length / 1024)} KB is too big — resize to about 1600 px wide`);
  }
  return { body, ext, type };
}

async function main() {
  const original = fs.readFileSync(FLEET_FILE, 'utf8');
  const FLEET = loadFleet(original);
  const byId = new Map(FLEET.map((y) => [y.id, y]));

  let wanted;
  if (fromFleet) {
    wanted = FLEET
      .filter((y) => typeof y.photo === 'string' && /^https?:\/\//.test(y.photo))
      .map((y) => ({ id: y.id, url: y.photo }));
    if (!wanted.length) {
      console.log('No remote photo URLs in fleet.js. Nothing to fetch.');
      return;
    }
  } else {
    if (!listFile) {
      console.error('Give me a list file, or --from-fleet. See the notes at the top of this file.');
      process.exitCode = 1;
      return;
    }
    wanted = parseList(listFile);
  }

  const unknown = wanted.filter((w) => !byId.has(w.id));
  if (unknown.length) {
    console.error('Not vessels in fleet.js: ' + unknown.map((u) => u.id).join(', '));
    console.error('Ids in the fleet: ' + FLEET.map((y) => y.id).join(', '));
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const done = [];

  for (const { id, url } of wanted) {
    const existing = fs.readdirSync(PHOTO_DIR).find((f) => f.replace(/\.[^.]+$/, '') === id);
    if (existing && !force) {
      console.log(`  = ${id}: assets/photos/${existing} already here (--force to replace)`);
      done.push({ id, rel: `assets/photos/${existing}` });
      continue;
    }
    try {
      const { body, ext, type } = await download(url);
      const rel = `assets/photos/${id}${ext}`;
      if (!dryRun) {
        if (existing && existing !== `${id}${ext}`) fs.unlinkSync(path.join(PHOTO_DIR, existing));
        fs.writeFileSync(path.join(ROOT, rel), body);
      }
      console.log(`  + ${id}: ${rel}  (${Math.round(body.length / 1024)} KB ${type})`);
      done.push({ id, rel });
    } catch (e) {
      console.error(`  ! ${id}: ${e.message}\n      ${url}`);
      process.exitCode = 1;
    }
  }

  if (!done.length) return;

  // Point the records at the local copies.
  const changed = done.filter(({ id, rel }) => byId.get(id).photo !== rel);
  if (!changed.length) {
    console.log('\nfleet.js already points at these files.');
    return;
  }

  let edited = original;
  changed.forEach(({ id, rel }) => { edited = repoint(edited, id, rel); });

  // The edit is textual, so prove it before writing: the file must still parse,
  // and every field except the photos must be untouched.
  const after = loadFleet(edited);
  if (withoutPhotos(after) !== withoutPhotos(FLEET)) {
    console.error('\nAborted: editing fleet.js changed more than the photo fields. ' +
                  'Nothing was written; set the paths by hand.');
    process.exitCode = 1;
    return;
  }
  const wrong = changed.filter(({ id, rel }) => after.find((y) => y.id === id).photo !== rel);
  if (wrong.length) {
    console.error('\nAborted: ' + wrong.map((w) => w.id).join(', ') +
                  ' did not take the new path. Nothing was written.');
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log(`\n--dry-run: would repoint ${changed.length} record(s) in fleet.js.`);
    return;
  }
  fs.writeFileSync(FLEET_FILE, edited);
  console.log(`\nfleet.js repointed at the local copies (${changed.length} record(s)).`);
  console.log('Rebuild the bundles to embed them: node tools/build-single-file.js --entry=index.html');
}

// Exported so the text surgery above can be tested without going near a network
// or the real fleet file.
module.exports = { repoint, loadFleet };
if (require.main === module) main();
