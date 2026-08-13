export const THEME_PIN_SCRIPT = `(() => {
  let mode = "auto";
  try {
    const stored = localStorage.getItem("meteo-theme");
    if (stored === "light" || stored === "dark") mode = stored;
  } catch {}
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const resolved = mode === "auto" ? (media.matches ? "dark" : "light") : mode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = mode;
  };
  apply();
  media.addEventListener("change", () => {
    if (mode === "auto") apply();
  });
  window.__meteoTheme = {
    get mode() {
      return mode;
    },
    set(next) {
      mode = next;
      try {
        if (next === "auto") localStorage.removeItem("meteo-theme");
        else localStorage.setItem("meteo-theme", next);
      } catch {}
      apply();
      window.dispatchEvent(new CustomEvent("meteo-theme-change"));
    },
  };
})();`;
