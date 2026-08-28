# Yacht photos

Drop one image per yacht here and point `photo` at it in `fleet.js`:

```js
photo: 'assets/photos/aurelia.jpg',
```

Landscape crops work best — the spotlight fills the panel with `object-fit:
cover`, so anything roughly 3:2 or wider sits well. Around 1600 px on the long
edge is plenty for a 1080p display.

Any yacht without a photo gets a locator chart of its current position instead,
so leaving this folder empty is a perfectly good default.
