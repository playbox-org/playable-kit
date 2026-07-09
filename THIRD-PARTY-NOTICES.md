# Third-Party Notices

`@playbox-ai/playable-kit` is licensed under Apache-2.0 (see `LICENSE`). It
includes and depends on the following third-party open-source components. Each
retains its own license; the relevant terms are reproduced or referenced below.

## Bundled (vendored into the published package)

### JSZip 3.10.1

A minified JSZip runtime is embedded verbatim in `src/generated/jszip-min.ts`
(codegen'd by `scripts/embed-jszip.mjs`) so packaged playables can unpack zip
payloads in the browser without a `node_modules` resolution at runtime. Its
original license header is preserved inside that file.

- Project: https://github.com/Stuk/jszip
- Copyright (c) 2009-2016 Stuart Knightley and contributors
- License: **MIT** (JSZip is dual-licensed MIT or GPLv3; this project elects the
  MIT terms, which are compatible with Apache-2.0).

JSZip bundles **pako** (zlib port):

- Project: https://github.com/nodeca/pako
- License: **MIT**

## Runtime dependencies (installed from npm, not vendored)

| Package   | Version range | License                           |
| --------- | ------------- | --------------------------------- |
| jszip     | ^3.10.0       | MIT (dual MIT/GPLv3; MIT elected) |
| cheerio   | ^1.0.0        | MIT                               |
| clean-css | ^5.3.0        | MIT                               |

All of the above are permissive and compatible with distributing this package
under Apache-2.0. If additional dependencies are added, extend this file before
publishing.

---

### MIT License (applies to JSZip, pako, cheerio, clean-css)

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
