#!/usr/bin/env python3
"""Capture and validate the LightTable gallery, homepage crop, and UI closeups."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent
SITE_ROOT = SCRIPT_ROOT.parents[1]
PLAN_PATH = SCRIPT_ROOT / "manifest.json"
BROWSER_RUNNER = SCRIPT_ROOT / "browser-capture.mjs"
GENERATED_MANIFEST = "manifest.json"
HOMEPAGE_MANIFEST = "homepage-manifest.json"
CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/"


class PipelineError(RuntimeError):
    pass


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PipelineError(f"could not read {path}: {error}") from error


def run(
    command: list[str], *, env: dict[str, str] | None = None,
    cwd: Path | None = None, timeout: float = 120,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command, check=True, env=env, cwd=cwd, timeout=timeout,
        text=True, capture_output=True,
    )


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise PipelineError(f"required tool is missing: {name}")
    return path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_records(app_root: Path) -> dict[str, dict[str, str]]:
    manifest = app_root / "demo-assets" / "cc0-raw" / "manifest.tsv"
    try:
        with manifest.open(encoding="utf-8", newline="") as source:
            return {row["filename"]: row for row in csv.DictReader(source, delimiter="\t")}
    except OSError as error:
        raise PipelineError(f"could not read RAW provenance manifest: {error}") from error


def validate_plan(plan: dict, app_root: Path) -> list[dict]:
    shots = plan.get("shots")
    configured_count = plan.get("capture", {}).get("count")
    if not isinstance(shots, list) or len(shots) != configured_count or len(shots) != 10:
        raise PipelineError("the gallery manifest must contain exactly ten shots")

    for field in ("id", "asset", "source", "subject", "title", "caption", "alt", "pane"):
        if any(not isinstance(shot.get(field), str) or not shot[field].strip() for shot in shots):
            raise PipelineError(f"every shot needs a non-empty {field}")

    for field in ("id", "asset", "source"):
        values = [shot[field] for shot in shots]
        if len(values) != len(set(values)):
            raise PipelineError(f"shot {field} values must be unique")

    records = source_records(app_root)
    raw_root = app_root / "demo-assets" / "cc0-raw" / "files"
    for shot in shots:
        if Path(shot["asset"]).name != shot["asset"] or not shot["asset"].endswith(".webp"):
            raise PipelineError(f"invalid screenshot asset name: {shot['asset']}")
        if Path(shot["source"]).name != shot["source"]:
            raise PipelineError(f"invalid source name: {shot['source']}")
        record = records.get(shot["source"])
        if not record or record.get("license_url") != CC0_URL:
            raise PipelineError(f"source is not recorded as CC0: {shot['source']}")
        source = raw_root / shot["source"]
        if not source.is_file():
            raise PipelineError(f"missing RAW source: {source}")
        with source.open("rb") as payload:
            prefix = payload.read(64)
        if source.stat().st_size < 4096 or prefix.startswith(
            b"version https://git-lfs.github.com/spec/v1"
        ):
            raise PipelineError(f"RAW source is a Git LFS pointer: {source}")
    return shots


def dimensions(path: Path) -> tuple[int, int]:
    completed = run([require_tool("sips"), "-g", "pixelWidth", "-g", "pixelHeight", str(path)])
    width = re.search(r"pixelWidth:\s+(\d+)", completed.stdout)
    height = re.search(r"pixelHeight:\s+(\d+)", completed.stdout)
    if not width or not height:
        raise PipelineError(f"could not read dimensions for {path}")
    return int(width.group(1)), int(height.group(1))


def validate_outputs(plan: dict, shots: list[dict], output_dir: Path) -> list[dict]:
    expected_width = int(plan["capture"]["width"])
    page_html = (SITE_ROOT / "screenshots.html").read_text(encoding="utf-8")
    decoded_html = html.unescape(page_html)
    results = []
    heights = set()
    for shot in shots:
        path = output_dir / shot["asset"]
        if not path.is_file() or path.stat().st_size < 20_000:
            raise PipelineError(f"missing or undersized screenshot: {path}")
        width, height = dimensions(path)
        if width != expected_width or height < 900:
            raise PipelineError(f"unexpected screenshot dimensions: {path} is {width}x{height}")
        heights.add(height)
        if f'src="screenshots/{shot["asset"]}"' not in page_html:
            raise PipelineError(f"screenshots.html does not reference {shot['asset']}")
        if (shot["alt"] not in decoded_html or shot["title"] not in decoded_html
                or shot["caption"] not in decoded_html):
            raise PipelineError(f"screenshots.html copy drifted from {shot['id']}")
        results.append({
            "id": shot["id"], "asset": shot["asset"], "source": shot["source"],
            "subject": shot["subject"], "width": width, "height": height,
            "bytes": path.stat().st_size, "sha256": sha256(path),
        })
    if len(heights) != 1:
        raise PipelineError(f"gallery screenshots do not share one aspect ratio: {sorted(heights)}")
    return results


def homepage_entries(plan: dict) -> list[dict]:
    homepage = plan.get("homepage", {})
    entries = [homepage.get("hero", {}), *homepage.get("details", [])]
    shot_ids = {shot["id"] for shot in plan["shots"]}
    assets = {shot["asset"] for shot in plan["shots"]}
    ids = set()
    for entry in entries:
        for field in ("id", "sourceShot", "asset", "alt"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise PipelineError(f"homepage image needs a non-empty {field}")
        if entry["sourceShot"] not in shot_ids:
            raise PipelineError(f"unknown homepage source shot: {entry['sourceShot']}")
        if (entry["id"] in ids or entry["asset"] in assets
                or Path(entry["asset"]).name != entry["asset"]
                or not entry["asset"].endswith(".webp")):
            raise PipelineError(f"invalid or duplicate homepage asset: {entry['asset']}")
        ids.add(entry["id"])
        assets.add(entry["asset"])
        crop = entry.get("crop")
        if (not isinstance(crop, list) or len(crop) != 4
                or any(type(value) is not int for value in crop)
                or min(crop[:2]) < 0 or min(crop[2:]) <= 0):
            raise PipelineError(f"invalid crop rectangle for {entry['id']}")
        # cwebp rounds crop origins down to even pixels; reject ambiguous inputs.
        if crop[0] % 2 or crop[1] % 2:
            raise PipelineError(f"crop x/y must be even pixels for {entry['id']}")
    for entry in homepage.get("details", []):
        for field in ("title", "label", "caption"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise PipelineError(f"homepage detail needs a non-empty {field}")
    return entries


def homepage_inputs(plan: dict, output_dir: Path) -> tuple[dict, list[dict]]:
    generated = load_json(output_dir / GENERATED_MANIFEST)
    sources = {shot["id"]: shot for shot in plan["shots"]}
    recorded = {shot["id"]: shot for shot in generated.get("shots", [])}
    if generated.get("license") != CC0_URL or not generated.get("appRevision"):
        raise PipelineError("homepage sources need recorded CC0 provenance and app revision")
    inputs = []
    for entry in homepage_entries(plan):
        shot = sources[entry["sourceShot"]]
        source = output_dir / shot["asset"]
        record = recorded.get(shot["id"], {})
        if (record.get("asset") != shot["asset"] or record.get("source") != shot["source"]
                or not source.is_file() or record.get("sha256") != sha256(source)):
            raise PipelineError(f"homepage source differs from recorded capture: {shot['asset']}")
        width, height = dimensions(source)
        if (width, height) != (record.get("width"), record.get("height")):
            raise PipelineError(f"homepage source dimensions drifted: {shot['asset']}")
        x, y, crop_width, crop_height = entry["crop"]
        if x + crop_width > width or y + crop_height > height:
            raise PipelineError(f"crop extends outside source image: {entry['id']}")
        inputs.append({
            "id": entry["id"], "asset": entry["asset"], "crop": entry["crop"],
            "sourceShot": shot["id"], "sourceAsset": shot["asset"],
            "sourceSha256": record["sha256"], "width": crop_width, "height": crop_height,
        })
    return generated, inputs


def homepage_blocks(plan: dict) -> dict[str, str]:
    escape = html.escape
    homepage = plan["homepage"]
    hero = homepage["hero"]
    shots = {shot["id"]: shot for shot in plan["shots"]}
    blocks = {"HERO": f'''        <div class="hero-preview">
          <a class="product-shot reveal" href="screenshots.html" aria-label="View LightTable screenshots">
            <img src="screenshots/{escape(hero['asset'])}" alt="{escape(hero['alt'])}" width="{hero['crop'][2]}" height="{hero['crop'][3]}" fetchpriority="high" />
          </a>
          <a class="screenshot-link reveal" href="screenshots.html">see screenshots</a>
        </div>'''}
    details = []
    for entry in homepage["details"]:
        source = shots[entry["sourceShot"]]
        details.append(f'''        <figure class="ui-detail reveal" data-detail="{escape(entry['id'])}">
          <div class="ui-detail-visual">
            <a class="ui-detail-overview" href="screenshots.html" aria-label="See the full {escape(source['title'])}">
              <img src="screenshots/{escape(source['asset'])}" alt="{escape(source['alt'])}" width="{plan['capture']['width']}" height="{round(plan['capture']['width'] * plan['capture']['viewportHeight'] / plan['capture']['viewportWidth'])}" loading="lazy" />
            </a>
            <a class="ui-detail-inset" href="screenshots/{escape(entry['asset'])}" aria-label="Enlarge {escape(entry['label'].split(' / ')[-1])} controls">
              <img src="screenshots/{escape(entry['asset'])}" alt="{escape(entry['alt'])}" width="{entry['crop'][2]}" height="{entry['crop'][3]}" loading="lazy" />
            </a>
          </div>
          <figcaption>
            <p class="eyebrow">{escape(entry['label'])}</p>
            <h3>{escape(entry['title'])}</h3>
            <p class="ui-detail-caption">{escape(entry['caption'])}</p>
          </figcaption>
        </figure>''')
    blocks["DETAILS"] = '''      <section class="ui-details" aria-labelledby="ui-details-title">
        <header class="ui-details-intro reveal">
          <p class="eyebrow">Inside LightTable</p>
          <h2 id="ui-details-title">A closer look.</h2>
        </header>
''' + "\n\n".join(details) + '''
        <a class="text-link" href="screenshots.html">See all editing modes <span aria-hidden="true">→</span></a>
      </section>'''
    return blocks


def homepage_html(plan: dict, page: str) -> str:
    for name, block in homepage_blocks(plan).items():
        pattern = rf"(<!-- BEGIN HOMEPAGE {name} -->\n).*?([ \t]*<!-- END HOMEPAGE {name} -->)"
        page, count = re.subn(pattern, lambda match: match[1] + block + "\n" + match[2], page, flags=re.S)
        if count != 1:
            raise PipelineError(f"index.html needs exactly one HOMEPAGE {name} marker pair")
    return page


def check_homepage(plan: dict, output_dir: Path) -> None:
    generated, inputs = homepage_inputs(plan, output_dir)
    manifest = load_json(output_dir / HOMEPAGE_MANIFEST)
    if (manifest.get("appRevision") != generated["appRevision"]
            or manifest.get("sourceCapturedAt") != generated.get("capturedAt")):
        raise PipelineError("homepage crops refer to a different app capture; run --derive-homepage")
    records = manifest.get("images", [])
    if len(records) != len(inputs):
        raise PipelineError("homepage crop count drifted; run --derive-homepage")
    for expected, recorded in zip(inputs, records):
        path = output_dir / expected["asset"]
        if any(recorded.get(key) != value for key, value in expected.items()):
            raise PipelineError(f"stale homepage crop: {expected['id']}; run --derive-homepage")
        if (not path.is_file() or sha256(path) != recorded.get("sha256")
                or dimensions(path) != (expected["width"], expected["height"])):
            raise PipelineError(f"homepage crop file drifted: {path.name}")
    page = (SITE_ROOT / "index.html").read_text(encoding="utf-8")
    if homepage_html(plan, page) != page:
        raise PipelineError("homepage image markup drifted; run --derive-homepage")


def build_homepage(plan: dict, output_dir: Path) -> None:
    generated, inputs = homepage_inputs(plan, output_dir)
    page_path = SITE_ROOT / "index.html"
    page = homepage_html(plan, page_path.read_text(encoding="utf-8"))
    cwebp = require_tool("cwebp")
    # Stage every crop before touching the existing assets or page.
    with tempfile.TemporaryDirectory(prefix=".homepage-", dir=output_dir) as directory:
        temporary = Path(directory)
        records = []
        for entry in inputs:
            destination = temporary / entry["asset"]
            run([cwebp, "-quiet", "-lossless", "-exact", "-crop",
                 *map(str, entry["crop"]), str(output_dir / entry["sourceAsset"]),
                 "-o", str(destination)])
            if dimensions(destination) != (entry["width"], entry["height"]):
                raise PipelineError(f"unexpected generated crop dimensions: {entry['id']}")
            records.append({**entry, "sha256": sha256(destination), "bytes": destination.stat().st_size})
        for entry in inputs:
            os.replace(temporary / entry["asset"], output_dir / entry["asset"])
    manifest = {
        "schema": 1, "appRevision": generated["appRevision"],
        "sourceCapturedAt": generated.get("capturedAt"),
        "method": "Lossless pixel crops of the recorded real LightTable screenshots; no UI reconstruction",
        "license": generated["license"], "images": records,
    }
    (output_dir / HOMEPAGE_MANIFEST).write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )
    page_path.write_text(page, encoding="utf-8")
    check_homepage(plan, output_dir)
    print(f"Generated homepage hero and {len(inputs) - 1} UI closeups from recorded screenshots.")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def request_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=3) as response:
        return json.load(response)


def wait_for_server(base_url: str, process: subprocess.Popen[str], expected: set[str]) -> None:
    deadline = time.monotonic() + 240
    last_error = ""
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise PipelineError(f"LightTable server exited during startup ({process.returncode})")
        try:
            request_json(f"{base_url}/api/health")
            payload = request_json(f"{base_url}/api/images?limit=100")
            seen = {item.get("displayName") for item in payload.get("images", [])}
            if expected <= seen:
                return
        except (OSError, ValueError, urllib.error.URLError) as error:
            last_error = str(error)
        time.sleep(0.4)
    raise PipelineError(f"LightTable did not index all ten RAWs within 240 seconds: {last_error}")


def find_playwright_module() -> Path:
    candidates = []
    configured = os.environ.get("LIGHTTABLE_PLAYWRIGHT_MODULE")
    if configured:
        candidates.append(Path(configured).expanduser())
    candidates.extend([
        Path("/opt/homebrew/lib/node_modules/playwright/index.mjs"),
        Path("/usr/local/lib/node_modules/playwright/index.mjs"),
    ])
    candidates.extend(Path.home().glob(".npm/_npx/*/node_modules/playwright/index.mjs"))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise PipelineError("Playwright is missing; install it globally or set LIGHTTABLE_PLAYWRIGHT_MODULE")


def find_browser() -> Path:
    configured = os.environ.get("LIGHTTABLE_PLAYWRIGHT_BROWSER")
    candidates = [Path(configured).expanduser()] if configured else []
    candidates.extend(sorted(
        Path.home().glob(
            "Library/Caches/ms-playwright/chromium_headless_shell-*/"
            "chrome-headless-shell-mac-*/chrome-headless-shell"
        ), reverse=True,
    ))
    candidates.extend(sorted(
        Path.home().glob(
            "Library/Caches/ms-playwright/chromium-*/chrome-mac-*/Chromium.app/Contents/MacOS/Chromium"
        ), reverse=True,
    ))
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate.resolve()
    raise PipelineError("a Playwright Chromium executable is missing")


def stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def app_revision(app_root: Path) -> str:
    try:
        return run(["git", "rev-parse", "HEAD"], cwd=app_root).stdout.strip()
    except subprocess.SubprocessError:
        return "unknown"


def capture(plan: dict, shots: list[dict], app_root: Path, output_dir: Path) -> None:
    python = app_root / ".venv" / "bin" / "python"
    server = app_root / "server.py"
    if not python.is_file() or not os.access(python, os.X_OK):
        raise PipelineError(f"missing app Python runtime: {python}")
    if not server.is_file() or not BROWSER_RUNNER.is_file():
        raise PipelineError("the LightTable server or browser capture runner is missing")

    node = require_tool("node")
    cwebp = require_tool("cwebp")
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lighttable-website-gallery-") as name:
        temporary = Path(name)
        photos = temporary / "photos"
        pngs = temporary / "pngs"
        photos.mkdir()
        pngs.mkdir()
        raw_root = app_root / "demo-assets" / "cc0-raw" / "files"
        for shot in shots:
            source = raw_root / shot["source"]
            destination = photos / source.name
            try:
                os.link(source, destination)
            except OSError:
                shutil.copy2(source, destination)

        port = free_port()
        base_url = f"http://127.0.0.1:{port}"
        server_log = temporary / "server.log"
        environment = dict(os.environ)
        environment.update({
            "LIGHTTABLE_DIR": str(photos),
            "LIGHTTABLE_PORT": str(port),
            "LIGHTTABLE_CATALOG": "1",
            "LIGHTTABLE_CATALOG_FILE": str(temporary / "catalog.sqlite3"),
            "LIGHTTABLE_CATALOG_MIRROR": "0",
            "LIGHTTABLE_WATCH": "0",
            "LIGHTTABLE_CACHE_DIR": str(temporary / "cache"),
            "LIGHTTABLE_PREFS_FILE": str(temporary / "prefs.json"),
            "LIGHTTABLE_PRESETS_FILE": str(temporary / "presets.json"),
            "LIGHTTABLE_AI_DIR": str(temporary / "ai"),
            "LIGHTTABLE_INSTANCE_DIR": str(temporary / "instances"),
            "LIGHTTABLE_SERVER_LOG": str(server_log),
            "MPLCONFIGDIR": str(temporary / "matplotlib"),
            "NUMBA_CACHE_DIR": str(temporary / "numba"),
            "PYTHONDONTWRITEBYTECODE": "1",
        })
        with server_log.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                [str(python), str(server)], cwd=app_root, env=environment,
                stdout=log, stderr=subprocess.STDOUT, text=True,
            )
            try:
                wait_for_server(base_url, process, {shot["source"] for shot in shots})
                config = {
                    "baseUrl": base_url,
                    "browserExecutable": str(find_browser()),
                    "outputDirectory": str(pngs),
                    "viewport": {
                        "width": int(plan["capture"]["viewportWidth"]),
                        "height": int(plan["capture"]["viewportHeight"]),
                    },
                    "settleMilliseconds": round(float(plan["capture"]["settleSeconds"]) * 1000),
                    "shots": shots,
                }
                config_path = temporary / "capture-config.json"
                config_path.write_text(json.dumps(config), encoding="utf-8")
                runner_environment = dict(environment)
                runner_environment["LIGHTTABLE_PLAYWRIGHT_MODULE"] = str(find_playwright_module())
                try:
                    completed = run(
                        [node, str(BROWSER_RUNNER), str(config_path)],
                        env=runner_environment, cwd=app_root, timeout=1800,
                    )
                except subprocess.CalledProcessError as error:
                    detail = "\n".join(filter(None, [error.stdout, error.stderr]))[-6000:]
                    raise PipelineError(f"browser capture failed:\n{detail}") from error
                summary = json.loads(completed.stdout)
            finally:
                stop_process(process)

        for index, shot in enumerate(shots, start=1):
            png = pngs / f"{shot['id']}.png"
            destination = output_dir / shot["asset"]
            converted = temporary / shot["asset"]
            if not png.is_file() or png.stat().st_size < 20_000:
                raise PipelineError(f"browser did not produce {png.name}")
            run([
                cwebp, "-quiet", "-q", str(plan["capture"]["quality"]),
                "-resize", str(plan["capture"]["width"]), "0",
                str(png), "-o", str(converted),
            ])
            os.replace(converted, destination)
            recorded = next(item for item in summary["shots"] if item["id"] == shot["id"])
            print(f"[{index:02d}/10] {shot['id']} · {shot['source']} · {recorded['backend']}")

    records = validate_outputs(plan, shots, output_dir)
    generated = {
        "schema": 1,
        "capturedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "appRevision": app_revision(app_root),
        "captureMethod": "Playwright rendering the real LightTable interface",
        "sourceCollection": "LightTable CC0 RAW demo collection",
        "license": CC0_URL,
        "shotCount": len(records),
        "shots": records,
    }
    (output_dir / GENERATED_MANIFEST).write_text(
        json.dumps(generated, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )
    build_homepage(plan, output_dir)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-root", type=Path,
                        help="clean LightTable app checkout containing the CC0 RAW collection")
    parser.add_argument("--output-dir", type=Path, default=SITE_ROOT / "screenshots")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true",
                        help="validate the plan, published assets, provenance, and HTML references")
    mode.add_argument("--dry-run", action="store_true",
                        help="validate and print the ten-shot plan without starting LightTable")
    mode.add_argument("--derive-homepage", action="store_true",
                      help="rebuild homepage crops and HTML from recorded screenshots; no app needed")
    arguments = parser.parse_args()
    if not arguments.derive_homepage and not arguments.app_root:
        parser.error("--app-root is required except with --derive-homepage")

    try:
        output_dir = arguments.output_dir.expanduser().resolve()
        plan = load_json(PLAN_PATH)
        homepage_entries(plan)
        if arguments.derive_homepage:
            build_homepage(plan, output_dir)
            return 0
        app_root = arguments.app_root.expanduser().resolve()
        shots = validate_plan(plan, app_root)
        if arguments.dry_run:
            for index, shot in enumerate(shots, start=1):
                print(f"{index:02d}  {shot['id']:<20} {shot['source']}")
            for entry in homepage_entries(plan):
                print(f"    {entry['id']:<20} crop {entry['crop']} from {entry['sourceShot']}")
            return 0
        if arguments.check:
            records = validate_outputs(plan, shots, output_dir)
            generated = load_json(output_dir / GENERATED_MANIFEST)
            if generated.get("shotCount") != 10:
                raise PipelineError("generated screenshot manifest does not record ten shots")
            current = {item["asset"]: item["sha256"] for item in records}
            recorded = {item["asset"]: item["sha256"] for item in generated.get("shots", [])}
            if current != recorded:
                raise PipelineError("published screenshot hashes drifted from screenshots/manifest.json")
            check_homepage(plan, output_dir)
            print("Screenshot assets verified: 10 gallery shots plus homepage hero, UI closeups, and HTML.")
            return 0
        capture(plan, shots, app_root, output_dir)
        print(f"Generated website screenshots and {output_dir / GENERATED_MANIFEST}")
        return 0
    except (PipelineError, subprocess.SubprocessError, OSError, json.JSONDecodeError) as error:
        print(f"capture.py: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
