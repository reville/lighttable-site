const releaseButton = document.querySelector("#release-download");
const installCommand = document.querySelector("#install-command");
const copyCommandButton = document.querySelector(".copy-command");
const installStatus = document.querySelector("#install-status");

if (installCommand && copyCommandButton && installStatus) {
  const defaultStatus = installStatus.textContent;
  let resetCopyState;
  copyCommandButton.hidden = false;

  copyCommandButton.addEventListener("click", async () => {
    clearTimeout(resetCopyState);
    copyCommandButton.classList.remove("is-copied");

    try {
      await navigator.clipboard.writeText(installCommand.textContent.trim());
      copyCommandButton.classList.add("is-copied");
      installStatus.textContent = "Copied · Installer coming soon";
      resetCopyState = setTimeout(() => {
        copyCommandButton.classList.remove("is-copied");
        installStatus.textContent = defaultStatus;
      }, 2500);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(installCommand);
      selection?.removeAllRanges();
      selection?.addRange(range);
      installStatus.textContent = "Select and copy the command · Coming soon";
    }
  });
}

function detectedPlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "";

  if (/mac/i.test(platform)) return "macOS";
  if (/win/i.test(platform)) return "Windows";
  if (/linux/i.test(platform)) return "Linux";
  return null;
}

function matchingAsset(assets, platform) {
  const extensions = {
    macOS: [".dmg", ".pkg", ".zip"],
    Windows: [".exe", ".msi"],
    Linux: [".appimage", ".deb", ".rpm", ".tar.gz"],
  }[platform] || [];

  return assets.find((asset) => {
    const name = asset.name.toLowerCase();
    return extensions.some((extension) => name.endsWith(extension));
  });
}

if (releaseButton) {
  const platform = detectedPlatform();

  fetch("https://api.github.com/repos/reville/lighttable-digital-darkroom/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((response) => {
      if (!response.ok) throw new Error("No published release");
      return response.json();
    })
    .then((release) => {
      const asset = matchingAsset(release.assets || [], platform);

      if (asset && platform) {
        releaseButton.href = asset.browser_download_url;
        releaseButton.textContent = `Download for ${platform}`;
        return;
      }

      releaseButton.href = release.html_url;
    })
    .catch(() => {
      // The releases page remains a useful destination before the first build ships.
    });
}

const reveals = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12 },
  );

  reveals.forEach((element) => observer.observe(element));
} else {
  reveals.forEach((element) => element.classList.add("is-visible"));
}

const featureSearch = document.querySelector("#feature-search");

if (featureSearch) {
  const searchForm = featureSearch.closest("form");
  const clearButton = document.querySelector("#feature-search-clear");
  const emptyClearButton = document.querySelector("#feature-empty-clear");
  const resultText = document.querySelector("#feature-results");
  const emptyState = document.querySelector("#feature-empty");
  const featureGroups = [...document.querySelectorAll("[data-feature-group]")];
  const featureItems = [...document.querySelectorAll("[data-feature]")];
  const total = featureItems.length;
  const normalize = (value) => value.toLocaleLowerCase().normalize("NFKD");

  featureItems.forEach((item) => {
    const group = item.closest("[data-feature-group]");
    const groupHeader = group?.querySelector(".feature-group-header");
    item.searchText = normalize(`${groupHeader?.textContent || ""} ${item.textContent || ""}`);
  });

  function updateFeatureResults() {
    const rawQuery = featureSearch.value.trim();
    const query = normalize(rawQuery);
    let visibleCount = 0;

    featureItems.forEach((item) => {
      const matches = !query || item.searchText.includes(query);
      item.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    featureGroups.forEach((group) => {
      group.hidden = !group.querySelector("[data-feature]:not([hidden])");
    });

    clearButton.hidden = !rawQuery;
    emptyState.hidden = visibleCount !== 0;
    resultText.textContent = rawQuery
      ? `${visibleCount} ${visibleCount === 1 ? "match" : "matches"} for “${rawQuery}”`
      : `${total} features, organized by workflow`;
  }

  function clearFeatureSearch() {
    featureSearch.value = "";
    updateFeatureResults();
    featureSearch.focus();
  }

  searchForm.addEventListener("submit", (event) => event.preventDefault());
  featureSearch.addEventListener("input", updateFeatureResults);
  featureSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && featureSearch.value) clearFeatureSearch();
  });
  clearButton.addEventListener("click", clearFeatureSearch);
  emptyClearButton.addEventListener("click", clearFeatureSearch);
  updateFeatureResults();
}
