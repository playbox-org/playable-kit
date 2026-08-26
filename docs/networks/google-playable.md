# Google Ads — HTML5 / Playable Ad (App campaigns) Creative Spec

Sources (verified 2026-08-26):

- <https://support.google.com/google-ads/answer/9981650> — About HTML5/Playable ads for App campaigns (primary playable spec)
- <https://support.google.com/google-ads/answer/12771973> — Fix issues with HTML5 assets for App campaigns (the `ad.size` / `ad.orientation` rules)
- <https://support.google.com/admanager/answer/7046799> — HTML5 guidelines for Ad Manager (display banners, different surface)
- <https://support.google.com/admob/answer/6185487> — HTML5 ads for AdMob campaigns (Google Web Designer only, 150 KB — NOT this)

## Which Google spec applies

Three different Google documents describe "HTML5 creatives" and only one governs
playables. Reading the wrong one is the usual source of bad rules:

| Surface | Doc | Orientation tags | Relevance here |
|---|---|---|---|
| **Google Ads App campaigns** | `answer/9981650` + `answer/12771973` | `ad.size` **and** `ad.orientation` | **This is the playable spec.** |
| Ad Manager / DV360 / CM360 display | `admanager/answer/7046799` | `ad.size` only | HTML5 display banners, fixed sizes, `Fluid` not supported. |
| AdMob campaigns | `admob/answer/6185487` | `ad.size` only | Google Web Designer creatives, 150 KB cap. Not playable ZIPs. |

`ad.orientation` appears **only** in the App-campaigns docs — do not assume Ad
Manager or DV360 honour it.

## The two meta tags

```html
<meta name="ad.orientation" content="portrait,landscape">
<meta name="ad.size" content="width=320,height=480">
```

- The name is **`ad.size` with a DOT.** `ad-size` (hyphen) does not appear
  anywhere in Google's documentation and is not a tag Google parses.
- The content format is strict: `width=W,height=H` — lowercase, comma separator,
  no spaces, no `px`, integers. `480x320` is **not** a format Google accepts.
  "Dynamic sizes such as `Fluid` aren't supported."
- Both tags live in the `<head>` of the primary HTML file.

### `ad.size` — only two legal values

> "There are only 2 supported asset dimensions: 320x480 (portrait) 480x320
> (landscape)"
>
> "For serving in landscape orientation interstitials, use `width=480,height=320`."

| Orientation | Declared size |
|---|---|
| portrait | `width=320,height=480` |
| landscape | `width=480,height=320` |

480x320 is **current spec, not a legacy interstitial size.** Anything else — in
particular the creative's real canvas resolution (1080x1920 and friends) — is
off-spec. (The AdMob-campaigns doc lists a wider interstitial set including
768x1024 / 1024x768, but that page is Google-Web-Designer-only and does not
govern playable ZIPs.)

### The declared size does NOT scale the creative

It is trafficking/validation metadata. Google requires responsiveness precisely
*because* the declared size is nominal:

> "Even though the size must be specified, your asset must also be responsive,
> since it will be served on interstitial slots"
>
> "The HTML5 asset should have a responsive design because it will render in a
> range of full-screen display sizes."

So a creative declaring `320x480` on a 1179x2556 phone renders full-screen — a
full-bleed Cocos canvas is unaffected by the declaration. The tag is still
mandatory as metadata: Ad Manager refuses a size-0 creative outright ("The image
does not have a valid size. The actual size was: width = 0, height = 0.").

> Not stated verbatim anywhere in Google's docs: that the slot never letterboxes
> down to the declared size, and the scaling mechanism inside an interstitial
> slot is undocumented. The conclusion above is inferred from the two
> responsiveness requirements quoted — strong, but indirect.

### `ad.orientation` — real, and it wins

Accepted values, verbatim: `portrait` (vertical assets), `landscape` (horizontal
assets), `portrait,landscape` / `landscape,portrait` (fully responsive assets
working in both orientations).

> "If both meta tags are declared in HTML, the `ad.orientation` value will be
> used."

i.e. **when both tags are present, `ad.size` is ignored** for App campaigns.
`ad.orientation` is optional in the sense that you may use `ad.size` instead, but
it is listed in the required-HTML-structure checklist, and the failure mode of
omitting both (or using a bad value) is soft and silent:

> "your assets won't be rejected upon upload but will only be rendered in
> portrait orientation."

That silent portrait-lock is the reason to always emit an orientation tag.

## One ZIP is enough

`content="portrait,landscape"` officially covers "fully responsive assets working
in both orientations". **There is no requirement to upload one file per
orientation.** The 20-ZIPs-per-ad-group limit is creative-variant capacity, not an
orientation obligation.

## ZIP constraints

| Item | Requirement |
|---|---|
| Max size | **5 MB**, and no more than **512 files** inside the ZIP. |
| Max ZIPs per ad group | 20. |
| Allowed file types | HTML, CSS, JS, GIF, PNG, JPG, JPEG, SVG. |
| Images | Must be **local**. Externally referenced images are rejected. |
| Filenames | Letters, digits, `.`, `-`, `_` only. Spaces cause errors. UTF-8 for non-ASCII. |
| Sound / video | Supported. Sound must not start before user interaction. |
| External hosts (allowlist) | CreateJS, Google Fonts, Google-hosted GreenSock, jQuery, cached libraries on `s0.2mdn.net`. |
| CTA / exit | `<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js">` + `ExitApi.exit()`. Without it Google auto-injects its own "Install" button; exits other than `ExitApi.exit()` are rejected. |
| Entry file | Docs say "primary HTML file" with the required DOCTYPE/`html`/`body`/meta structure. The literal name `index.html` is the de-facto convention and what validators expect, but **not** stated as a spec requirement. |

> The troubleshooting page renders **5.2 MB** in the interstitial-dimensions row
> while the main page says 5 MB — a genuine inconsistency in Google's own docs.
> Treat 5 MB as the target.

## What the packager emits

`GoogleAdapter` (`src/packager/network-adapters/google.ts`) ships **three
archives** from one payload — identical apart from the `<head>` meta tags:

| Archive | Tags |
|---|---|
| `<name>.zip` | `ad.orientation = portrait,landscape` |
| `<name>_portrait.zip` | `ad.orientation = portrait` + `ad.size = width=320,height=480` |
| `<name>_landscape.zip` | `ad.orientation = landscape` + `ad.size = width=480,height=320` |

The primary archive alone satisfies Google. The two fixed-orientation copies
exist for buyers whose slot is orientation-locked and for parity with super-html,
which ships the same trio. They carry **both** tags: `ad.orientation` is what App
campaigns actually read, `ad.size` keeps the archive legible to the older
size-only surfaces. (super-html emits the size tag alone in its fixed archives,
leaving them on that legacy path.)

Mechanically this is `NetworkAdapter.getArtifactVariants()` — an adapter hook for
"another copy of the finished artifact with a rewritten `<head>`". The asset ZIP,
base64 encoding and full HTML are built once and shared; each variant costs one
string replace plus the ZIP write. Every other adapter inherits the default
single-variant implementation.
