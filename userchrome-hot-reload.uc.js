(function () {
  "use strict";

  const mostRecentWindow = Services.wm.getMostRecentWindow("navigator:browser");
  if (window !== mostRecentWindow) {
    return;
  }
  if (window.__userChromeHotReloadInitialized) {
    return;
  }
  window.__userChromeHotReloadInitialized = true;

  const PREF_PATH = "extensions.zen-userchrome-hot-reload.watch-path";
  const PREF_INTERVAL = "extensions.zen-userchrome-hot-reload.poll-interval-ms";
  const PREF_SINE = "extensions.zen-userchrome-hot-reload.reload-sine-mods";
  const PREF_TOAST = "extensions.zen-userchrome-hot-reload.toast";
  const PREF_HOTKEY = "extensions.zen-userchrome-hot-reload.hotkey";

  const profileChromeDir = PathUtils.join(PathUtils.profileDir, "chrome");
  const chromeEntryPath = PathUtils.join(profileChromeDir, "userChrome.css");

  let lastModifiedTimes = new Map();
  let pendingReload = null;

  function getPref(type, name, fallback) {
    try {
      if (!Services.prefs.prefHasUserValue(name)) {
        return fallback;
      }
      if (type === "string") {
        const value = Services.prefs.getStringPref(name).trim();
        return value || fallback;
      }
      if (type === "bool") {
        return Services.prefs.getBoolPref(name);
      }
      if (type === "int") {
        return Services.prefs.getIntPref(name) || fallback;
      }
    } catch (e) {}
    return fallback;
  }

  function getWatchRoot() {
    return getPref("string", PREF_PATH, "") || profileChromeDir;
  }

  function getPollInterval() {
    return Math.max(200, getPref("int", PREF_INTERVAL, 500));
  }

  function chromeWindows() {
    const windows = [];
    const enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
      windows.push(enumerator.getNext());
    }
    return windows;
  }

  async function collectCssFiles(root) {
    const paths = [];
    try {
      if (!(await IOUtils.exists(root))) {
        return paths;
      }
      const stat = await IOUtils.stat(root);
      if (stat.type === "regular") {
        paths.push(root);
        return paths;
      }
      if (stat.type !== "directory") {
        return paths;
      }

      const children = await IOUtils.getChildren(root);
      for (const child of children) {
        try {
          const childStat = await IOUtils.stat(child);
          const baseName = PathUtils.filename(child);
          if (childStat.type === "regular" && baseName.endsWith(".css")) {
            paths.push(child);
          } else if (childStat.type === "directory" && baseName === "mods") {
            const modChildren = await IOUtils.getChildren(child);
            for (const modChild of modChildren) {
              try {
                const modStat = await IOUtils.stat(modChild);
                if (modStat.type === "regular" && modChild.endsWith(".css")) {
                  paths.push(modChild);
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    } catch (e) {
      console.error("[UserChrome Hot-Reload] Failed to scan watch path:", e);
    }
    return paths;
  }

  async function tick() {
    const paths = await collectCssFiles(getWatchRoot());
    const pathSet = new Set(paths);

    for (const cachedPath of lastModifiedTimes.keys()) {
      if (!pathSet.has(cachedPath)) {
        lastModifiedTimes.delete(cachedPath);
      }
    }

    let changed = false;
    for (const path of paths) {
      try {
        const info = await IOUtils.stat(path);
        const previous = lastModifiedTimes.get(path);
        if (previous === undefined) {
          lastModifiedTimes.set(path, info.lastModified);
        } else if (info.lastModified > previous) {
          lastModifiedTimes.set(path, info.lastModified);
          changed = true;
        }
      } catch (e) {}
    }

    if (changed) {
      if (pendingReload) {
        clearTimeout(pendingReload);
      }
      pendingReload = setTimeout(() => {
        pendingReload = null;
        reloadNow();
      }, 300);
    }
  }

  function reloadChromeSheets() {
    let uri;
    try {
      uri = Services.io.newURI(PathUtils.toFileURI(chromeEntryPath));
    } catch (e) {
      return;
    }

    for (const win of chromeWindows()) {
      const utils = win.windowUtils;
      try {
        utils.removeSheet(uri, utils.USER_SHEET);
      } catch (e) {}
      try {
        utils.loadSheet(uri, utils.USER_SHEET);
      } catch (e) {
        console.warn("[UserChrome Hot-Reload] Failed to reload chrome sheet:", e);
      }
    }

    Services.obs.notifyObservers(null, "chrome-flush-caches", null);
  }

  function reloadContentPages() {
    Services.obs.notifyObservers(null, "chrome-flush-caches", null);
    let reloaded = 0;
    for (const win of chromeWindows()) {
      if (!win.gBrowser) {
        continue;
      }
      for (const tab of win.gBrowser.tabs) {
        const uri = tab.linkedBrowser?.currentURI;
        if (!uri || uri.scheme !== "about") {
          continue;
        }
        try {
          tab.linkedBrowser.reload();
          reloaded++;
        } catch (e) {
          console.warn("[UserChrome Hot-Reload] Failed to reload content page:", e);
        }
      }
    }
    if (reloaded === 0) {
      console.log("[UserChrome Hot-Reload] No open in-content pages to refresh.");
    }
  }

  function reloadSineMods() {
    if (!getPref("bool", PREF_SINE, true)) {
      return;
    }
    try {
      const win = chromeWindows()[0];
      win?.manager?.rebuildMods?.(true, true);
    } catch (e) {
      console.warn("[UserChrome Hot-Reload] Failed to rebuild Sine mods:", e);
    }
  }

  function showToast(message) {
    if (!getPref("bool", PREF_TOAST, true)) {
      return;
    }
    try {
      const win = chromeWindows()[0];
      if (win?.gZenUIManager?.showToast) {
        win.gZenUIManager.showToast("zen-panel-ui-boosts-exported-message");
      }
    } catch (e) {}
  }

  function reloadNow() {
    console.log("[UserChrome Hot-Reload] Change detected - reloading userChrome.css & userContent.css");
    reloadChromeSheets();
    reloadContentPages();
    reloadSineMods();
    showToast("UserChrome & Content reloaded");
  }

  function setupHotkey() {
    const combo = getPref("string", PREF_HOTKEY, "").toUpperCase();
    if (!combo) {
      return;
    }
    const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      return;
    }
    const key = parts.pop();
    const needsCtrl = parts.includes("CTRL");
    const needsShift = parts.includes("SHIFT");
    const needsAlt = parts.includes("ALT");
    const needsMeta = parts.includes("META");

    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key.toUpperCase() !== key) {
          return;
        }
        if (event.ctrlKey !== needsCtrl) {
          return;
        }
        if (event.shiftKey !== needsShift) {
          return;
        }
        if (event.altKey !== needsAlt) {
          return;
        }
        if (event.metaKey !== needsMeta) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        reloadNow();
      },
      true
    );
  }

  function init() {
    setupHotkey();
    setInterval(tick, getPollInterval());
    tick();
    window.addEventListener("beforeunload", () => {
      window.__userChromeHotReloadInitialized = false;
    });
    console.log("[UserChrome Hot-Reload] Watcher initialized. Watching:", getWatchRoot());
  }

  init();
})();