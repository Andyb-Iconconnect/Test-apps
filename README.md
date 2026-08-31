# Fleet Watch & Fleet Console

Two pages over one shared core.

| | | |
|---|---|---|
| **`index.html`** | Fleet Watch | The board for the office wall. Rotates on its own, never touched. |
| **`console.html`** | Fleet Console | The desk tool for sales and aftersales. Leads with what needs attention. |

They share the fleet file, the store, the AIS and weather feeds, the chart
renderer and the palette. What differs is the job — and, deliberately, what each
one is allowed to show.

## Which one shows what

The reception screen and the desk tool have opposite defaults, and that is the
point.

Set **`discreetLocked: true`** in `config.js` on the office display. Discretion
is then forced on at start-up and the `D` key stops working, so nobody passing
the screen can reveal exact positions. It is deliberately *not* something
somebody has to remember to switch on when guests arrive — that fails the first
time it is forgotten, and the failure is showing a visitor exactly where a
client's boat is.

The console is the opposite: full detail by default, with a visible **Discreet**
button and an unmissable banner for when somebody walks over. Crew contacts
appear only there, never on the board.

Redaction happens in the store, before anything reaches a view, so a withheld
position cannot leak into a label. Hidden-but-present in the page is a
screenshot away from being a problem.

---

# Fleet Watch — the office display

A live fleet board for an office wall. It plots the yachts you look after on a
chart, and rotates through vessel detail and fleet statistics so it is worth
glancing at as well as leaving on.

Service and refit detail lives in the console, not here — a board a visitor can
see is not the place for a client's job list.

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
`--entry=console.html` bundles the desk tool the same way. Add `--offline` to
force demo mode and switch the weather lookup off, for sandboxes that block
outbound requests.

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
| `1` `2` `3` | chart · vessel detail · fleet summary |
| `D` | toggle discreet mode |
| `F` | full screen |
| `R` | reload |

The cursor hides itself after a few seconds of stillness.

**Step between views** with the `‹` `❚❚` `›` controls in the footer, or the arrow
keys. They move between the three views rather than through the eight spotlight
scenes behind one of them, which is what the three dots beside them mean. Like
the cursor, they appear only once a pointer has moved, so the wall display never
grows a control nobody can use.

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

---

# Fleet Console — the desk tool

Open `console.html`. Three columns: the fleet on the left, work in the middle, a
chart on the right that re-aims as you select. It answers to the width of each
column rather than the window, so zooming in behaves the same as narrowing the
window: the columns tighten, the rail head stacks its buttons, the status tiles
regroup 5 → 3 + 2 → 2 + 2 + 1, and below 960px the chart pane steps aside. Below about 1400px the columns
tighten; below 960px the chart pane drops and it becomes two. The vessel record
carries its own position line, so the chart going is never the difference
between knowing where a yacht is and not.

**It opens on what needs attention**, not on where everything is — overdue and
imminent surveys, urgent jobs, and parts landing within the week, each against
where that yacht actually is. A part due in Palma reads differently depending on
whether the boat is already there.

**Upgrade conversations** lists installed systems past the age at which they are
worth a call, by service line. Thresholds are per line in `config.js`, because a
network core dates faster than a control system, which dates faster than
cameras. That single table serves both sides of the business: which boats are
due a conversation, and what am I actually supporting on this one.

- **Search** by name, IMO, MMSI, flag, call sign, nearest port, engineer, or an
  installed product. `/` focuses it, `Esc` clears.
- **Filter** by state, or by anything needing attention.
- **Add a vessel** with the button above the fleet list — see below.
- **Click** a vessel in the rail, on the chart, or in any list to open it.
- `Esc` returns to the fleet.

### Adding a vessel

`fleet.js` stays the source of truth — it is version-controlled, both pages read
it, and at five new yachts a year hand-editing costs minutes. The form exists so
that editing does not mean hand-writing JavaScript.

It asks for the **IMO number** and checks it against its own check digit, so a
transposed digit is caught at the desk rather than three weeks later. It also
asks for the **MMSI**, and this is the part worth knowing: *AIS broadcasts on
MMSI, not IMO*. There is no free way to look one up from the other — it has to
come off the ship's radio licence or her AIS unit. Without it a vessel appears on
the list but cannot be tracked, and the form says so rather than letting you find
out later. The MMSI is checked too: the first three digits identify the flag and
must be a ship station, not a coast station or a handheld.

