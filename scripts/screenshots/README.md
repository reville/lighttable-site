# Website screenshot pipeline

This pipeline recaptures all ten screenshots on lighttable.app from the real
LightTable interface. Each shot uses a different non-identifying RAW from the
app repository's checksummed CC0 test collection. The source manifest records
the exact app pane, edit state, public caption, and alt text for every image.

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
and output hashes. Filenames are stable, so the page updates without hand-editing
HTML.

## Verify or preview the plan

```sh
python3 scripts/screenshots/capture.py --dry-run \
  --app-root /path/to/lighttable-app

python3 scripts/screenshots/capture.py --check \
  --app-root /path/to/lighttable-app
```

`--check` fails if the plan no longer contains exactly ten unique CC0 sources,
an image is missing or the wrong size, page copy drifts from the manifest, or a
published file hash differs from the generated capture record.

After capture, visually inspect the ten final WebPs together, serve the site
locally, and verify `index.html` plus `screenshots.html` at desktop and mobile
sizes before publishing.

For an automated gallery layout check, serve the site locally and run
`verify-gallery.mjs` with `LIGHTTABLE_PLAYWRIGHT_MODULE` set. It scrolls every
reveal into view, requires ten decoded and unique images, checks horizontal
overflow at desktop and mobile widths, and writes full-page proof screenshots.
