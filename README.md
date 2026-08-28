# Fleet Watch

A live fleet board for an office wall. It plots the yachts you look after on a
chart, and rotates through vessel detail, fleet statistics and a service board so
it is worth glancing at as well as leaving on.

Runs in any modern browser as plain static files. No build step, no framework, no
tile server, no npm install to use it.

**It ships with eight invented yachts so you can see exactly how it behaves
before signing up for anything.** Replace them in `fleet.js`.

---

## Running it

```
python3 -m http.server 8000      # or: npx http-server -p 8000
```

then open `http://localhost:8000` and press **F** for full screen.

Opening `index.html` directly from disk also works — everything loads with plain
`<script>` tags rather than modules, precisely so that it does.

### One file, no server

```
node tools/build-single-file.js
```

writes `dist/fleet-watch.html` with every script, style and the coastline data
inlined — one file to email, drop on a USB stick, or open straight off disk.
Add `--offline` to force demo mode and switch the weather lookup off, for
sandboxes that block outbound requests.

### Kiosk mode

For a permanent display, point a browser at the page in kiosk mode:

```
chromium --kiosk --incognito http://localhost:8000
```

### Keyboard

| Key | |
|---|---|
| `Space` | pause / resume the rotation |
| `←` `→` | previous / next view |
| `1` `2` `3` `4` | chart · vessel detail · fleet summary · service board |
| `D` | toggle discreet mode |
| `F` | full screen |
| `R` | reload |

The cursor hides itself after a few seconds of stillness.

**Click a yacht** — on the chart or in the fleet rail — to jump straight to its
detail. The rotation is not paused by the click; the scene timer restarts, so
there is a full dwell to read it before the board moves on.

A hint showing all of this appears once at start-up and whenever a pointer
moves. On a wall display the pointer never moves, so after boot it is never seen
again — which is the rule the interactive bits follow generally: nothing that
costs anything when nobody is there to use it.

If somebody pauses the board by hand and walks away, it starts again on its own
after five idle minutes. A board that stops because someone brushed the mouse is
worse than one that carries on.

---

## Branding

The board is themed from the Icon Connect Brand Book 2023.

- **Colour.** Surfaces are stepped from the digital wallpaper's blue-slate; the
  accent is `#3CB4E4`, the cyan the logotype is actually printed in, with the
  charter's `#00CCFF` kept for the one live element. Vessel-state colours are
  stepped from the charter hues onto the dark ground and validated as a
  categorical set — lightness band, chroma floor, colour-blind separation and
  3:1 contrast all pass. Because the brand palette is entirely cool, "at anchor"
  is the Security aqua walked toward green: the nearest step that stays
  distinguishable from the cyan.
