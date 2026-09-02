const releaseButton = document.querySelector("#release-download");
const releaseNote = document.querySelector("#release-note");
const sourceButton = document.querySelector("#source-download");

function assetPriority(asset) {
  const name = asset.name.toLowerCase();
  if (name.endsWith(".dmg")) return 3;
  if (name.endsWith(".zip") && name.includes("lighttable")) return 2;
  if (name.endsWith(".zip")) return 1;
  return 0;
}

fetch("https://api.github.com/repos/reville/lighttable/releases/latest", {
  headers: { Accept: "application/vnd.github+json" },
})
  .then((response) => {
    if (!response.ok) throw new Error("No public release yet");
    return response.json();
  })
  .then((release) => {
    const downloadable = [...(release.assets || [])]
      .sort((a, b) => assetPriority(b) - assetPriority(a))
      .find((asset) => assetPriority(asset) > 0);

    releaseButton.href = downloadable?.browser_download_url || release.html_url;
    releaseButton.classList.remove("is-disabled");
    releaseButton.removeAttribute("aria-disabled");
    releaseButton.textContent = "Download for macOS";
    releaseNote.textContent = release.name
      ? `Latest release: ${release.name}`
      : "Latest public release";
  })
  .catch(() => {
    releaseButton.addEventListener("click", (event) => event.preventDefault());
  });

fetch("https://api.github.com/repos/reville/lighttable", {
  headers: { Accept: "application/vnd.github+json" },
})
  .then((response) => {
    if (!response.ok) throw new Error("Repository is not public yet");
    return response.json();
  })
  .then(() => {
    sourceButton.href = "https://github.com/reville/lighttable/archive/refs/heads/main.zip";
    sourceButton.classList.remove("is-disabled");
    sourceButton.removeAttribute("aria-disabled");
    sourceButton.textContent = "Download source";
  })
  .catch(() => {
    sourceButton.addEventListener("click", (event) => event.preventDefault());
  });
