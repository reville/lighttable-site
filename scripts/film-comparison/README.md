# Film comparison pipeline

This pipeline rebuilds the evidence block on lighttable.app from one real RAW.
It produces a neutral conversion, an imported Lightroom-compatible XMP with
Film off, a LightTable physical film render, matched 100% crops, and two
print/scan recipes.

Run it with the Python environment and renderer from a LightTable application
checkout:

```sh
MPLCONFIGDIR=/private/tmp/lighttable-mpl \
  /path/to/lighttable-app/.venv/bin/python \
  scripts/film-comparison/build.py \
  --app /path/to/lighttable-app

/path/to/lighttable-app/.venv/bin/python \
  scripts/film-comparison/build.py --check \
  --app /path/to/lighttable-app
```

The default source is the CC0 Nikon Z6 still life tracked in the application
repository. Pass `--raw` plus the source and license fields for another file.
Use `--crop x,y,size` to lock another pixel-for-pixel crop.

The default middle column is not an Adobe Lightroom render. It passes
`lighttable-natural.xmp` through LightTable's real XMP importer and applies the
mapped controls in LightTable. To use an actual Lightroom result, export an
uncropped JPEG or TIFF from Lightroom and pass it explicitly:

```sh
/path/to/lighttable-app/.venv/bin/python \
  scripts/film-comparison/build.py \
  --app /path/to/lighttable-app \
  --adobe-reference /path/to/lightroom-export.tif
```

The generated manifest records that provenance boundary, source and preset
hashes, mapped and ignored XMP operations, crop coordinates, complete film
parameters, renderer profile digest, and every output hash.
