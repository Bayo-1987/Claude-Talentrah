# Self-hosted fonts

The seven font families this app uses, as committed files, so `next build` never has to download one (#585: fetching them
from Google failed nine CI builds in a day, before any test ran).

| family | slug | used by |
|---|---|---|
| Newsreader | `newsreader` | app shell headings (`src/app/layout.tsx`) |
| IBM Plex Sans | `ibm-plex-sans` | app shell body (`src/app/layout.tsx`) |
| Poppins, Work Sans, Lora, Barlow Condensed | `poppins`, `work-sans`, `lora`, `barlow-condensed` | resume skeleton typefaces (`src/components/resume-builder/skeletons/fonts.ts`) |
| Source Sans 3 | `source-sans-3` | the resume templates' body face (`src/components/resume-builder/templates/fonts.ts`) |

## Where the files come from

**60 woff2 files, byte-for-byte what Google serves** — every unicode-range subset Google lists for the requested weights and
styles, not only `latin`, because that is what `next/font/google` served before and nothing was pruned. They were fetched
on **2026-09-30** with the request `next/font/google` (Next 16.3.6) makes: the same `fonts.googleapis.com/css2` URL per
family (listed in `scripts/self-host-fonts.mjs`) and the same `User-Agent`, then each `fonts.gstatic.com` file. They were
checked to be the same 60 files a production build of `main` emits under `/_next/static/media/` (identical sha256 sets).
Nothing was edited, converted or renamed inside the files; only the *file names* here carry the family, style, subset,
weights and the first 8 hex digits of the sha256.

`manifest.json` is the record: every file's path, family, style, subset, weights, size, **sha256**, its `fonts.gstatic.com`
URL and whether it is preloaded, plus each family's css2 URL and its licence file with that file's sha256.
`tests/fonts/self-hosted-fonts.test.ts` fails if a file on disk and its manifest entry disagree.

```
node scripts/self-host-fonts.mjs --verify   # offline: committed files against manifest.json
node scripts/self-host-fonts.mjs --check    # fetches from Google and compares with manifest.json
node scripts/self-host-fonts.mjs --write    # refetches and rewrites src/fonts (review the diff: a changed hash is a changed font)
```

## The CSS

`<slug>/<slug>.css` is what `next/font/google` generated for that family, written out: the `@font-face` blocks in Google's
order, the metric-matched fallback `@font-face` (`ascent-override`, `descent-override`, `line-gap-override`,
`size-adjust` — copied from what the build emitted), a `.tal-font-<slug>` class and a `.tal-font-var-<slug>` class that
defines the same `--font-*` custom property as before. Each `url(./…woff2)` is resolved and content-hashed by the bundler,
so the files are served from `/_next/static/media/` with `Cache-Control: public,max-age=31536000,immutable`, exactly as
before. `preload.ts` imports the three files that are preloaded on every page, so each preload URL is the bundler's hashed
URL for the same file the stylesheet uses.

## Licences

All seven families are licensed under the **SIL Open Font License 1.1**. Each family's `OFL.txt` (from
`github.com/google/fonts`, `ofl/<family>/OFL.txt`, with that family's own copyright line) sits next to its files.
IBM Plex, Lora and Source have Reserved Font Names; the files here are Google's served files, unmodified.

## The one remaining reference to a Google font host

`src/lib/seo/og-card.tsx` fetches Newsreader and Source Sans 3 as **ttf** from `fonts.googleapis.com` on the server when it
renders a share-card image (Satori cannot read woff2). It runs per request, never at build, and falls back to `next/og`'s
own font on any failure. It is the single named entry in the allowlist of `tests/fonts/no-google-font-fetch.test.ts`.
