const releaseButton = document.querySelector("#release-download");

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

  fetch("https://api.github.com/repos/reville/lighttable-app/releases/latest", {
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
