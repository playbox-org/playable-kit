/**
 * The Content Security Policy an ad container puts a creative under, and the
 * one thing every playable has to survive.
 *
 * ---- WHAT GOES WRONG, AND WHY IT IS INVISIBLE ----
 *
 * A packaged creative inlines every asset as a base64 `data:` URI. That looks
 * like it settles the question — the bytes are in the document, nothing leaves
 * the page — and it does not, because CSP does not ask about the BYTES. It asks
 * which directive the READER falls under, and the three readers a game uses land
 * in three different ones:
 *
 *     <img src="data:...">           img-src       Meta allows
 *     fetch("data:...") / XHR        connect-src   Meta REFUSES
 *     new FontFace(f, "url(...)")    font-src      Meta REFUSES
 *     any of the above on `blob:`                  Meta REFUSES
 *
 * So a loader that fetches its own inlined asset — three's `FileLoader` behind
 * every `FBXLoader.loadAsync`, PIXI's `Assets.load`, a hand-rolled sound loader,
 * a FontFace given a URL — dies in the container and nowhere else. It passes
 * every local check, it passes `vite preview`, it passes a colleague's browser,
 * and then it runs as an ad with no models, or no sound, or no interface.
 *
 * And it fails SILENTLY. A texture that never arrives is not an exception: the
 * loader's own try/catch logs a warning into a console nobody is reading, the
 * game draws its fallback, and the only report that comes back is a human
 * saying the art looks wrong.
 *
 * ---- WHY `blob:` IS NOT THE REPAIR ----
 *
 * Worth stating because it is the first thing everyone reaches for, and it is
 * measured to make things worse. A blob URL does not remove the read, it moves
 * it: an `<img src="blob:">` is still img-src, a FontFace given a blob URL is
 * still font-src. Meta lists `blob:` in neither, so converting an asset manifest
 * to blob URLs trades dead binaries for DEAD IMAGES — the whole interface and
 * every texture, which is a worse bug than the one it fixes.
 *
 * ---- WHAT TO DO INSTEAD ----
 *
 * Make no request for an inlined asset. Decode the base64 in JS — `atob` is
 * arithmetic, outside every directive — and hand the bytes to the parser that
 * wanted them: `FBXLoader.parse(buffer)`, `GLTFLoader.parse(buffer, ...)`,
 * `AudioContext.decodeAudioData(buffer)`, `new FontFace(family, buffer)`. The
 * only URL left anywhere is the `data:` URI an `<img>` reads, which is the one
 * form measured to work — and is what the Cocos builds that pass Meta do.
 *
 * ---- THE POLICY BELOW ----
 *
 * Not a copy of Meta's header, which is not published and changes. It is a
 * DELIBERATELY STRICTER floor: everything a self-contained creative legitimately
 * needs and nothing else. A creative that runs under this runs in any container
 * we have met; one that breaks under it has a portability bug, whichever network
 * happens to catch it first.
 *
 *   - `img-src`/`media-src` grant `data:` because that is the one grant every
 *     container makes and the one a packaged creative depends on.
 *   - `connect-src 'self'` allows the launcher-payload fetch a preview serves
 *     from its own origin, and refuses `data:`, which is the bug.
 *   - `font-src 'self'` refuses both `data:` and `blob:`, which is the other one.
 *   - `script-src` keeps `'unsafe-inline'` and `'unsafe-eval'`: the bundle IS an
 *     inline script, and PIXI and Ammo both build functions at runtime. Taking
 *     those away would fail every creative for a reason no container has.
 *   - No `blob:` anywhere, on purpose.
 */
export const STRICT_CSP = [
  "default-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
].join('; ')

/**
 * Whether a preview should serve this network's artifact under {@link STRICT_CSP}
 * by default.
 *
 * `true` only where the refusal has actually been OBSERVED in the network's own
 * player — today that is Meta, where a `fetch` of an inlined `data:` URI comes
 * back `TypeError: Failed to fetch` and a blob URL fails img-src and font-src.
 * Everywhere else this stays off rather than guessed at: a check that fails a
 * creative for a policy its network does not have costs more trust than it saves.
 *
 * That is a default and not a verdict. A preview should let a human ask for the
 * policy on ANY network — the bug it catches is a portability bug, and the
 * network that catches it first is an accident of who reviewed first.
 */
export function strictCspByDefault(networkId: string, config?: { strictCsp?: boolean }): boolean {
  return config?.strictCsp === true || networkId === 'facebook'
}
