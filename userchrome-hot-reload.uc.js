(function () {
  "use strict";

  const mostRecentWindow = Services.wm.getMostRecentWindow("navigator:browser");
  if (window.__userChromeHotReloadInitialized) {
    return;
  }
  window.__userChromeHotReloadInitialized = true;

  const PREF_PATH = "extensions.zen-userchrome-hot-reload.watch-path";
  const PREF_INTERVAL = "extensions.zen-userchrome-hot-reload.poll-interval-ms";
  const PREF_SINE = "extensions.zen-userchrome-hot-reload.reload-sine-mods";
  const PREF_TOAST = "extensions.zen-userchrome-hot-reload.toast";
  const PREF_HOTKEY = "extensions.zen-userchrome-hot-reload.hotkey";
  const PREF_NESTED = "extensions.zen-userchrome-hot-reload.watch-nested-directories";
  const PREF_EXCLUDED_DIRS = "extensions.zen-userchrome-hot-reload.excluded-dirs";
  const PREF_ENABLED = "extensions.zen-userchrome-hot-reload.enabled";

  const ACTOR_NAME = "UserChromeHotReload";
  const ACTOR_MODULE =
    "chrome://sine/content/zen-userchrome-hot-reload/hot-reload-content.sys.mjs";

  const profileChromeDir = PathUtils.join(PathUtils.profileDir, "chrome");
  const chromeEntryPath = PathUtils.join(profileChromeDir, "userChrome.css");
  const contentEntryPath = PathUtils.join(profileChromeDir, "userContent.css");

  let lastModifiedTimes = new Map();
  let directoryCache = new Map();
  let pendingReload = null;
  let reloadInProgress = false;
  let reloadRequested = false;
  let tickInProgress = false;
  let watcherGeneration = 0;
  let initialScanComplete = false;
  let pollTimer = null;
  let watcherActive = false;
  let hotkeyRegistered = false;
  let hotkeyListener = null;

  function getPref(type, name, fallback) {
    try {
      if (!Services.prefs.prefHasUserValue(name)) {
        return fallback;
      }
      if (type === "string") {
        return Services.prefs.getStringPref(name).trim();
      }
      if (type === "bool") {
        return Services.prefs.getBoolPref(name);
      }
      if (type === "int") {
        return Services.prefs.getIntPref(name);
      }
    } catch (e) {}
    return fallback;
  }

  function getWatchRoot() {
    return getPref("string", PREF_PATH, "") || profileChromeDir;
  }

  function getPollInterval() {
    const configured = getPref("string", PREF_INTERVAL, "500");
    const interval = Number.parseInt(configured, 10);
    return Number.isFinite(interval) && interval > 0 ? Math.max(200, interval) : 500;
  }

  function chromeWindows() {
    const windows = [];
    try {
      const enumerator = Services.wm.getEnumerator("navigator:browser");
      while (enumerator.hasMoreElements()) {
        try {
          windows.push(enumerator.getNext());
        } catch (e) {
          // Stop rather than risk looping if the enumerator cannot advance.
          console.warn("[UserChrome Hot-Reload] Could not retrieve the next browser window:", e);
          break;
        }
      }
    } catch (e) {
      // Keep callers from aborting the entire reload if enumeration fails.
      console.error("[UserChrome Hot-Reload] Could not enumerate browser windows:", e);
    }
    return windows;
  }

  async function collectCssFiles(root) {
    const paths = new Map();
    const watchNested = getPref("bool", PREF_NESTED, false);
    const excludedDirectories = new Set(
      getPref("string", PREF_EXCLUDED_DIRS, "sine-mods,JS,utils")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    );

    const visitedDirectories = new Set();

    async function scanDirectory(directory, recursive) {
      visitedDirectories.add(directory);
      let directoryStat;
      try {
        directoryStat = await IOUtils.stat(directory);
      } catch (e) {
        directoryCache.delete(directory);
        return;
      }
      if (directoryStat.type !== "directory") {
        directoryCache.delete(directory);
        return;
      }

      const cached = directoryCache.get(directory);
      const canReuse = cached &&
        cached.lastModified === directoryStat.lastModified &&
        cached.size === directoryStat.size;
      let entries;
      let refreshed = false;
      if (canReuse) {
        entries = cached.entries;
      } else {
        let children;
        try {
          children = await IOUtils.getChildren(directory);
        } catch (e) {
          console.warn("[UserChrome Hot-Reload] Failed to read directory:", directory, e);
          directoryCache.delete(directory);
          return;
        }
        entries = (
          await Promise.all(
            children.map(async (child) => {
              try {
                const info = await IOUtils.stat(child);
                return {
                  path: child,
                  baseName: PathUtils.filename(child),
                  type: info.type,
                  lastModified: info.lastModified,
                  size: info.size,
                };
              } catch (e) {
                // A child may disappear during a directory scan.
                return null;
              }
            })
          )
        ).filter(Boolean);
        directoryCache.set(directory, {
          lastModified: directoryStat.lastModified,
          size: directoryStat.size,
          entries,
        });
        refreshed = true;
      }

      const cssEntries = entries.filter(
        (entry) => entry.type === "regular" && entry.baseName.endsWith(".css")
      );
      const cssStats = await Promise.all(
        cssEntries.map(async (entry) => {
          if (refreshed) {
            return [entry.path, entry];
          }
          try {
            return [entry.path, await IOUtils.stat(entry.path)];
          } catch (e) {
            // A CSS file can disappear between polls.
            return [entry.path, null];
          }
        })
      );
      const cssInfoByPath = new Map(cssStats);

      for (const entry of entries) {
        const child = entry.path;
        const baseName = entry.baseName;
        if (entry.type === "regular" && baseName.endsWith(".css")) {
          const info = cssInfoByPath.get(child);
          if (info) {
            paths.set(child, { lastModified: info.lastModified, size: info.size });
          }
          continue;
        }

        if (entry.type !== "directory" || excludedDirectories.has(baseName)) {
          continue;
        }

        // Preserve the existing default: root CSS files and one level inside mods/.
        if (!recursive) {
          if (baseName === "mods") {
            await scanDirectory(child, watchNested);
          } else if (watchNested) {
            await scanDirectory(child, true);
          }
        } else {
          await scanDirectory(child, true);
        }
      }
    }

    try {
      if (!(await IOUtils.exists(root))) {
        directoryCache.clear();
        return paths;
      }

      const stat = await IOUtils.stat(root);
      if (stat.type === "regular") {
        directoryCache.clear();
        paths.set(root, { lastModified: stat.lastModified, size: stat.size });
        return paths;
      }
      if (stat.type !== "directory") {
        directoryCache.clear();
        return paths;
      }

      await scanDirectory(root, false);

      // Drop cache entries for directories removed or excluded since the last poll.
      for (const cachedDirectory of directoryCache.keys()) {
        if (!visitedDirectories.has(cachedDirectory)) {
          directoryCache.delete(cachedDirectory);
        }
      }
    } catch (e) {
      console.error("[UserChrome Hot-Reload] Failed to scan watch path:", e);
    }

    return paths;
  }

  async function tick() {
    if (!watcherActive || tickInProgress) {
      return;
    }
    tickInProgress = true;
    const generation = watcherGeneration;
    try {
    const files = await collectCssFiles(getWatchRoot());
    if (!watcherActive || generation !== watcherGeneration) {
      return;
    }

    for (const cachedPath of lastModifiedTimes.keys()) {
      if (!files.has(cachedPath)) {
        lastModifiedTimes.delete(cachedPath);
      }
    }

    let changed = false;
    for (const [path, current] of files) {
      const previous = lastModifiedTimes.get(path);
      if (previous === undefined) {
        lastModifiedTimes.set(path, current);
        if (initialScanComplete) {
          changed = true;
        }
      } else if (
        typeof previous !== "object" ||
        previous.lastModified !== current.lastModified ||
        previous.size !== current.size
      ) {
        lastModifiedTimes.set(path, current);
        changed = true;
      }
    }

    initialScanComplete = true;

    if (changed) {
      if (pendingReload) {
        clearTimeout(pendingReload);
      }
      pendingReload = setTimeout(() => {
        pendingReload = null;
        reloadNow();
      }, 300);
    }
    } finally {
      tickInProgress = false;
    }
  }

  function reloadChromeSheets() {
    let uri;
    try {
      uri = Services.io.newURI(PathUtils.toFileURI(chromeEntryPath));
    } catch (e) {
      console.error("[UserChrome Hot-Reload] Invalid userChrome.css URI:", e);
      return false;
    }

    let loaded = false;
    for (const win of chromeWindows()) {
      try {
        const utils = win.windowUtils;
        if (!utils) {
          continue;
        }
        try {
          utils.removeSheet(uri, utils.USER_SHEET);
        } catch (e) {}
        utils.loadSheet(uri, utils.USER_SHEET);
        loaded = true;
      } catch (e) {
        // A window may be closing; continue reloading the remaining windows.
        console.warn("[UserChrome Hot-Reload] Failed to reload chrome sheet:", e);
      }
    }

    try {
      Services.obs.notifyObservers(null, "chrome-flush-caches", null);
    } catch (e) {
      // Sheet reloads have already been attempted; a cache-flush failure
      // must not prevent the content stylesheet reload from running.
      console.warn("[UserChrome Hot-Reload] Failed to flush chrome caches:", e);
    }
    return loaded;
  }

  function collectBrowsingContexts(context, out = []) {
    if (!context) {
      return out;
    }
    out.push(context);

    // Browsing contexts can be torn down while tabs navigate or close.
    let children;
    try {
      children = context.children;
    } catch (e) {
      return out;
    }

    for (const child of children) {
      try {
        collectBrowsingContexts(child, out);
      } catch (e) {
        // Keep processing other frames if one disappears during traversal.
      }
    }
    return out;
  }

  async function reloadContentSheets() {
    let uri;
    try {
      uri = Services.io.newURI(PathUtils.toFileURI(contentEntryPath)).spec;
    } catch (e) {
      console.error("[UserChrome Hot-Reload] Invalid userContent.css URI:", e);
      return false;
    }

    const requests = [];
    let enumerationFailed = false;
    for (const win of chromeWindows()) {
      let tabs;
      try {
        tabs = win.gBrowser?.tabs;
      } catch (e) {
        // A browser window may be tearing down; continue with other windows.
        enumerationFailed = true;
        console.warn("[UserChrome Hot-Reload] Could not enumerate browser tabs:", e);
        continue;
      }
      if (!tabs) {
        continue;
      }

      let tabList;
      try {
        tabList = Array.from(tabs);
      } catch (e) {
        enumerationFailed = true;
        console.warn("[UserChrome Hot-Reload] Could not snapshot browser tabs:", e);
        continue;
      }

      for (const tab of tabList) {
        let browsingContext;
        try {
          browsingContext = tab.linkedBrowser?.browsingContext;
        } catch (e) {
          // A tab may close between enumeration and dispatch.
          continue;
        }
        if (!browsingContext) {
          continue;
        }
        for (const context of collectBrowsingContexts(browsingContext)) {
          try {
            const windowGlobal = context.currentWindowGlobal;
            if (!windowGlobal) {
              continue;
            }
            const actor = windowGlobal.getActor(ACTOR_NAME);
            if (actor) {
              requests.push(actor.sendQuery("update-sheets", { uri }));
            }
          } catch (e) {
            // A frame may navigate or close between enumeration and dispatch.
            console.warn("[UserChrome Hot-Reload] Could not contact a content actor:", e);
          }
        }
      }
    }

    if (requests.length === 0) {
      if (enumerationFailed) {
        console.error("[UserChrome Hot-Reload] Could not enumerate content documents; reload status is unknown.");
        return false;
      }
      console.info("[UserChrome Hot-Reload] No eligible content documents available; skipping content stylesheet refresh.");
      return null;
    }

    const results = await Promise.allSettled(requests);
    const failed = results.filter(
      (result) => result.status !== "fulfilled" || result.value?.ok !== true
    );
    if (failed.length) {
      console.error(
        "[UserChrome Hot-Reload] Failed to refresh content sheets in",
        failed.length,
        "of",
        results.length,
        "document(s)."
      );
    }
    return failed.length === 0;
  }

  function reloadSineMods() {
    if (!getPref("bool", PREF_SINE, true)) {
      return;
    }
    try {
      const win = Services.wm.getMostRecentWindow("navigator:browser");
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
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      const manager = win?.gZenUIManager;
      if (!manager?.showToast) {
        console.warn("[UserChrome Hot-Reload] Zen toast API unavailable; reload status is in the Browser Console.");
        return;
      }

      // Zen's toast API accepts Fluent IDs, not literal strings. Reuse its
      // styled toast element, then replace the label with this mod's message.
      const messageId = "zen-panel-ui-boosts-exported-message";
      const toastPromise = manager.showToast(messageId);
      const container = win.document.getElementById("zen-toast-container");
      const toast = Array.from(container?.children ?? []).find(
        (child) => child._messageId === messageId
      );
      const label = toast?.querySelector("label");
      if (label) {
        label.removeAttribute("data-l10n-id");
        label.removeAttribute("data-l10n-args");
        label.setAttribute("value", message);
      } else {
        console.warn("[UserChrome Hot-Reload] Zen toast label unavailable; reload status:", message);
      }
      toastPromise?.catch((e) => {
        console.warn("[UserChrome Hot-Reload] Failed to show toast:", e);
      });
    } catch (e) {
      console.warn("[UserChrome Hot-Reload] Failed to show toast:", e);
    }
  }

  async function reloadNow() {
    if (!getPref("bool", PREF_ENABLED, true)) {
      return;
    }

    // A hotkey press can overlap a debounced file-change reload. Coalesce
    // overlapping requests, then run one more pass to pick up changes that
    // arrived while the active reload was in progress.
    if (reloadInProgress) {
      reloadRequested = true;
      return;
    }
    reloadInProgress = true;

    try {
      console.log("[UserChrome Hot-Reload] Change detected - reloading userChrome.css & userContent.css");
      const chromeOk = reloadChromeSheets();
      let contentOk = false;
      try {
        contentOk = await reloadContentSheets();
      } catch (e) {
        console.error("[UserChrome Hot-Reload] Content reload request failed:", e);
      }
      reloadSineMods();

      if (contentOk === null) {
        const message = chromeOk
          ? "UserChrome reloaded; no content documents to refresh."
          : "UserChrome reload failed; no content documents to refresh.";
        if (!chromeOk) {
          console.error("[UserChrome Hot-Reload] UserChrome reload failed; no content documents were available to refresh.");
        }
        showToast(message);
      } else if (chromeOk && contentOk) {
        showToast("UserChrome & Content reloaded");
      } else if (chromeOk) {
        console.error("[UserChrome Hot-Reload] UserChrome reloaded, but userContent.css failed to reload. Check the Browser Console.");
        showToast("UserChrome reloaded; content reload failed. Check the Browser Console.");
      } else if (contentOk) {
        console.error("[UserChrome Hot-Reload] userContent.css reloaded, but userChrome.css failed to reload. Check the Browser Console.");
        showToast("Content reloaded; UserChrome reload failed. Check the Browser Console.");
      } else {
        console.error("[UserChrome Hot-Reload] Both UserChrome and content reloads failed. Check the Browser Console.");
        showToast("UserChrome and content reload failed. Check the Browser Console.");
      }
    } finally {
      reloadInProgress = false;
      if (reloadRequested) {
        reloadRequested = false;
        void reloadNow();
      }
    }
  }

  function registerContentActor() {
    try {
      ChromeUtils.registerWindowActor(ACTOR_NAME, {
        child: {
          esModuleURI: ACTOR_MODULE,
          events: {},
        },
        allFrames: true,
        matchesTarget: ["content"],
        includeChrome: false,
        messageManagerGroups: ["browsers"],
      });
    } catch (e) {
      const message = String(e);
      if (!/already registered|already exists|duplicate/i.test(message)) {
        console.error("[UserChrome Hot-Reload] Failed to register content actor:", e);
      }
    }
  }

  function setupHotkey() {
    if (hotkeyListener) {
      window.removeEventListener("keydown", hotkeyListener, true);
      hotkeyListener = null;
      hotkeyRegistered = false;
    }
    if (!getPref("bool", PREF_ENABLED, true)) {
      return;
    }
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

    hotkeyListener = (event) => {
        if (!getPref("bool", PREF_ENABLED, true)) {
          return;
        }
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
    };
    window.addEventListener("keydown", hotkeyListener, true);
    hotkeyRegistered = true;
  }

  function startWatcher(previousTimes = null, wasInitialized = false, forceReload = false) {
    if (!getPref("bool", PREF_ENABLED, true) || watcherActive || pollTimer !== null) {
      return;
    }

    if (previousTimes instanceof Map) {
      lastModifiedTimes = previousTimes;
    }
    initialScanComplete = wasInitialized;
    watcherGeneration += 1;
    watcherActive = true;

    registerContentActor();
    pollTimer = setInterval(tick, getPollInterval());
    tick();

    if (forceReload) {
      reloadNow();
    }

    console.log("[UserChrome Hot-Reload] Watcher initialized. Watching:", getWatchRoot());
  }

  function yieldWatcher() {
    const wasWatcher = watcherActive || pollTimer !== null;
    const forceReloadOnHandoff = pendingReload !== null;

    watcherGeneration += 1;
    watcherActive = false;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (pendingReload !== null) {
      clearTimeout(pendingReload);
      pendingReload = null;
    }

    return wasWatcher
      ? { lastModifiedTimes, initialScanComplete, forceReloadOnHandoff }
      : null;
  }

  function cleanupWindow() {
    const wasWatcher = watcherActive;
    const forceReloadOnHandoff = pendingReload !== null;

    watcherGeneration += 1;
    watcherActive = false;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (pendingReload !== null) {
      clearTimeout(pendingReload);
      pendingReload = null;
    }
    window.__userChromeHotReloadInitialized = false;
    Services.prefs.removeObserver(PREF_ENABLED, enabledPrefObserver);
    Services.prefs.removeObserver(PREF_INTERVAL, pollIntervalPrefObserver);
    Services.prefs.removeObserver(PREF_HOTKEY, hotkeyPrefObserver);
    Services.prefs.removeObserver(PREF_PATH, watchConfigPrefObserver);
    Services.prefs.removeObserver(PREF_NESTED, watchConfigPrefObserver);
    Services.prefs.removeObserver(PREF_EXCLUDED_DIRS, watchConfigPrefObserver);
    if (hotkeyListener) {
      window.removeEventListener("keydown", hotkeyListener, true);
      hotkeyListener = null;
      hotkeyRegistered = false;
    }

    if (!wasWatcher) {
      return;
    }

    // Transfer watcher ownership before this window disappears.
    const nextWindow = chromeWindows().find(
      (win) =>
        win !== window &&
        !win.closed &&
        typeof win.__userChromeHotReloadStartWatcher === "function"
    );
    if (nextWindow) {
      nextWindow.__userChromeHotReloadStartWatcher(
        lastModifiedTimes,
        initialScanComplete,
        forceReloadOnHandoff
      );
    }
  }

  const pollIntervalPrefObserver = {
    observe() {
      // Apply interval changes immediately without creating a second poller.
      if (!watcherActive || pollTimer === null) {
        return;
      }
      clearInterval(pollTimer);
      pollTimer = setInterval(tick, getPollInterval());
    },
  };

  const watchConfigPrefObserver = {
    observe() {
      // Re-scan immediately without creating another polling timer.
      tick();
    },
  };

  const hotkeyPrefObserver = {
    observe() {
      setupHotkey();
    },
  };

  const enabledPrefObserver = {
    observe() {
      if (!getPref("bool", PREF_ENABLED, true)) {
        // Remove the now-inert key listener immediately while disabled.
        setupHotkey();
        yieldWatcher();
        return;
      }

      setupHotkey();
      if (Services.wm.getMostRecentWindow("navigator:browser") !== window) {
        return;
      }

      let inheritedState = null;
      for (const otherWindow of chromeWindows()) {
        if (
          otherWindow === window ||
          otherWindow.closed ||
          typeof otherWindow.__userChromeHotReloadYieldWatcher !== "function"
        ) {
          continue;
        }
        const state = otherWindow.__userChromeHotReloadYieldWatcher();
        if (!inheritedState && state) {
          inheritedState = state;
        }
      }

      if (inheritedState) {
        startWatcher(
          inheritedState.lastModifiedTimes,
          inheritedState.initialScanComplete,
          inheritedState.forceReloadOnHandoff
        );
      } else {
        startWatcher();
      }
    },
  };

  function init() {
    Services.prefs.addObserver(PREF_ENABLED, enabledPrefObserver);
    Services.prefs.addObserver(PREF_INTERVAL, pollIntervalPrefObserver);
    Services.prefs.addObserver(PREF_HOTKEY, hotkeyPrefObserver);
    Services.prefs.addObserver(PREF_PATH, watchConfigPrefObserver);
    Services.prefs.addObserver(PREF_NESTED, watchConfigPrefObserver);
    Services.prefs.addObserver(PREF_EXCLUDED_DIRS, watchConfigPrefObserver);
    setupHotkey();
    window.__userChromeHotReloadStartWatcher = startWatcher;
    window.__userChromeHotReloadYieldWatcher = yieldWatcher;
    window.addEventListener("beforeunload", cleanupWindow, { once: true });

    // If a newly opened window becomes most recent, transfer watcher state
    // from any existing owner before starting its own poller.
    if (window === mostRecentWindow) {
      let inheritedState = null;
      for (const otherWindow of chromeWindows()) {
        if (
          otherWindow === window ||
          otherWindow.closed ||
          typeof otherWindow.__userChromeHotReloadYieldWatcher !== "function"
        ) {
          continue;
        }
        const state = otherWindow.__userChromeHotReloadYieldWatcher();
        if (!inheritedState && state) {
          inheritedState = state;
        }
      }

      if (inheritedState) {
        startWatcher(
          inheritedState.lastModifiedTimes,
          inheritedState.initialScanComplete,
          inheritedState.forceReloadOnHandoff
        );
      } else {
        startWatcher();
      }
    }
  }

  init();
})();