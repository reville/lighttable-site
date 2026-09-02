const releaseButton = document.querySelector("#release-download");
const typefaceSelect = document.querySelector("#typeface-select");

const typefaces = {
  "sf-pro": {
    stack: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif',
  },
  inter: { family: "Inter", weights: "400;500;600;700" },
  geist: { family: "Geist", weights: "400;500;600;700" },
  manrope: { family: "Manrope", weights: "400;500;600;700" },
  "space-grotesk": { family: "Space Grotesk", weights: "400;500;600;700" },
  "plus-jakarta-sans": { family: "Plus Jakarta Sans", weights: "400;500;600;700" },
  "dm-sans": { family: "DM Sans", weights: "400;500;600;700" },
  sora: { family: "Sora", weights: "400;500;600;700" },
  outfit: { family: "Outfit", weights: "400;500;600;700" },
  urbanist: { family: "Urbanist", weights: "400;500;600;700" },
  "instrument-sans": { family: "Instrument Sans", weights: "400;500;600;700" },
  "ibm-plex-sans": { family: "IBM Plex Sans", weights: "400;500;600;700" },
  archivo: { family: "Archivo", weights: "400;500;600;700" },
  onest: { family: "Onest", weights: "400;500;600;700" },
  "bricolage-grotesque": { family: "Bricolage Grotesque", weights: "400;500;600;700" },
  syne: { family: "Syne", weights: "400;500;600;700" },
  unbounded: { family: "Unbounded", weights: "400;500;600;700" },
  "chakra-petch": { family: "Chakra Petch", weights: "400;500;600;700" },
  "azeret-mono": { family: "Azeret Mono", weights: "400;500;600;700" },
  "space-mono": { family: "Space Mono", weights: "400;700" },
};

function applyTypeface(id) {
  const typeface = typefaces[id] || typefaces["sf-pro"];

  if (!typeface.family) {
    document.documentElement.style.setProperty("--typeface", typeface.stack);
    return;
  }

  let fontLink = document.querySelector("#preview-font");
  if (!fontLink) {
    fontLink = document.createElement("link");
    fontLink.id = "preview-font";
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);
  }

  const family = typeface.family.replaceAll(" ", "+");
  fontLink.href = `https://fonts.googleapis.com/css2?family=${family}:wght@${typeface.weights}&display=swap`;
  document.documentElement.style.setProperty(
    "--typeface",
    `"${typeface.family}", -apple-system, BlinkMacSystemFont, sans-serif`,
  );
}

let savedTypeface = "sf-pro";
try {
  savedTypeface = localStorage.getItem("lighttable-typeface") || savedTypeface;
} catch {
  // Local storage may be unavailable in strict privacy modes.
}

applyTypeface(savedTypeface);

if (typefaceSelect) {
  typefaceSelect.value = typefaces[savedTypeface] ? savedTypeface : "sf-pro";
  typefaceSelect.addEventListener("change", (event) => {
    const id = event.target.value;
    applyTypeface(id);

    try {
      localStorage.setItem("lighttable-typeface", id);
    } catch {
      // The preview still works for the current visit.
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