- **Type.** Century Gothic for titles and Lato for body, as the graphic charter
  specifies. The display stack tries Century Gothic first, so a machine with the
  licensed font uses the real thing; [Jost](https://indestructibletype.com/Jost.html)
  — like Century Gothic, a Futura derivative — ships with the board as the
  substitute. Both webfonts are served from `assets/fonts/`, not a CDN: a board
  that runs sixteen hours a day should not depend on a third party being up.
- **The wordmark.** `ICON CONNECT` is set in the display face with the power
  symbol drawn as SVG in place of the O, sized to the cap height of the letters
  beside it and stroked to the same weight. `London - Monaco` sits beneath, as
  the lockup sets it — but in the board's own muted ink rather than the
  artwork's black, which would disappear against a dark ground. Change it with
  `brandLocations`, or set it empty to drop the line.

  To use the real artwork instead, drop a transparent PNG of the horizontal
  logotype into `assets/` and point `brandLogo` at it in `config.js`. That
  replaces the drawn wordmark entirely and falls back to it if the file is
  missing. Use a version with light or cyan artwork on transparency — a lockup
  with black text in it will not read here.

Everything is a CSS custom property in one block at the top of
`css/screensaver.css`, so retinting for another brand means editing that block
and nothing else. The chart reads its colours from the same properties.

## Making it yours

### 1. The fleet — `fleet.js`

The one file you have to edit. Each yacht needs an **MMSI**: that nine-digit
number is the identity AIS actually broadcasts on, and the only field live
tracking requires. IMO is carried in the slower static message and is useful as
your own reference, but you cannot subscribe to a feed by IMO alone.

Everything else — flag, dimensions, builder, class, and the whole `service` block
— is yours to fill in and is displayed as given.

The placeholder IMO and MMSI numbers are deliberately sequential (`9900001+`,
`319000001+`) so they cannot collide with a real vessel.

### 2. Settings — `config.js`

Brand name, units, office location and time zone, how long each view holds,
discretion, and the after-hours dim. Commented throughout.

### 3. Photos — `assets/photos/`

Drop in an image per yacht and point `photo` at it:

```js
photo: 'assets/photos/aurelia.jpg',
```

Until you do, the spotlight draws a small locator chart of where that yacht is
instead, which is more use than a grey box.

---

## Live positions

Out of the box the board runs in **demo mode**: eight simulated yachts, with time
compressed thirty-fold so the movement is actually visible. Everything you see is
driven through the same code path live AIS uses.

To go live, get a free API key from [aisstream.io](https://aisstream.io) (sign in
with GitHub, generate a key) and put it in `config.js`:

```js
aisStreamApiKey: 'your-key-here',
```

The board opens one WebSocket, subscribes to your fleet's MMSIs only, and
reconnects with backoff if the connection drops.

### What to expect from AIS

**Yachts go dark, and that is normal.** SOLAS V/19 only mandates AIS above 300 GT
on international voyages, and captains routinely switch it off for owner privacy.
AISstream's coverage is also terrestrial, so a yacht more than roughly 40 nm
offshore stops reporting whether or not anyone touched the transponder.

Neither is treated as an error. The board keeps the last known position, ages it
visibly, and after `darkPositionHours` marks the yacht **No signal** and stops
claiming a speed or a course. One of the placeholder yachts is set up this way on
purpose, so you can see the state before you meet it in production.

If mid-ocean gaps genuinely matter to you, satellite AIS is available from
Kpler/MarineTraffic or VesselFinder at commercial rates. Start free and see
whether the gaps actually bother you first.

---

## Weather

Wind, air, sea state and sea temperature come from
[Open-Meteo](https://open-meteo.com) — no key, no account, no cost. Refreshed
every thirty minutes and staggered so eight yachts don't fire at once.

The marine model has no data for inland water, so a yacht in a river refit yard
correctly returns nothing for sea state. The card says so rather than showing a
plausible dash.

Set `weather.enabled: false` to run with no outbound requests beyond AIS.

---

## Discretion

Owners pay for privacy, and a screen visible to visitors, reception, or through a
window publishes their whereabouts.

- Set `discreet: true` on any yacht in `fleet.js` — that vessel is *always*
  shown as an area rather than a fix, its track is not drawn, and its speed,
  course and destination are withheld.
- Set `discreetMode: true` in `config.js`, or press **D**, to apply the same
  treatment to the whole fleet. The footer says so while it is on.

Blurring happens in the store, before anything reaches the chart or the cards, so
an exact position cannot leak into a label by accident. `discreetRoundingNm`
controls how coarse it is.

Worth a word with the owners' representatives before the screen goes up. There
are no owner or guest names anywhere in this board, and adding them would be a
poor idea.

---

## How it is put together

```
index.html            markup and script order
config.js             settings          ← you edit this
fleet.js              the fleet         ← and this
css/screensaver.css   one palette, defined as custom properties
assets/fonts/         the brand webfonts, self-hosted (SIL Open Font License)
data/ports.js         279 ports and marinas, for "42 nm SSW of Palma"
data/world-land.js    Natural Earth coastlines, encoded (218 KB)
js/geo.js             projection, navigation, sun position, coastline decoding
js/format.js          units, positions, ages, countdowns
js/store.js           one place that knows where every yacht is
js/ais.js             AISstream WebSocket client
js/demo.js            the simulated fleet
js/weather.js         Open-Meteo
js/map.js             the chart renderer
js/views.js           the four screens
js/app.js             bootstrap, rotation, keyboard
tools/test.js         browser-free checks — node tools/test.js
tools/build-coastline.js    regenerates data/world-land.js
tools/build-single-file.js  bundles everything into one .html
```

### Why there is no map library

The chart is drawn directly onto a canvas from Natural Earth 1:50m coastlines,
delta-encoded into 218 KB. That means no tile requests, no usage policy to honour
on a screen that runs sixteen hours a day, no CDN dependency, and a palette that
matches the rest of the board exactly.

The trade is detail: at very close zoom the coastline is visibly generalised. For
an ambient board that never zooms past regional context, that is the right side
of the trade. Nothing here is a navigation aid.

To regenerate the coastline data (say, at a different simplification):

```
npm pack world-atlas@2 topojson-client
# extract both, then
node tools/build-coastline.js
```

### Tests

```
node tools/test.js
```

Covers the navigation maths against published figures, sunrise and sunset against
known times, the AIS parser, unit formatting, and the store's state derivation —
including that discreet vessels never expose an exact position. Rendering is not
covered; open the page for that.

---

## Wall-display housekeeping

Already handled, all configurable under `display` in `config.js`:

- **Burn-in** — the layout shifts a few pixels every few minutes, and the chart
  drifts continuously by a handful of pixels.
- **After hours** — the board dims outside office hours.
- **Restarts** — last known positions are cached to `localStorage`, so a reload
  or a power cut comes back with content rather than eight empty cards. A browser
  with site data blocked is handled too; it just loses the cache.
- **Outages** — a failed weather lookup keeps the previous reading rather than
  blanking the card. A dropped AIS socket reconnects with jittered backoff.

---

## Attribution

- Coastlines: [Natural Earth](https://www.naturalearthdata.com) (public domain),
  via the [world-atlas](https://github.com/topojson/world-atlas) package.
- Weather: [Open-Meteo](https://open-meteo.com).
- Positions: AIS, via [aisstream.io](https://aisstream.io).
