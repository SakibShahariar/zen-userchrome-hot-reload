(function () {
  "use strict";

  const mostRecentWindow =
    typeof Services !== "undefined" && typeof Services.wm?.getMostRecentWindow === "function"
      ? Services.wm.getMostRecentWindow("navigator:browser")
      : null;
  if (window.__userChromeHotReloadInitialized) {
    return;
  }
  window.__userChromeHotReloadInitialized = true;

  const PREF_PATH = "extensions.zen-userchrome-hot-reload.watch-path";
  const PREF_INTERVAL = "extensions.zen-userchrome-hot-reload.poll-interval-ms";
  const PREF_DEBOUNCE = "extensions.zen-userchrome-hot-reload.reload-debounce-ms";
  const PREF_SINE = "extensions.zen-userchrome-hot-reload.reload-sine-mods";
  const PREF_RELOAD_CHROME = "extensions.zen-userchrome-hot-reload.reload-chrome";
  const PREF_RELOAD_CONTENT = "extensions.zen-userchrome-hot-reload.reload-content";
  const PREF_TOAST = "extensions.zen-userchrome-hot-reload.toast";
  const PREF_DEBUG = "extensions.zen-userchrome-hot-reload.debug-logging";
  const RELOAD_MENU_ITEM_ID = "zen-userchrome-hot-reload-reload-now";
  const RELOAD_MENU_SEPARATOR_ID = "zen-userchrome-hot-reload-reload-now-separator";
  const PREF_HOTKEY = "extensions.zen-userchrome-hot-reload.hotkey";
  const PREF_NESTED = "extensions.zen-userchrome-hot-reload.watch-nested-directories";
  const PREF_EXCLUDED_DIRS = "extensions.zen-userchrome-hot-reload.excluded-dirs";
  const PREF_ENABLED = "extensions.zen-userchrome-hot-reload.enabled";
  const PREF_PAUSED = "extensions.zen-userchrome-hot-reload.paused";

  const ACTOR_NAME = "UserChromeHotReload";
  const ACTOR_MODULE =
    "chrome://sine/content/zen-userchrome-hot-reload/hot-reload-content.sys.mjs";

  const profileChromeDir = PathUtils.join(PathUtils.profileDir, "chrome");
  const chromeEntryPath = PathUtils.join(profileChromeDir, "userChrome.css");
  const contentEntryPath = PathUtils.join(profileChromeDir, "userContent.css");

  let lastModifiedTimes = new Map();
  let directoryCache = new Map();
  let pendingReload = null;
  let pendingChangedFiles = new Map();
  let reloadMenuItem = null;
  let lastReloadAt = null;
  let lastReloadStatus = "Never";
  let reloadMenuSeparator = null;
  let reloadMenuCommandHandler = null;
  let reloadInProgress = false;
  let reloadRequested = false;
  let tickInProgress = false;
  let watcherGeneration = 0;
  let initialScanComplete = false;
  let pollTimer = null;
  let watcherActive = false;
  let watcherCompatibilityAvailable = true;
  let chromeReloadCompatibilityAvailable = true;
  let contentReloadCompatibilityAvailable = true;
  let hotkeyRegistered = false;
  let hotkeyListener = null;
  let lastWatchRootError = null;
  let lastExcludedDirsWarning = null;
  let lastDirectoryScanWarning = null;
  let sineTrackingAvailable = false;
  let sineStylePaths = new Set();
  let sineMetadataFingerprint = null;

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

  function debugLog(...args) {
    if (getPref("bool", PREF_DEBUG, false)) {
      console.debug("[UserChrome Hot-Reload]", ...args);
    }
  }

  function checkCompatibility() {
    const missingWatcher = [];
    const missingChromeReload = [];
    const missingContentReload = [];
    const servicesAvailable = typeof Services !== "undefined";
    const ioUtilsAvailable = typeof IOUtils !== "undefined";
    const pathUtilsAvailable = typeof PathUtils !== "undefined";
    const chromeUtilsAvailable = typeof ChromeUtils !== "undefined";

    if (!ioUtilsAvailable || typeof IOUtils.stat !== "function") {
      missingWatcher.push("IOUtils.stat");
    }
    if (!ioUtilsAvailable || typeof IOUtils.getChildren !== "function") {
      missingWatcher.push("IOUtils.getChildren");
    }
    if (!pathUtilsAvailable || typeof PathUtils.join !== "function" || typeof PathUtils.filename !== "function") {
      missingWatcher.push("PathUtils.join/filename");
    }
    if (!servicesAvailable || typeof Services.prefs?.addObserver !== "function") {
      missingWatcher.push("Services.prefs.addObserver");
    }
    if (!servicesAvailable || typeof Services.wm?.getMostRecentWindow !== "function") {
      missingWatcher.push("Services.wm.getMostRecentWindow");
    }
    if (!servicesAvailable || typeof Services.wm?.getEnumerator !== "function") {
      missingWatcher.push("Services.wm.getEnumerator");
    }

    if (!pathUtilsAvailable || typeof PathUtils.toFileURI !== "function") {
      missingChromeReload.push("PathUtils.toFileURI");
      missingContentReload.push("PathUtils.toFileURI");
    }
    if (!servicesAvailable || typeof Services.io?.newURI !== "function") {
      missingChromeReload.push("Services.io.newURI");
      missingContentReload.push("Services.io.newURI");
    }
    if (!servicesAvailable || typeof Services.obs?.notifyObservers !== "function") {
      missingChromeReload.push("Services.obs.notifyObservers");
    }
    if (!chromeUtilsAvailable || typeof ChromeUtils.registerWindowActor !== "function") {
      missingContentReload.push("ChromeUtils.registerWindowActor");
    }

    const appInfo = servicesAvailable ? Services.appinfo : null;
    const runtime = {
      name: appInfo?.name ?? "unknown browser",
      version: appInfo?.version ?? "unknown version",
    };
    if (missingWatcher.length) {
      console.error(
        "[UserChrome Hot-Reload] Automatic watching is unavailable in",
        runtime,
        "Missing APIs:",
        missingWatcher.join(", ")
      );
    }
    if (missingChromeReload.length) {
      console.error(
        "[UserChrome Hot-Reload] userChrome.css reload is unavailable in",
        runtime,
        "Missing APIs:",
        missingChromeReload.join(", ")
      );
    }
    if (missingContentReload.length) {
      console.warn(
        "[UserChrome Hot-Reload] userContent.css reload is unavailable in",
        runtime,
        "Missing APIs:",
        [...new Set(missingContentReload)].join(", ")
      );
    }

    const result = {
      watcherAvailable: missingWatcher.length === 0,
      chromeReloadAvailable: missingChromeReload.length === 0,
      contentReloadAvailable: missingContentReload.length === 0,
      runtime,
    };
    debugLog("Compatibility check", result);
    return result;
  }

  function getWatchRoot() {
    return getPref("string", PREF_PATH, "") || profileChromeDir;
  }

  function reportWatchRootError(root, error) {
    const message = String(error);
    const key = `${root}\n${message}`;
    if (lastWatchRootError === key) {
      return;
    }
    lastWatchRootError = key;
    console.error(
      `[UserChrome Hot-Reload] Watch path "${root}" is unavailable or unreadable: ${message}. Clear the watch-path preference to use the profile chrome directory, or configure an existing file or directory.`
    );
  }

  function getPollInterval() {
    const raw = getPref("string", PREF_INTERVAL, "500");
    if (raw === "") {
      return 500;
    }
    const interval = Number(raw);
    if (!Number.isInteger(interval)) {
      return 500;
    }
    return Math.min(5000, Math.max(200, interval));
  }

  function getExcludedDirectories() {
    const raw = getPref("string", PREF_EXCLUDED_DIRS, "sine-mods,JS,utils");
    const excluded = new Set();
    const invalid = [];

    for (const entry of raw.split(",")) {
      const name = entry.trim();
      if (!name) {
        continue;
      }
      if (name === "." || name === ".." || /[\\/:\0]/.test(name)) {
        invalid.push(name);
        continue;
      }
      excluded.add(name);
    }

    if (invalid.length) {
      const warningKey = `${raw}:${invalid.join(",")}`;
      if (lastExcludedDirsWarning !== warningKey) {
        lastExcludedDirsWarning = warningKey;
        console.warn(
          "[UserChrome Hot-Reload] Ignoring invalid excluded directory names; use single directory names without slashes or dot segments:",
          invalid
        );
      }
    } else {
      lastExcludedDirsWarning = null;
    }
    return excluded;
  }

  function getReloadDebounce() {
    const raw = getPref("string", PREF_DEBOUNCE, "300");
    if (raw === "") {
      return 300;
    }
    const configured = Number(raw);
    if (!Number.isInteger(configured)) {
      return 300;
    }
    return Math.min(2000, Math.max(50, configured));
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

  function isSineManagedPath(path) {
    const sineModsDir = PathUtils.join(profileChromeDir, "sine-mods");
    return path === PathUtils.join(sineModsDir, "mods.json") ||
      path.startsWith(sineModsDir + "/") ||
      path.startsWith(sineModsDir + "\\");
  }

  async function collectSineCssFiles(paths, root) {
    if (root !== profileChromeDir) {
      sineTrackingAvailable = false;
      return;
    }

    const sineModsDir = PathUtils.join(profileChromeDir, "sine-mods");
    const metadataPath = PathUtils.join(sineModsDir, "mods.json");
    try {
      const metadataStat = await IOUtils.stat(metadataPath);
      if (metadataStat.type !== "regular") {
        throw new Error("Sine mods metadata is not a regular file");
      }

      const fingerprint = metadataStat.lastModified + ":" + metadataStat.size;
      if (fingerprint !== sineMetadataFingerprint) {
        const mods = await IOUtils.readJSON(metadataPath);
        if (!mods || typeof mods !== "object" || Array.isArray(mods)) {
          throw new Error("Sine mods metadata has an invalid structure");
        }

        const stylePaths = new Set();
        for (const [id, mod] of Object.entries(mods)) {
          if (
            !id ||
            id === "." ||
            id === ".." ||
            /[\\/\\\\:\\0]/.test(id) ||
            !mod ||
            mod.enabled !== true
          ) {
            continue;
          }

          const styleEntries = typeof mod.style === "string"
            ? [["chrome", mod.style]]
            : Object.entries(mod.style ?? {});
          for (const [scope, relativePath] of styleEntries) {
            if (scope !== "chrome" && scope !== "content") {
              continue;
            }
            if (typeof relativePath !== "string" || !relativePath.trim()) {
              continue;
            }
            const segments = relativePath.split("/");
            if (
              relativePath.startsWith("/") ||
              relativePath.includes("\\") ||
              segments.some((segment) => !segment || segment === "." || segment === "..")
            ) {
              debugLog("Ignoring unsafe Sine stylesheet path", { id, relativePath });
              continue;
            }
            stylePaths.add(PathUtils.join(sineModsDir, id, ...segments));
          }
        }
        sineStylePaths = stylePaths;
        sineMetadataFingerprint = fingerprint;
      }

      paths.set(metadataPath, {
        lastModified: metadataStat.lastModified,
        size: metadataStat.size,
      });
      const styleStats = await Promise.all(
        [...sineStylePaths].map(async (path) => {
          try {
            const info = await IOUtils.stat(path);
            return [path, info.type === "regular"
              ? { lastModified: info.lastModified, size: info.size }
              : { lastModified: null, size: null }];
          } catch (e) {
            // Keep missing styles tracked so creating the file later is detected.
            return [path, { lastModified: null, size: null }];
          }
        })
      );
      for (const [path, info] of styleStats) {
        paths.set(path, info);
      }
      sineTrackingAvailable = true;
    } catch (e) {
      sineTrackingAvailable = false;
      sineStylePaths.clear();
      sineMetadataFingerprint = null;
      debugLog("Sine stylesheet tracking unavailable; using full-rebuild fallback", String(e));
    }
  }

  function parseCssImports(cssText) {
    const imports = [];
    let index = 0;

    function skipWhitespaceAndComments() {
      while (index < cssText.length) {
        if (/\\s/.test(cssText[index])) {
          index += 1;
          continue;
        }
        if (cssText.startsWith("/*", index)) {
          const end = cssText.indexOf("*/", index + 2);
          if (end === -1) {
            return false;
          }
          index = end + 2;
          continue;
        }
        break;
      }
      return true;
    }

    function readQuotedString() {
      const quote = cssText[index];
      if (quote !== "\"" && quote !== "'") {
        return null;
      }
      index += 1;
      let value = "";
      while (index < cssText.length) {
        const char = cssText[index++];
        if (char === quote) {
          return value;
        }
        // CSS escapes need decoding before path resolution. Fall back rather
        // than guessing which file an escaped import refers to.
        if (char === "\\\\" || char === "\\n" || char === "\\r" || char === "\\f") {
          return null;
        }
        value += char;
      }
      return null;
    }

    while (index < cssText.length) {
      if (cssText.startsWith("/*", index)) {
        const end = cssText.indexOf("*/", index + 2);
        if (end === -1) {
          return null;
        }
        index = end + 2;
        continue;
      }
      const current = cssText[index];
      if (current === "\"" || current === "'") {
        const quote = current;
        index += 1;
        while (index < cssText.length) {
          const char = cssText[index++];
          if (char === "\\\\" && index < cssText.length) {
            index += 1;
          } else if (char === quote) {
            break;
          }
        }
        continue;
      }

      if (
        current !== "@" ||
        cssText.slice(index, index + 7).toLowerCase() !== "@import" ||
        /[\\w-]/.test(cssText[index + 7] ?? "")
      ) {
        index += 1;
        continue;
      }

      index += 7;
      if (!skipWhitespaceAndComments()) {
        return null;
      }

      let target = null;
      if (cssText[index] === "\"" || cssText[index] === "'") {
        target = readQuotedString();
      } else if (cssText.slice(index, index + 4).toLowerCase() === "url(") {
        index += 4;
        if (!skipWhitespaceAndComments()) {
          return null;
        }
        if (cssText[index] === "\"" || cssText[index] === "'") {
          target = readQuotedString();
          if (target === null || !skipWhitespaceAndComments() || cssText[index] !== ")") {
            return null;
          }
          index += 1;
        } else {
          const start = index;
          while (index < cssText.length && cssText[index] !== ")") {
            const char = cssText[index];
            if (/\\s/.test(char) || char === "\\\\" || char === "\"" || char === "'") {
              return null;
            }
            index += 1;
          }
          if (index >= cssText.length) {
            return null;
          }
          target = cssText.slice(start, index);
          index += 1;
        }
      } else {
        return null;
      }

      if (target === null || !target.trim()) {
        return null;
      }
      imports.push(target.trim());
    }
    return imports;
  }

  function resolveLocalCssImport(importPath, sourcePath) {
    if (/^(?:https?:|data:|chrome:|resource:|moz-extension:|\\/\\/)/i.test(importPath)) {
      return null;
    }
    const baseURI = Services.io.newURI(PathUtils.toFileURI(sourcePath));
    const uri = Services.io.newURI(importPath, null, baseURI);
    if (uri.scheme !== "file") {
      return null;
    }
    if (typeof Ci === "undefined" || !Ci.nsIFileURL) {
      throw new Error("Ci.nsIFileURL is unavailable");
    }
    return uri.QueryInterface(Ci.nsIFileURL).file.path;
  }

  async function collectCssDependencyPaths(entryPath, trackedPaths, dependencies, visited, depth = 0) {
    if (depth > 64) {
      return false;
    }
    if (visited.has(entryPath)) {
      return true;
    }
    if (!trackedPaths.has(entryPath)) {
      return false;
    }

    visited.add(entryPath);
    dependencies.add(entryPath);
    let cssText;
    try {
      cssText = await IOUtils.readUTF8(entryPath);
    } catch (e) {
      return false;
    }

    const imports = parseCssImports(cssText);
    if (imports === null) {
      return false;
    }
    for (const importPath of imports) {
      let resolvedPath;
      try {
        resolvedPath = resolveLocalCssImport(importPath, entryPath);
      } catch (e) {
        return false;
      }
      if (resolvedPath === null) {
        continue;
      }
      if (!trackedPaths.has(resolvedPath)) {
        return false;
      }
      if (!await collectCssDependencyPaths(
        resolvedPath,
        trackedPaths,
        dependencies,
        visited,
        depth + 1
      )) {
        return false;
      }
    }
    return true;
  }

  async function getActiveStylesheetDependencies(files) {
    const trackedPaths = new Set(files.keys());
    const chromePaths = new Set();
    const contentPaths = new Set();
    const chromeKnown = await collectCssDependencyPaths(
      chromeEntryPath,
      trackedPaths,
      chromePaths,
      new Set()
    );
    const contentKnown = await collectCssDependencyPaths(
      contentEntryPath,
      trackedPaths,
      contentPaths,
      new Set()
    );
    return {
      known: chromeKnown && contentKnown,
      chromePaths,
      contentPaths,
    };
  }

  async function collectCssFiles(root) {
    sineTrackingAvailable = false;
    const paths = new Map();
    const scanTime = Date.now();
    const DIRECTORY_CACHE_REVALIDATION_MS = 10000;
    const watchNested = getPref("bool", PREF_NESTED, false);
    const excludedDirectories = getExcludedDirectories();

    const visitedDirectories = new Set();
    const MAX_DIRECTORY_SCAN_DEPTH = 64;

    function warnSkippedDirectory(directory, reason) {
      const key = `${root}:${reason}`;
      if (lastDirectoryScanWarning === key) {
        return;
      }
      lastDirectoryScanWarning = key;
      console.warn("[UserChrome Hot-Reload] Skipping recursive CSS directory:", directory, reason);
    }

    async function scanDirectory(directory, recursive, depth = 0) {
      // A symlink can keep extending its own path, so path de-duplication alone
      // is insufficient. Bound depth as a final guard against such cycles.
      if (depth > MAX_DIRECTORY_SCAN_DEPTH) {
        warnSkippedDirectory(directory, `maximum depth (${MAX_DIRECTORY_SCAN_DEPTH}) reached; possible symlink cycle`);
        return;
      }
      if (visitedDirectories.has(directory)) {
        warnSkippedDirectory(directory, "directory already visited; possible symlink cycle");
        return;
      }
      visitedDirectories.add(directory);
      let directoryStat;
      try {
        directoryStat = await IOUtils.stat(directory);
      } catch (e) {
        directoryCache.delete(directory);
        if (directory === root) {
          reportWatchRootError(directory, e);
        }
        return;
      }
      if (directoryStat.type !== "directory") {
        directoryCache.delete(directory);
        return;
      }

      const cached = directoryCache.get(directory);
      const cacheAge = cached ? scanTime - cached.lastFullScan : Infinity;
      const canReuse = cached &&
        Number.isFinite(cacheAge) &&
        cacheAge >= 0 &&
        cacheAge < DIRECTORY_CACHE_REVALIDATION_MS &&
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
          directoryCache.delete(directory);
          if (directory === root) {
            reportWatchRootError(directory, e);
          } else {
            console.warn("[UserChrome Hot-Reload] Failed to read directory:", directory, e);
          }
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
          lastFullScan: scanTime,
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
            await scanDirectory(child, watchNested, depth + 1);
          } else if (watchNested) {
            await scanDirectory(child, true, depth + 1);
          }
        } else {
          await scanDirectory(child, true, depth + 1);
        }
      }
    }

    try {
      const stat = await IOUtils.stat(root);
      if (stat.type === "regular") {
        directoryCache.clear();
        lastWatchRootError = null;
        paths.set(root, { lastModified: stat.lastModified, size: stat.size });
        return paths;
      }
      if (stat.type !== "directory") {
        directoryCache.clear();
        reportWatchRootError(root, `expected a file or directory, found ${stat.type}`);
        return paths;
      }

      lastWatchRootError = null;
      await scanDirectory(root, false);

      // Drop cache entries for directories removed or excluded since the last poll.
      for (const cachedDirectory of directoryCache.keys()) {
        if (!visitedDirectories.has(cachedDirectory)) {
          directoryCache.delete(cachedDirectory);
        }
      }
    } catch (e) {
      directoryCache.clear();
      reportWatchRootError(root, e);
    }

    await collectSineCssFiles(paths, root);
    return paths;
  }

  async function tick() {
    if (!watcherActive || tickInProgress) {
      return;
    }
    tickInProgress = true;
    const generation = watcherGeneration;
    try {
    const watchRoot = getWatchRoot();
    const files = await collectCssFiles(watchRoot);
    if (!watcherActive || generation !== watcherGeneration) {
      return;
    }

    const changedFiles = [];
    let changed = false;
    for (const cachedPath of lastModifiedTimes.keys()) {
      if (!files.has(cachedPath)) {
        lastModifiedTimes.delete(cachedPath);
        if (initialScanComplete) {
          changed = true;
          changedFiles.push({ action: "removed", path: cachedPath });
          pendingChangedFiles.set(cachedPath, "removed");
        }
      }
    }
    for (const [path, current] of files) {
      const previous = lastModifiedTimes.get(path);
      if (previous === undefined) {
        lastModifiedTimes.set(path, current);
        if (initialScanComplete) {
          changed = true;
          changedFiles.push({ action: "added", path });
          pendingChangedFiles.set(path, "added");
        }
      } else if (
        typeof previous !== "object" ||
        previous.lastModified !== current.lastModified ||
        previous.size !== current.size
      ) {
        lastModifiedTimes.set(path, current);
        changed = true;
        changedFiles.push({ action: "modified", path });
        pendingChangedFiles.set(path, "modified");
      }
    }

    debugLog("Scan completed", {
      watchRoot,
      cssFileCount: files.size,
      changedFileCount: changedFiles?.length ?? 0,
    });
    if (changedFiles.length) {
      const visibleChanges = changedFiles.slice(0, 20);
      debugLog("CSS file changes detected", {
        total: changedFiles.length,
        files: visibleChanges,
        omitted: changedFiles.length - visibleChanges.length,
      });
    }

    initialScanComplete = true;

    if (changed) {
      if (pendingReload !== null) {
        clearTimeout(pendingReload);
      }
      pendingReload = setTimeout(() => {
        pendingReload = null;
        reloadNow();
      }, getReloadDebounce());
    }
    } finally {
      tickInProgress = false;
    }
  }

  function reloadChromeSheets() {
    if (!chromeReloadCompatibilityAvailable) {
      return "unavailable";
    }
    let uri;
    try {
      uri = Services.io.newURI(PathUtils.toFileURI(chromeEntryPath));
    } catch (e) {
      console.error("[UserChrome Hot-Reload] Invalid userChrome.css path:", chromeEntryPath, e);
      return false;
    }

    let loaded = 0;
    let failed = 0;
    let cacheFlushOk = true;
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
        loaded += 1;
      } catch (e) {
        failed += 1;
        // A window may be closing; continue reloading the remaining windows.
        console.error("[UserChrome Hot-Reload] Failed to reload userChrome.css:", chromeEntryPath, e);
      }
    }

    try {
      Services.obs.notifyObservers(null, "chrome-flush-caches", null);
    } catch (e) {
      cacheFlushOk = false;
      // Sheet reloads have already been attempted; a cache-flush failure
      // must not prevent the content stylesheet reload from running.
      console.error("[UserChrome Hot-Reload] Failed to flush chrome caches:", e);
    }
    if (failed > 0) {
      console.error(
        `[UserChrome Hot-Reload] userChrome.css failed in ${failed} browser window(s); ${loaded} succeeded.`
      );
    }
    return loaded > 0 && failed === 0 && cacheFlushOk;
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
    if (!contentReloadCompatibilityAvailable) {
      return "unavailable";
    }
    let uri;
    try {
      uri = Services.io.newURI(PathUtils.toFileURI(contentEntryPath)).spec;
    } catch (e) {
      console.error("[UserChrome Hot-Reload] Invalid userContent.css path:", contentEntryPath, e);
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
            console.warn("[UserChrome Hot-Reload] Could not reload userContent.css in a content frame:", contentEntryPath, e);
          }
        }
      }
    }

    if (requests.length === 0) {
      if (enumerationFailed) {
        console.error("[UserChrome Hot-Reload] Could not enumerate content documents; reload status is unknown.");
        return false;
      }
      debugLog("No eligible content documents; skipping userContent.css refresh.");
      return null;
    }

    debugLog("Dispatching userContent.css refresh", { documentCount: requests.length });
    const results = await Promise.allSettled(requests);
    const failed = results.filter(
      (result) => result.status !== "fulfilled" || result.value?.ok !== true
    );
    if (failed.length) {
      console.error(
        `[UserChrome Hot-Reload] Failed to refresh userContent.css (${contentEntryPath}) in ${failed.length} of ${results.length} document(s).`
      );
      for (const result of failed) {
        const reason =
          result.status === "rejected"
            ? result.reason
            : result.value?.error ?? result.value;
        console.error("[UserChrome Hot-Reload] userContent.css reload failure:", reason);
      }
    }
    return failed.length === 0;
  }

  async function reloadSineMods() {
    if (!getPref("bool", PREF_SINE, true)) {
      return null;
    }
    if (typeof Services === "undefined" || typeof Services.wm?.getMostRecentWindow !== "function") {
      console.info("[UserChrome Hot-Reload] Sine integration unavailable because Services.wm is missing.");
      return "unavailable";
    }
    try {
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      const manager = win?.manager;
      if (typeof manager?.rebuildMods !== "function") {
        console.info(
          "[UserChrome Hot-Reload] Sine integration unavailable; CSS reload remains active, but Sine-managed mods will not be rebuilt. Install or enable Sine, then restart Zen."
        );
        return "unavailable";
      }
      const result = await manager.rebuildMods(false, true);
      return result !== false;
    } catch (e) {
      console.error("[UserChrome Hot-Reload] Failed to rebuild Sine-managed mods:", e);
      return false;
    }
  }

  function showToast(message) {
    if (!getPref("bool", PREF_TOAST, true)) {
      return;
    }

    // Zen's current toast interface requires an internal Fluent message ID.
    // Mutating another mod's toast after creation is fragile and can race its
    // localization lifecycle, so report status through our own console channel.
    console.info("[UserChrome Hot-Reload] " + message);
  }

  async function reloadNow() {
    if (!getPref("bool", PREF_ENABLED, true) || getPref("bool", PREF_PAUSED, false)) {
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
    setReloadStatus("Running");

    try {
      const changedFiles = Array.from(pendingChangedFiles, ([path, action]) => ({ action, path }));
      pendingChangedFiles.clear();
      if (changedFiles.length) {
        const visibleFiles = changedFiles.slice(0, 20);
        debugLog("Reload triggered by CSS file changes", {
          total: changedFiles.length,
          files: visibleFiles,
          omitted: changedFiles.length - visibleFiles.length,
        });
      } else {
        debugLog("Reload requested without pending CSS file changes");
      }
      const hasFileChanges = changedFiles.length > 0;
      const hasSineChanges = changedFiles.some(({ path }) => isSineManagedPath(path));
      const cssChangedPaths = changedFiles
        .map(({ path }) => path)
        .filter((path) => path.toLowerCase().endsWith(".css"));
      let shouldReloadChrome = !hasFileChanges;
      let shouldReloadContent = !hasFileChanges;

      if (hasFileChanges && cssChangedPaths.length) {
        const dependencies = await getActiveStylesheetDependencies(await collectCssFiles(getWatchRoot()));
        if (!dependencies.known) {
          // Incomplete import graphs must never suppress a potentially relevant reload.
          shouldReloadChrome = true;
          shouldReloadContent = true;
        } else {
          shouldReloadChrome = cssChangedPaths.some((path) => dependencies.chromePaths.has(path));
          shouldReloadContent = cssChangedPaths.some((path) => dependencies.contentPaths.has(path));
        }
      }

      // If Sine metadata cannot be read, retain the previous conservative rebuild fallback.
      // Manual reloads refresh every enabled scope regardless of the import graph.
      const shouldReloadSine = !hasFileChanges || !sineTrackingAvailable || hasSineChanges;

      const chromeOk = !shouldReloadChrome
        ? "unchanged"
        : getPref("bool", PREF_RELOAD_CHROME, true)
          ? (chromeReloadCompatibilityAvailable ? reloadChromeSheets() : "unavailable")
          : "disabled";
      let contentOk = shouldReloadContent ? "disabled" : "unchanged";
      if (shouldReloadContent && getPref("bool", PREF_RELOAD_CONTENT, true)) {
        try {
          contentOk = contentReloadCompatibilityAvailable ? await reloadContentSheets() : "unavailable";
        } catch (e) {
          console.error("[UserChrome Hot-Reload] userContent.css reload request failed:", contentEntryPath, e);
          contentOk = false;
        }
      }
      const sineOk = shouldReloadSine ? await reloadSineMods() : "unchanged";
      const failedAreas = [];
      const completedAreas = [];
      const skippedAreas = [];
      if (chromeOk === true) {
        completedAreas.push("userChrome.css");
      } else if (chromeOk === false) {
        failedAreas.push("userChrome.css");
      } else if (chromeOk === "disabled") {
        skippedAreas.push("userChrome.css disabled");
      } else if (chromeOk === "unavailable") {
        skippedAreas.push("userChrome.css reload API unavailable");
      } else if (chromeOk === "unchanged") {
        skippedAreas.push("no userChrome.css dependency changed");
      }
      if (contentOk === true) {
        completedAreas.push("userContent.css");
      } else if (contentOk === false) {
        failedAreas.push("userContent.css");
      } else if (contentOk === "disabled") {
        skippedAreas.push("userContent.css disabled");
      } else if (contentOk === "unavailable") {
        skippedAreas.push("userContent.css actor API unavailable");
      } else if (contentOk === null) {
        skippedAreas.push("no content documents to refresh");
      } else if (contentOk === "unchanged") {
        skippedAreas.push("no userContent.css dependency changed");
      }
      if (sineOk === true) {
        completedAreas.push("Sine mods");
      } else if (sineOk === false) {
        failedAreas.push("Sine mods");
      } else if (sineOk === "unavailable") {
        skippedAreas.push("Sine integration unavailable");
      } else if (sineOk === "unchanged") {
        skippedAreas.push("no Sine-managed CSS changes");
      }

      setReloadStatus(failedAreas.length ? "Failed" : completedAreas.length ? "Succeeded" : "Skipped");
      debugLog("Reload outcome", { chromeOk, contentOk, sineOk, failedAreas, completedAreas, skippedAreas });
      if (failedAreas.length) {
        console.error(
          "[UserChrome Hot-Reload] Reload failed for:",
          failedAreas.join(", "),
          ". See the preceding Browser Console entries for details."
        );
        const completedText = completedAreas.length
          ? completedAreas.join(" & ") + " reloaded; "
          : "";
        const skippedText = skippedAreas.length
          ? " (" + skippedAreas.join("; ") + ")"
          : "";
        showToast(
          completedText + failedAreas.join(" & ") +
          " reload failed. Check Browser Console." + skippedText
        );
      } else if (completedAreas.length) {
        const skippedText = skippedAreas.length
          ? "; " + skippedAreas.join("; ")
          : "";
        showToast(completedAreas.join(" & ") + " reloaded" + skippedText + ".");
      } else {
        const skippedText = skippedAreas.length
          ? "; " + skippedAreas.join("; ")
          : "";
        showToast("No enabled reload targets" + skippedText + ".");
      }
    } finally {
      reloadInProgress = false;
      if (reloadRequested) {
        reloadRequested = false;
        void reloadNow();
      }
    }
  }

  function updateReloadMenuItem() {
    if (!reloadMenuItem) {
      return;
    }
    const enabled = getPref("bool", PREF_ENABLED, true);
    const paused = getPref("bool", PREF_PAUSED, false);
    const ownerWindow = chromeWindows().find(
      (win) => !win.closed && win.__userChromeHotReloadIsWatcherOwner === true
    );
    const status = !enabled
      ? "Disabled"
      : paused
        ? "Paused"
        : !watcherCompatibilityAvailable
          ? "Unavailable"
          : ownerWindow
            ? ownerWindow === window ? "Active" : "Handed off"
            : "Not running";

    let effectiveWatchRoot = "Unavailable";
    try {
      effectiveWatchRoot = getWatchRoot();
    } catch (e) {}
    const effectivePollInterval = getPollInterval();
    let recentReloadAt = lastReloadAt;
    let recentReloadStatus = lastReloadStatus;
    for (const win of chromeWindows()) {
      const timestamp = Number(win.__userChromeHotReloadLastReloadAt || 0);
      if (timestamp > (recentReloadAt || 0)) {
        recentReloadAt = timestamp;
        recentReloadStatus = win.__userChromeHotReloadLastReloadStatus || "Unknown";
      }
    }
    const reloadTime = recentReloadAt ? new Date(recentReloadAt).toLocaleString() : "Never";
    const chromeScope = getPref("bool", PREF_RELOAD_CHROME, true) ? "on" : "off";
    const contentScope = getPref("bool", PREF_RELOAD_CONTENT, true) ? "on" : "off";
    const sineScope = getPref("bool", PREF_SINE, true) ? "on" : "off";
    reloadMenuItem.setAttribute("label", "Reload stylesheets now (" + status + ")");
    reloadMenuItem.setAttribute(
      "tooltiptext",
      "Watcher: " + status +
      "\nWatch path: " + effectiveWatchRoot +
      "\nPoll interval: " + effectivePollInterval + " ms" +
      "\nReload scopes: chrome " + chromeScope + ", content " + contentScope + ", Sine " + sineScope +
      "\nDebounce: " + getReloadDebounce() + " ms" +
      "\nLast reload: " + reloadTime + " (" + recentReloadStatus + ")"
    );
    if (enabled && !paused) {
      reloadMenuItem.removeAttribute("disabled");
    } else {
      reloadMenuItem.setAttribute("disabled", "true");
    }
  }

  function notifyReloadStatusChange() {
    for (const win of chromeWindows()) {
      try {
        win.__userChromeHotReloadUpdateStatus?.();
      } catch (e) {}
    }
    updateReloadMenuItem();
  }

  function setReloadStatus(status) {
    const timestamp = Date.now();
    lastReloadAt = timestamp;
    lastReloadStatus = status;
    const windows = chromeWindows();
    if (!windows.includes(window)) {
      windows.push(window);
    }
    for (const win of windows) {
      win.__userChromeHotReloadLastReloadAt = timestamp;
      win.__userChromeHotReloadLastReloadStatus = status;
    }
    notifyReloadStatusChange();
  }

  function setupReloadMenuItem() {
    const doc = window.document;
    const popup = doc.getElementById("appMenu-popup");
    if (!popup || typeof doc.createXULElement !== "function") {
      debugLog("App menu unavailable; use the configured hotkey for manual reloads");
      return;
    }
    window.__userChromeHotReloadUpdateStatus = updateReloadMenuItem;
    if (reloadMenuItem?.isConnected) {
      updateReloadMenuItem();
      return;
    }

    doc.getElementById(RELOAD_MENU_ITEM_ID)?.remove();
    doc.getElementById(RELOAD_MENU_SEPARATOR_ID)?.remove();
    reloadMenuSeparator = doc.createXULElement("menuseparator");
    reloadMenuSeparator.id = RELOAD_MENU_SEPARATOR_ID;
    reloadMenuItem = doc.createXULElement("menuitem");
    reloadMenuItem.id = RELOAD_MENU_ITEM_ID;
    reloadMenuItem.setAttribute("label", "Reload stylesheets now");
    reloadMenuItem.setAttribute("tooltiptext", "Reload the enabled stylesheets immediately");
    reloadMenuCommandHandler = () => {
      void reloadNow();
    };
    reloadMenuItem.addEventListener("command", reloadMenuCommandHandler);
    popup.appendChild(reloadMenuSeparator);
    popup.appendChild(reloadMenuItem);
    updateReloadMenuItem();
  }

  function removeReloadMenuItem() {
    if (reloadMenuItem && reloadMenuCommandHandler) {
      reloadMenuItem.removeEventListener("command", reloadMenuCommandHandler);
    }
    reloadMenuItem?.remove();
    reloadMenuSeparator?.remove();
    reloadMenuItem = null;
    reloadMenuSeparator = null;
    reloadMenuCommandHandler = null;
    if (window.__userChromeHotReloadUpdateStatus === updateReloadMenuItem) {
      delete window.__userChromeHotReloadUpdateStatus;
    }
  }

  function registerContentActor() {
    if (!contentReloadCompatibilityAvailable) {
      return;
    }
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
      if (/already registered|already exists|duplicate/i.test(message)) {
        contentReloadCompatibilityAvailable = true;
        return;
      }
      contentReloadCompatibilityAvailable = false;
      console.error("[UserChrome Hot-Reload] Failed to register content actor; userContent.css reload is disabled:", e);
    }
  }

  function setupHotkey() {
    if (hotkeyListener) {
      window.removeEventListener("keydown", hotkeyListener, true);
      hotkeyListener = null;
      hotkeyRegistered = false;
    }
    if (!getPref("bool", PREF_ENABLED, true) || getPref("bool", PREF_PAUSED, false)) {
      return;
    }
    const combo = getPref("string", PREF_HOTKEY, "").toUpperCase();
    if (!combo) {
      return;
    }
    const parts = combo.split("+").map((part) => part.trim());
    if (parts.length === 0 || parts.some((part) => !part)) {
      console.warn("[UserChrome Hot-Reload] Invalid hotkey: empty key or modifier segment. Use a format such as Ctrl+Shift+F5.");
      return;
    }
    const key = parts.pop();
    const modifierNames = new Set(["CTRL", "SHIFT", "ALT", "META", "CMD", "SUPER"]);
    if (!key || modifierNames.has(key)) {
      console.warn("[UserChrome Hot-Reload] Invalid hotkey: a non-modifier key must follow the modifier combination.");
      return;
    }
    const normalizedModifiers = parts.map((part) =>
      part === "CMD" || part === "SUPER" ? "META" : part
    );
    const validModifiers = new Set(["CTRL", "SHIFT", "ALT", "META"]);
    if (normalizedModifiers.some((part) => !validModifiers.has(part))) {
      console.warn("[UserChrome Hot-Reload] Invalid hotkey: unknown modifier. Supported modifiers are Ctrl, Shift, Alt, Meta, Cmd, and Super.");
      return;
    }
    if (new Set(normalizedModifiers).size !== normalizedModifiers.length) {
      console.warn("[UserChrome Hot-Reload] Invalid hotkey: duplicate modifier.");
      return;
    }
    if (normalizedModifiers.length === 0 && key.length === 1) {
      console.warn(
        "[UserChrome Hot-Reload] A single-character hotkey may conflict with browser shortcuts or text entry; prefer a function key or modifier combination."
      );
    }
    const needsCtrl = normalizedModifiers.includes("CTRL");
    const needsShift = normalizedModifiers.includes("SHIFT");
    const needsAlt = normalizedModifiers.includes("ALT");
    const needsMeta = normalizedModifiers.includes("META");

    hotkeyListener = (event) => {
        if (!getPref("bool", PREF_ENABLED, true) || getPref("bool", PREF_PAUSED, false)) {
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

  function startWatcher(previousTimes = null, wasInitialized = false, forceReload = false, previousChangedFiles = null) {
    if (!watcherCompatibilityAvailable || !getPref("bool", PREF_ENABLED, true) || getPref("bool", PREF_PAUSED, false) || watcherActive || pollTimer !== null) {
      return;
    }

    if (previousTimes instanceof Map) {
      lastModifiedTimes = previousTimes;
    }
    if (previousChangedFiles instanceof Map) {
      pendingChangedFiles = previousChangedFiles;
    }
    initialScanComplete = wasInitialized;
    watcherGeneration += 1;
    watcherActive = true;
    window.__userChromeHotReloadIsWatcherOwner = true;
    notifyReloadStatusChange();

    registerContentActor();
    pollTimer = setInterval(tick, getPollInterval());
    tick();

    if (forceReload) {
      reloadNow();
    }

    debugLog("Watcher started", { watchRoot: getWatchRoot(), pollIntervalMs: getPollInterval() });
  }

  function yieldWatcher() {
    const wasWatcher = watcherActive || pollTimer !== null;
    const forceReloadOnHandoff = pendingReload !== null;

    watcherGeneration += 1;
    watcherActive = false;
    window.__userChromeHotReloadIsWatcherOwner = false;
    notifyReloadStatusChange();
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (pendingReload !== null) {
      clearTimeout(pendingReload);
      pendingReload = null;
    }

    debugLog("Watcher yielded", { wasWatcher, forceReloadOnHandoff });
    return wasWatcher
      ? { lastModifiedTimes, initialScanComplete, forceReloadOnHandoff, pendingChangedFiles }
      : null;
  }

  function cleanupWindow() {
    const wasWatcher = watcherActive;
    const forceReloadOnHandoff = pendingReload !== null;

    watcherGeneration += 1;
    watcherActive = false;
    window.__userChromeHotReloadIsWatcherOwner = false;
    notifyReloadStatusChange();
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (pendingReload !== null) {
      clearTimeout(pendingReload);
      pendingReload = null;
    }
    removeReloadMenuItem();
    delete window.__userChromeHotReloadIsWatcherOwner;
    delete window.__userChromeHotReloadLastReloadAt;
    delete window.__userChromeHotReloadLastReloadStatus;
    window.__userChromeHotReloadInitialized = false;
    if (typeof Services !== "undefined" && typeof Services.prefs?.removeObserver === "function") {
      Services.prefs.removeObserver(PREF_ENABLED, enabledPrefObserver);
      Services.prefs.removeObserver(PREF_PAUSED, pausePrefObserver);
      Services.prefs.removeObserver(PREF_INTERVAL, pollIntervalPrefObserver);
      Services.prefs.removeObserver(PREF_DEBOUNCE, reloadDebouncePrefObserver);
      Services.prefs.removeObserver(PREF_RELOAD_CHROME, reloadScopePrefObserver);
      Services.prefs.removeObserver(PREF_RELOAD_CONTENT, reloadScopePrefObserver);
      Services.prefs.removeObserver(PREF_SINE, reloadScopePrefObserver);
      Services.prefs.removeObserver(PREF_HOTKEY, hotkeyPrefObserver);
      Services.prefs.removeObserver(PREF_PATH, watchConfigPrefObserver);
      Services.prefs.removeObserver(PREF_NESTED, watchConfigPrefObserver);
      Services.prefs.removeObserver(PREF_EXCLUDED_DIRS, watchConfigPrefObserver);
    }
    if (hotkeyListener) {
      window.removeEventListener("keydown", hotkeyListener, true);
      hotkeyListener = null;
      hotkeyRegistered = false;
    }

    const pausedState = window.__userChromeHotReloadPausedState;
    if (pausedState) {
      const nextWindow = chromeWindows().find((win) => win !== window && !win.closed);
      if (nextWindow) {
        nextWindow.__userChromeHotReloadPausedState = pausedState;
        debugLog("Paused watcher state transferred to another browser window");
      }
      delete window.__userChromeHotReloadPausedState;
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
      debugLog("Watcher ownership transferred to another browser window");
      nextWindow.__userChromeHotReloadStartWatcher(
        lastModifiedTimes,
        initialScanComplete,
        forceReloadOnHandoff,
        pendingChangedFiles
      );
    } else {
      debugLog("No other browser window available for watcher handoff");
    }
  }

  const pollIntervalPrefObserver = {
    observe() {
      notifyReloadStatusChange();
      // Apply interval changes immediately without creating a second poller.
      if (!watcherActive || pollTimer === null) {
        return;
      }
      clearInterval(pollTimer);
      pollTimer = setInterval(tick, getPollInterval());
    },
  };

  const reloadDebouncePrefObserver = {
    observe() {
      if (pendingReload === null) {
        return;
      }
      clearTimeout(pendingReload);
      pendingReload = setTimeout(() => {
        pendingReload = null;
        reloadNow();
      }, getReloadDebounce());
    },
  };

  const reloadScopePrefObserver = {
    observe() {
      notifyReloadStatusChange();
    },
  };

  const watchConfigPrefObserver = {
    observe() {
      notifyReloadStatusChange();
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
      notifyReloadStatusChange();
      if (!getPref("bool", PREF_ENABLED, true) || getPref("bool", PREF_PAUSED, false)) {
        // Pausing or disabling removes the key listener and stops polling.
        setupHotkey();
        const state = yieldWatcher();
        if (state && getPref("bool", PREF_PAUSED, false)) {
          window.__userChromeHotReloadPausedState = state;
        }
        return;
      }

      setupHotkey();
      if (typeof Services.wm?.getMostRecentWindow !== "function" || Services.wm.getMostRecentWindow("navigator:browser") !== window) {
        return;
      }

      let inheritedState = window.__userChromeHotReloadPausedState || null;
      delete window.__userChromeHotReloadPausedState;
      for (const otherWindow of chromeWindows()) {
        if (otherWindow === window || otherWindow.closed) {
          continue;
        }
        const pausedState = otherWindow.__userChromeHotReloadPausedState;
        if (pausedState) {
          if (!inheritedState) {
            inheritedState = pausedState;
          }
          delete otherWindow.__userChromeHotReloadPausedState;
          continue;
        }
        if (typeof otherWindow.__userChromeHotReloadYieldWatcher !== "function") {
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
          inheritedState.forceReloadOnHandoff,
          inheritedState.pendingChangedFiles
        );
      } else {
        startWatcher();
      }
    },
  };

  const pausePrefObserver = {
    observe() {
      notifyReloadStatusChange();
      setupHotkey();
      const paused = getPref("bool", PREF_PAUSED, false);
      const enabled = getPref("bool", PREF_ENABLED, true);
      if (paused || !enabled) {
        const state = yieldWatcher();
        if (state && paused) {
          window.__userChromeHotReloadPausedState = state;
        }
        return;
      }
      if (typeof Services.wm?.getMostRecentWindow !== "function" || Services.wm.getMostRecentWindow("navigator:browser") !== window) {
        return;
      }

      let inheritedState = window.__userChromeHotReloadPausedState || null;
      delete window.__userChromeHotReloadPausedState;
      for (const otherWindow of chromeWindows()) {
        if (otherWindow === window || otherWindow.closed) {
          continue;
        }
        const state = otherWindow.__userChromeHotReloadPausedState;
        if (state) {
          if (!inheritedState) {
            inheritedState = state;
          }
          delete otherWindow.__userChromeHotReloadPausedState;
        }
      }

      if (inheritedState) {
        startWatcher(
          inheritedState.lastModifiedTimes,
          inheritedState.initialScanComplete,
          inheritedState.forceReloadOnHandoff,
          inheritedState.pendingChangedFiles
        );
      } else {
        startWatcher();
      }
      debugLog("Watcher resumed", { restoredState: Boolean(inheritedState) });
    },
  };

  function init() {
    const compatibility = checkCompatibility();
    watcherCompatibilityAvailable = compatibility.watcherAvailable;
    chromeReloadCompatibilityAvailable = compatibility.chromeReloadAvailable;
    contentReloadCompatibilityAvailable = compatibility.contentReloadAvailable;

    const prefsAvailable = typeof Services !== "undefined" && typeof Services.prefs?.addObserver === "function";
    if (prefsAvailable) {
      Services.prefs.addObserver(PREF_ENABLED, enabledPrefObserver);
      Services.prefs.addObserver(PREF_PAUSED, pausePrefObserver);
      Services.prefs.addObserver(PREF_INTERVAL, pollIntervalPrefObserver);
      Services.prefs.addObserver(PREF_DEBOUNCE, reloadDebouncePrefObserver);
      Services.prefs.addObserver(PREF_RELOAD_CHROME, reloadScopePrefObserver);
      Services.prefs.addObserver(PREF_RELOAD_CONTENT, reloadScopePrefObserver);
      Services.prefs.addObserver(PREF_SINE, reloadScopePrefObserver);
      Services.prefs.addObserver(PREF_HOTKEY, hotkeyPrefObserver);
      Services.prefs.addObserver(PREF_PATH, watchConfigPrefObserver);
      Services.prefs.addObserver(PREF_NESTED, watchConfigPrefObserver);
      Services.prefs.addObserver(PREF_EXCLUDED_DIRS, watchConfigPrefObserver);
    } else {
      console.error("[UserChrome Hot-Reload] Preference observers unavailable; settings changes will not be applied until restart.");
    }
    setupReloadMenuItem();
    setupHotkey();
    window.__userChromeHotReloadStartWatcher = startWatcher;
    window.__userChromeHotReloadYieldWatcher = yieldWatcher;
    window.addEventListener("beforeunload", cleanupWindow, { once: true });

    // If a newly opened window becomes most recent, transfer watcher state
    // from any existing owner before starting its own poller.
    if (window === mostRecentWindow && !getPref("bool", PREF_PAUSED, false)) {
      let inheritedState = window.__userChromeHotReloadPausedState || null;
      delete window.__userChromeHotReloadPausedState;
      for (const otherWindow of chromeWindows()) {
        if (otherWindow === window || otherWindow.closed) {
          continue;
        }
        const pausedState = otherWindow.__userChromeHotReloadPausedState;
        if (pausedState) {
          if (!inheritedState) {
            inheritedState = pausedState;
          }
          delete otherWindow.__userChromeHotReloadPausedState;
          continue;
        }
        if (typeof otherWindow.__userChromeHotReloadYieldWatcher !== "function") {
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
          inheritedState.forceReloadOnHandoff,
          inheritedState.pendingChangedFiles
        );
      } else {
        startWatcher();
      }
    }
  }

  init();
})();