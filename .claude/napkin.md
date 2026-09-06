# LightTable Website Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Screenshot Publishing (Highest Priority)
1. **[2026-09-04] Gallery screenshots come from the isolated real-UI pipeline**
   Do instead: run `scripts/screenshots/capture.py` against a clean current app
   checkout, visually inspect all ten WebPs, run `--check`, and verify the local
   desktop and mobile pages before publishing.
2. **[2026-09-04] Public captures use only the recorded CC0 non-identifying set**
   Do instead: keep ten unique sources in `scripts/screenshots/manifest.json`
   and let the pipeline verify each against the app repository's provenance TSV.
3. **[2026-09-06] Homepage crops and inset copy are generated from the capture plan**
   Do instead: edit `homepage` entries in `scripts/screenshots/manifest.json`,
   run `capture.py --derive-homepage`, and verify with `--check`. Preserve source
   capture dates and app revisions when reframing existing images. Full capture
   automatically refreshes these derivatives and the marked homepage sections.

## Product Copy
1. **[2026-09-04] Product comparisons stay evidence-bounded**
   Do instead: describe Lightroom's current profiles, presets, and grain fairly;
   contrast LightTable's explicit physical-stage chain without claiming other
   tools have no film-inspired features.
