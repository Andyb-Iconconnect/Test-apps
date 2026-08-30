# Yacht photos

**The easiest way in is the console: open a vessel, press Edit, and choose or drop
an image.** It is scaled down and kept in that browser, shows immediately on that
machine, and the Save fleet.js dialog writes it out here with `fleet.js` already
pointing at it — which is what the office display needs, being a different
machine. The rest of this file is the manual route.

One image per yacht, named for her `id` in `fleet.js`:

```
assets/photos/aurelia.jpg
```

and pointed at from her record:

```js
photo: 'assets/photos/aurelia.jpg',
```

A yacht with no photo gets a drawn side profile instead — built from her length,
tonnage and rig, captioned as an illustration — so leaving this folder empty is a
perfectly good default.

## Copying photos down from links

If you have URLs rather than files, `tools/fetch-photos.js` will fetch them here
and repoint `fleet.js` at the local copies. Put the links in a list, one yacht
per line:

```
# id             url
aurelia          https://example.com/press/aurelia-starboard.jpg
silver-meridian  https://example.com/press/silver-meridian.jpg
```

```
node tools/fetch-photos.js photos.txt            # --dry-run to see it first
node tools/fetch-photos.js --from-fleet          # URLs already pasted into fleet.js
```

It edits only the `photo:` lines, leaves the rest of `fleet.js` alone, and checks
the file still parses to the same fleet before writing anything.

**Copy them down rather than linking to them.** Three reasons:

- Many image hosts refuse to serve to another site. The board does not show a
  broken image when that happens — it falls back to the drawn profile — so a
  blocked photo looks exactly like a photo you never added.
- The single-file build exists so the board keeps working when the office
  connection does not. A remote image undoes that.
- The published artifact blocks external images outright. Only a local file will
  appear there, and the build embeds it in the bundle.

## Sizing

Landscape crops work best: both panels use `object-fit: cover`, and the board's
is close to square, so a conventional 3:2 broadside shot sits well while a very
wide one loses its ends. About 1600 px on the long edge is plenty for a 1080p
display, and keeps the bundle well inside the 16 MB the artifact host allows.

## Rights

These go on a display facing reception and into a tool sales use with clients,
which is a further reach than a private page. Shipyard and charter-broker press
kits usually license exactly this; a picture found through an image search
usually does not. Nothing here checks — supplying a URL is you deciding you are
entitled to use it.
