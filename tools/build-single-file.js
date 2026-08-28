/* -----------------------------------------------------------------------------
 * Bundles the whole board into one self-contained .html file.
 *
 *   node tools/build-single-file.js [out.html] [--offline] [--fragment]
 *
 * Useful when the board has to travel: one file to email, drop on a USB stick,
 * or open straight off disk with no server at all.
 *
 *   --offline       force demo mode and switch the weather lookup off, for
 *                   sandboxes that block outbound requests
 *   --fragment      emit body content only (no doctype/html/head/body), for
 *                   hosts that supply their own document shell
 *   --entry=FILE    which page to bundle (default index.html; console.html for
 *                   the desk tool)
 * -------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const outPath = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'dist', 'fleet-watch.html');

// Which page to bundle. Both entry points share every script and stylesheet
// they need, so the same inliner serves them.
const entryFlag = args.find((a) => a.startsWith('--entry='));
const entry = entryFlag ? entryFlag.split('=')[1] : 'index.html';

const offline = flags.has('--offline');
const fragment = flags.has('--fragment');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Script order matters and is defined once, in index.html. Read it from there
// rather than keeping a second list in sync by hand.
const html = read(entry);
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error(`No <script src> tags found in ${entry}`);

const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);

// A closing script tag inside inlined JS would end the block early. None of our
// source contains one today; guard anyway so a future edit can't break the build.
const guard = (js) => js.replace(/<\/script/gi, '<\\/script');

let config = read('config.js');
if (offline) {
  config = config
    .replace(/(weather: \{\s*\n\s*)enabled: true/, '$1enabled: false')
    .replace(/aisStreamApiKey: '[^']*'/, "aisStreamApiKey: ''");
  if (!/enabled: false/.test(config)) throw new Error('--offline could not disable the weather block');
}

// Fonts are referenced from the stylesheet by relative path, which means
// nothing once the CSS is inlined into a file that may live anywhere. Embed
// them, so the bundle really is one self-contained file.
function inlineFonts(css, cssFile) {
  const cssDir = path.dirname(path.join(ROOT, cssFile));
  return css.replace(/url\(['"]?([^'")]+\.woff2?)['"]?\)/g, (whole, ref) => {
    const file = path.resolve(cssDir, ref);
    if (!fs.existsSync(file)) {
      console.warn(`  ! font not found, left as a URL: ${ref}`);
      return whole;
    }
    const mime = file.endsWith('.woff2') ? 'font/woff2' : 'font/woff';
    return `url(data:${mime};base64,${fs.readFileSync(file).toString('base64')})`;
  });
}

const inlinedStyles = styles
  .map((f) => `<style>\n${inlineFonts(read(f), f)}\n</style>`)
  .join('\n');

const inlinedScripts = scripts.map((f) => {
  const source = f === 'config.js' ? config : read(f);
  return `<script>\n${guard(source)}\n</script>`;
}).join('\n');

// Take the markup between <body> and </body>, minus the script tags we've just
// inlined and the stylesheet link.
let body = html
  .replace(/^[\s\S]*?<body>/, '')
  .replace(/<\/body>[\s\S]*$/, '')
  .replace(/<script src="[^"]+"><\/script>\n?/g, '')
  .trim();

const title = (html.match(/<title>([^<]*)<\/title>/) || [, 'Fleet Watch'])[1];
const note = offline
  ? '<!-- Built with --offline: demo data, no outbound requests. -->\n'
  : '';

let out;
if (fragment) {
  out = `${note}<title>${title}</title>\n${inlinedStyles}\n\n${body}\n\n${inlinedScripts}\n`;
} else {
  const head = html
    .match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<link rel="stylesheet"[^>]*>\n?/g, '')
    .trim();
  out = `<!doctype html>\n<html lang="en">\n<head>\n${note}${head}\n${inlinedStyles}\n</head>\n<body>\n\n${body}\n\n${inlinedScripts}\n\n</body>\n</html>\n`;
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
console.log(`${entry}: ${scripts.length} scripts + ${styles.length} stylesheets inlined -> ` +
            `${path.relative(process.cwd(), outPath)} (${Math.round(out.length / 1024)} KB)` +
            (offline ? ' [offline]' : '') + (fragment ? ' [fragment]' : ''));
