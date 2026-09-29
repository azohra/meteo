export const THEME_PIN_SCRIPT = `(() => {
  let mode = "auto";
  try {
    const stored = localStorage.getItem("meteo-theme");
    if (stored === "light" || stored === "dark") mode = stored;
  } catch {}
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  const apply = () => {
    const resolved = mode === "auto" ? (media.matches ? "dark" : "light") : mode;
    /* A colour transition that is running when color-scheme flips keeps
       the old light-dark() arm in Chromium, so a button can end up dark
       on dark. Switch with transitions off, then restore them after the
       new styles are computed. */
    const switching = root.dataset.theme !== undefined && root.dataset.theme !== resolved;
    if (switching) root.dataset.themeSwitching = "";
    root.dataset.theme = resolved;
    root.dataset.themeMode = mode;
    if (switching) {
      void getComputedStyle(root).colorScheme;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => delete root.dataset.themeSwitching);
      });
    }
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
