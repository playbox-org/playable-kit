# Meta (Facebook): the Content Security Policy, and what it refuses

Meta runs a playable under a CSP. The creative is a single HTML with every asset
inlined as a base64 `data:` URI, which looks like it settles the question — the
bytes are in the document, nothing leaves the page — and it does not.

**CSP does not ask about the bytes. It asks which directive the reader falls
under.** The three readers a game uses land in three different ones:

| Reader | Directive | Meta |
|---|---|---|
| `<img src="data:…">` | `img-src` | allows |
| `fetch("data:…")`, `XMLHttpRequest` | `connect-src` | **refuses** |
| `new FontFace(f, "url(…)")` | `font-src` | **refuses** |
| any of the above on `blob:` | — | **refuses** |

So a loader that fetches its own inlined asset dies in the container and nowhere
else. It passes locally, it passes `vite preview`, it passes a colleague's
browser, and then it runs as an ad with no models, or no sound, or no interface.

## What it looks like when it happens

Nothing. That is the whole problem.

A blocked asset is not an exception — a loader's own `try/catch` logs a warning
into a console nobody is reading and the game draws its fallback. The report that
comes back is a human saying "the art looks wrong", or "textures don't load",
weeks later.

Two real ones:

- Three's `FBXLoader.loadAsync` goes through `FileLoader`, which fetches. Every
  model came back blocked, `AssetLoader`'s catch logged a warning, and the game
  drew low-poly fallback discs. The board was otherwise correct, because the
  LAYOUT never depended on the meshes arriving.
- Fonts loaded through `new FontFace(family, 'url(' + dataUri + ')')` are fetched
  under `font-src`. Same silence, and text in a fallback face reads as a styling
  bug rather than a load failure.

## `blob:` is not the repair

It is the first thing everyone reaches for. It is measured to make things worse.

A blob URL does not remove the read, it moves it: `<img src="blob:">` is still
`img-src`, a FontFace given a blob URL is still `font-src`. Meta grants `blob:`
in neither. Converting an asset manifest to blob URLs trades dead binaries for
**dead images** — the whole interface and every texture — which is a worse bug
than the one it fixes.

(Meta's Ads Manager is stricter still than the public preview tool: it also
refuses `blob:` in `script-src`, so a loader that evaluates a chunk via
`<script src="blob:…">` — the SystemJS and Cocos dynamic-bundle paths — fails
there while passing the preview. Executable JS must go through `eval` +
`System.getRegister()`, never a blob URL.)

## What to do instead

Make no request for an inlined asset. Decode the base64 in JS — `atob` is
arithmetic, outside every directive — and hand the bytes to the parser:

```js
export async function assetUrlToArrayBuffer(url) {
  // The dev server hands back a real path; only a built file is inlined.
  if (!url.startsWith('data:')) return (await fetch(url)).arrayBuffer()
  const comma = url.indexOf(',')
  const header = url.slice(5, comma)
  const body = url.slice(comma + 1)
  // A data URI is only base64 when it says so — Vite emits percent-encoded
  // text for a small enough SVG, and atob returns garbage rather than throwing.
  if (!/;base64/i.test(header)) {
    return new TextEncoder().encode(decodeURIComponent(body)).buffer
  }
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
```

Then:

| Asset | Instead of | Use |
|---|---|---|
| FBX | `fbxLoader.loadAsync(url)` | `fbxLoader.parse(buffer, '')` |
| GLB/GLTF | `gltfLoader.loadAsync(url)` | `gltfLoader.parse(buffer, '', onLoad, onError)` |
| Audio | `fetch(url).then(r => r.arrayBuffer())` | `decodeAudioData(buffer)` |
| Font | `new FontFace(f, 'url(' + url + ')')` | `new FontFace(f, buffer)` |
| wasm | `fetch(url)` | the buffer straight into the module |
| Images | — | leave them as `data:` on an `<img>` |

Images are the exception and stay a URL: `img-src` is the one directive that
grants `data:`, and it is what the Cocos builds that pass Meta do.

**PIXI needs saying separately.** `PIXI.Assets.load` fetches, so it is out for
the same reason; and it picks its parser from the URL's extension, which a
`data:` URI does not have, so handing it one leaves it with no parser and no
texture even where the fetch succeeds. Build the image yourself and wrap it:

```js
const img = document.createElementNS('http://www.w3.org/1999/xhtml', 'img')
await new Promise((res, rej) => {
  img.onload = res
  img.onerror = () => rej(new Error('image failed to load'))
  img.src = dataUri
})
const texture = PIXI.Texture.from(img)
```

`createElementNS` and not `new Image()`, and that one is not about CSP at all —
see [`browser-image-constructor.md`](./browser-image-constructor.md).

## Checking it before Meta does

Serve the artifact under [`STRICT_CSP`](../../src/preview/csp.ts) — a
deliberately stricter floor than Meta's own header, which is not published and
changes:

```
default-src 'self' 'unsafe-inline' 'unsafe-eval';
img-src 'self' data:; media-src 'self' data:;
font-src 'self'; connect-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline'
```

A creative that runs under this runs in every container we have met; one that
breaks under it has a portability bug, whichever network happens to catch it
first.

Both previews do this for you. The extension's preview server sets the header
for networks flagged `strictCsp` and takes `?csp=strict` / `?csp=off` on any
network; the platform's validator preview sets it on the creative document
through the service worker. Only `facebook` carries the flag, because Meta is
where the refusal has actually been observed — a check that fails a creative for
a policy its network does not have costs more trust than it saves.

It must be a real header, not a `<meta>` tag: a meta CSP applies only from where
it sits in the document, and the preview's injected SDK mocks run before it.
