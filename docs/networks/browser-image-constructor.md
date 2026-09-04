# `new Image()` and the browsers that patch it

Not a network rule. A browser one, and it costs a whole interface.

Arc — Chromium, the same engine as Chrome — patches the global `Image`
constructor for its content blocker and leaves `src` non-configurable on the
instances it hands back. The next write to that property throws:

```
TypeError: Cannot redefine property: src
```

Measured on one page, one set of assets, in Arc:

```
textures: 19/19   three.js — document.createElementNS('…xhtml', 'img')
sprites:   0/21   our loader — new Image()
failures:  Cannot redefine property: src   ×21
```

Same `data:` URIs, same document, same moment. The only difference is how the
element was constructed. Three has always built its images through the document
(`ImageLoader.js`), which is why it was untouched.

## The rule

Build image elements through the document:

```js
const img = document.createElementNS('http://www.w3.org/1999/xhtml', 'img')
```

Not `new Image()`. It costs nothing and it is what the one library in the bundle
that survived was already doing.

## Why this is worth a page

The failure is invisible in every environment a developer actually uses. Chrome
is fine. Safari is fine. The packaged file opened from disk is fine. It fails in
one browser, silently, and the report that comes back is "the buttons don't show
up" — and because it is not the browser the ad will run in, the temptation is to
call it the browser's problem and move on.

It is still worth fixing, for a reason that has nothing to do with Arc: a
creative that only works when nothing has patched the environment it runs in is
a creative that will eventually meet a container that has patched it. Ad
containers instrument aggressively.
