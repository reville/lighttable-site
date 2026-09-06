# Website screenshot pipeline

This pipeline recaptures all ten screenshots on lighttable.app from the real
LightTable interface. Each shot uses a different non-identifying RAW from the
app repository's checksummed CC0 test collection. The source manifest records
the exact app pane, edit state, public caption, and alt text for every image.
The same run also generates the homepage's portrait hero and Film, Masking,
and Export control closeups from those captured images.

## Capture

Use a clean LightTable checkout with its normal `.venv`, engine, vendor, and LUT
dependencies, then run the pipeline from this website checkout:

```sh
cd /path/to/lighttable-site
python3 scripts/screenshots/capture.py \
  --app-root /path/to/lighttable-app
```

The pipeline starts the app's real local server and renders its actual interface
in an isolated Playwright browser. Temporary preferences, catalog state, caches,
and instance files keep it away from a regular photo library, and the server is
always stopped when the run finishes.

Every run stages ten RAWs, applies only temporary edit state, waits for the real
rendered presentation, captures the named interface state, converts it to a
1800-pixel WebP, and refreshes `screenshots/manifest.json` with the app revision
and output hashes. It then builds the homepage crops and refreshes the two
marked image sections in `index.html`. Filenames are stable, so normal capture
updates the gallery, hero, and closeups together without hand-editing HTML.

## Homepage framing and closeups

The `homepage` section of `manifest.json` defines the hero and detail insets.
Each entry names a `sourceShot`, stable output filename, alt text, and a pixel
rectangle `[x, y, width, height]` within its 1800 × 1169 source screenshot.
The hero uses exactly the right half of the Film workspace. Detail entries also
provide a short, plain label displayed below the full-workspace overview and
enlarged inset. Both images link to a larger view.

To adjust the framing or copy using the already recorded captures:

```sh
python3 scripts/screenshots/capture.py --derive-homepage
```

This command needs `cwebp` and macOS `sips`, but no app runtime or RAW files.
It crops actual captured pixels and encodes them losslessly without upscaling
or reconstructing UI. It checks the originals against their capture hashes
before making any changes. The generated `screenshots/homepage-manifest.json`
retains the original app revision and capture date, source filenames and hashes,
exact crop rectangles, dimensions, and derived asset hashes. Reframing does not
claim a new app capture.

When UI panels move, update the rectangles in the source plan, regenerate, and
visually review the results. Crop origins must use even x/y coordinates because
of `cwebp`'s crop alignment. Out-of-bounds rectangles, unknown sources, duplicate
filenames, and attempts to overwrite a gallery original fail validation.
Keep edits to homepage image copy in the plan: content between the `HOMEPAGE`
HTML markers is generated; the surrounding page remains hand-authored.

## Verify or preview the plan

```sh
python3 scripts/screenshots/capture.py --dry-run \
  --app-root /path/to/lighttable-app

python3 scripts/screenshots/capture.py --check \
  --app-root /path/to/lighttable-app
```

`--check` fails if the plan no longer contains exactly ten unique CC0 sources,
an image is missing or the wrong size, page copy drifts from the manifest, or a
published file hash differs from the generated capture record. It also verifies
all homepage crops, source hashes, capture identity, crop settings, and generated
HTML. A fresh gallery capture with old homepage crops fails this check.

After capture, visually inspect the ten final WebPs together, serve the site
locally, and verify `index.html` plus `screenshots.html` at desktop and mobile
sizes before publishing.

For automated homepage and gallery layout checks, serve the site locally and run
`verify-gallery.mjs` with `LIGHTTABLE_PLAYWRIGHT_MODULE` set. It scrolls every
reveal into view, requires ten decoded and unique images, checks horizontal
overflow at 1440, 1024, 390, and 320 pixels, and writes proof screenshots. It also
checks the portrait hero, the screenshot link's position and navigation, decoded
closeups, minimum inset size, and the enlarged-image links.

```sh
LIGHTTABLE_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node scripts/screenshots/verify-gallery.mjs \
  http://127.0.0.1:8000/screenshots.html /tmp/lighttable-site-proof \
  /path/to/chrome-headless-shell

python3 -m unittest discover -s scripts/screenshots -p 'test_*.py'
```