A vessel added this way is held in **that browser only**, and the console says so
plainly wherever it appears. The board reads the same store, so on the same
machine, in the same browser, she appears on the display straight away — with the
position, port and status you gave her.

"Same browser" is the whole of it, and it is worth being precise about, because
it is the thing that catches people out. The board and the console published as
two separate pages are two separate origins and share no storage at all; so are
a laptop and the reception PC. A yacht added on one is invisible on the other
until `fleet.js` itself carries her.

To make her permanent and shared, then, the form hands you the finished
`fleet.js` entry to paste in, with a copy button — or use **Save fleet.js** below
for the whole file at once. Until you do, she is marked "not in fleet.js" on her
own record, with the snippet and a remove button.

### Removing a vessel, and saving fleet.js

Every record has a **Remove vessel** button. One **added in this browser** is
deleted outright. One **from `fleet.js`** disappears from your console straight
away — but a web page cannot edit a file, so that alone is only half the job.

The other half is **Save fleet.js**. Whenever there are local changes, a button
appears above the fleet list, and removing a vessel opens it for you. It writes
out the *entire* file with every change applied — additions in, removals out,
every existing record intact — to copy or download. Save that over `fleet.js`
and the vessel is gone for good: off the office display, off everyone else's
console. That is the only complete removal there is.

Served from a folder, **Download** writes `fleet.js` directly. Inside the
artifact viewer a page cannot download anything by itself — it has to ask the
host, which prompts and only permits certain extensions, `.js` not among them —
so there it saves as `fleet.js.txt` to rename. **Copy file** works everywhere and
is the simpler route if you are pasting into an editor anyway.

Until you do, nothing is lost silently: the fleet list footer says how many
vessels are hidden locally and offers them straight back.

Everything else it shows comes from `fleet.js` — the `service`, `systems` and
`contacts` blocks. There is no separate database, which is the right call while
the fleet grows by a handful a year: one file, edited in minutes, and no second
place for the truth to disagree with itself.

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

## Day and night

The chart shades the night side as it actually falls: a warm strip while the sun
is still just above the horizon, then civil, nautical and astronomical twilight
cooling through violet and indigo into night. Each band is filled between two
solar-altitude contours, computed for the moment and recomputed once a minute.

The bands are composited with **multiply**, which matters more than it sounds.
Laid over the top the ordinary way, a tinted wash *brightens* anything darker
than the tint — and the sea here is very dark, so a violet twilight was lightening
the ocean it was meant to be darkening, and the night side came out the same
brightness as the day side. Multiplying can only ever darken, so the ramp is
monotonic by construction. Measured on the rendered pixels: daylight untouched,
full night at half the brightness, and land under night sitting 3.4:1 away from
the same land in daylight while staying 1.9:1 clear of the sea beside it.

The five colours are `--twilight-*` and `--map-night` in `css/tokens.css`; the
alpha on each is the strength of that band.

## Live positions

Out of the box the board runs in **demo mode**: eight simulated yachts, with time
compressed thirty-fold so the movement is actually visible. Everything you see is
driven through the same code path live AIS uses.

To go live, get a free API key from [aisstream.io](https://aisstream.io) — sign in
with GitHub and generate one — then **enter it at the screen**: click the status
pill in the top right (the one that says *Demo data*), or press `K`. It works the
same on the board and in the console.

The key is kept in that browser's localStorage. It is never written into
`fleet.js`, never committed, and deliberately left out of the single-file build —
a bundle gets emailed, dropped on a USB stick and published as a page, and a
credential baked into one travels wherever the file goes. The cost of that choice
is that the key has to be entered once on each screen that shows the fleet.

`config.js` still has an `aisStreamApiKey` field for an automated deploy that
injects it at build time. A key typed at the screen overrides it, so a display can
be corrected without a rebuild.

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
index.html            the office display
console.html          the desk tool
config.js             settings          ← you edit this
fleet.js              the fleet         ← and this
css/tokens.css        the palette and faces, shared by both pages
css/screensaver.css   layout for the display
css/console.css       layout for the console
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
js/views.js           the display's four screens
js/app.js             the display: bootstrap, rotation, keyboard
js/console.js         the console: attention model, rail, detail, chart pane
js/vessel.js          IMO and MMSI validation, local additions, fleet.js snippets
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
