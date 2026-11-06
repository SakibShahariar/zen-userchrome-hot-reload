import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const sourcePath = fileURLToPath(new URL("../userchrome-hot-reload.uc.js", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

function createHarness() {
  const windows = [];
  const prefValues = new Map([
    ["extensions.zen-userchrome-hot-reload.reload-chrome", false],
    ["extensions.zen-userchrome-hot-reload.reload-content", false],
    ["extensions.zen-userchrome-hot-reload.reload-sine-mods", false],
  ]);
  const prefObservers = new Map();
  const intervals = new Map();
  const timeouts = new Map();
  let nextTimerId = 1;
  let currentTime = 1_000;
  const entryFiles = [
    "/profile/chrome/userChrome.css",
    "/profile/chrome/userContent.css",
    "/profile/chrome/active.css",
    "/profile/chrome/content.css",
  ];
  let children = [...entryFiles];
  const extraRoots = new Map();
  const directoryReadCounts = new Map();
  const statRequests = new Set();
  const fileStatCounts = new Map();
  const fileStore = new Map();
  const menuItems = new Map();
  let filePickerPath = "/tmp/zen-userchrome-hot-reload-settings.json";
  let filePickerResult = 0;
  let confirmImport = true;
  const specialEntries = new Map();
  let pathExpandingCycleRoot = null;
  let cssModified = 1;
  const cssFileStats = new Map(entryFiles.map((path) => [path, { lastModified: 1, size: 10 }]));
  const cssTexts = new Map([
    ["/profile/chrome/userChrome.css", '@import "active.css";'],
    ["/profile/chrome/userContent.css", '@import url("content.css");'],
    ["/profile/chrome/active.css", ".active { color: red; }"],
    ["/profile/chrome/content.css", ".content { color: blue; }"],
  ]);
  let sheetLoads = 0;
  let sineMetadataModified = 1;
  let sineStyleModified = 1;
  let sineModsData = {
    "test-mod": {
      enabled: true,
      style: { chrome: "theme.css" },
    },
  };
  const rebuildCalls = [];

  const io = {
    async stat(path) {
      statRequests.add(path);
      if (cssFileStats.has(path)) fileStatCounts.set(path, (fileStatCounts.get(path) ?? 0) + 1);
      if (pathExpandingCycleRoot && (path === pathExpandingCycleRoot || path.startsWith(pathExpandingCycleRoot + "/"))) {
        return { type: "directory", lastModified: 1, size: 1 };
      }
      if (specialEntries.has(path)) {
        return { type: specialEntries.get(path), lastModified: 1, size: 10 };
      }
      if (path === "/profile/chrome") {
        return { type: "directory", lastModified: 1, size: children.length };
      }
      if (extraRoots.has(path)) {
        return { type: "directory", lastModified: 1, size: extraRoots.get(path).length };
      }
      if (path === "/profile/chrome/sine-mods/mods.json") {
        return {
          type: "regular",
          lastModified: sineMetadataModified,
          size: JSON.stringify(sineModsData).length,
        };
      }
      if (path === "/profile/chrome/sine-mods/test-mod/theme.css") {
        return { type: "regular", lastModified: sineStyleModified, size: 20 };
      }
      if (cssFileStats.has(path) && (children.includes(path) || [...extraRoots.values()].some((paths) => paths.includes(path)))) {
        return { type: "regular", ...cssFileStats.get(path) };
      }
      throw new Error("Path not found: " + path);
    },
    async readUTF8(path) {
      if (!cssTexts.has(path)) {
        throw new Error("CSS file not found: " + path);
      }
      return cssTexts.get(path);
    },
    async readJSON(path) {
      if (fileStore.has(path)) return structuredClone(fileStore.get(path));
      if (path !== "/profile/chrome/sine-mods/mods.json") throw new Error("Unexpected JSON path: " + path);
      return structuredClone(sineModsData);
    },
    async writeJSON(path, value) {
      fileStore.set(path, structuredClone(value));
    },
    async getChildren(path) {
      directoryReadCounts.set(path, (directoryReadCounts.get(path) ?? 0) + 1);
      if (pathExpandingCycleRoot && (path === pathExpandingCycleRoot || path.startsWith(pathExpandingCycleRoot + "/"))) {
        return [path + "/loop"];
      }
      return [...(path === "/profile/chrome" ? children : extraRoots.get(path) ?? [])];
    },
  };

  function addWindow({ withAppMenu = false } = {}) {
    const listeners = new Map();
    const popup = withAppMenu ? { appendChild(item) { item.isConnected = true; menuItems.set(item.id, item); } } : null;
    const document = {
      getElementById(id) {
        if (id === "appMenu-popup") return popup;
        return menuItems.get(id) ?? null;
      },
      createXULElement() {
        const itemListeners = new Map();
        return {
          id: null,
          isConnected: false,
          setAttribute() {},
          removeAttribute() {},
          addEventListener(name, callback) { itemListeners.set(name, callback); },
          removeEventListener(name, callback) { if (itemListeners.get(name) === callback) itemListeners.delete(name); },
          remove() { this.isConnected = false; menuItems.delete(this.id); },
          __listeners: itemListeners,
        };
      },
    };
    const win = {
      closed: false,
      document,
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      removeEventListener(name, callback) {
        if (listeners.get(name) === callback) listeners.delete(name);
      },
      windowUtils: {
        USER_SHEET: 0,
        removeSheet() {},
        loadSheet() { sheetLoads += 1; },
      },
      gBrowser: { tabs: [] },
      __listeners: listeners,
    };
    windows.push(win);

    const services = {
      prefs: {
        prefHasUserValue: (name) => prefValues.has(name),
        getBoolPref: (name) => prefValues.get(name),
        getStringPref: (name) => prefValues.get(name),
        getIntPref: (name) => prefValues.get(name),
        setBoolPref(name, value) {
          prefValues.set(name, value);
          for (const observer of prefObservers.get(name) ?? []) observer.observe();
        },
        setStringPref(name, value) {
          prefValues.set(name, value);
          for (const observer of prefObservers.get(name) ?? []) observer.observe();
        },
        clearUserPref(name) {
          prefValues.delete(name);
          for (const observer of prefObservers.get(name) ?? []) observer.observe();
        },
        addObserver(name, observer) {
          const observers = prefObservers.get(name) ?? [];
          observers.push(observer);
          prefObservers.set(name, observers);
        },
        removeObserver(name, observer) {
          prefObservers.set(name, (prefObservers.get(name) ?? []).filter((item) => item !== observer));
        },
      },
      wm: {
        getMostRecentWindow: () => windows.at(-1) ?? null,
        getEnumerator: () => {
          let index = 0;
          return {
            hasMoreElements: () => index < windows.length,
            getNext: () => windows[index++],
          };
        },
      },
      appinfo: { name: "Test Browser", version: "1" },
      io: {
        newURI(spec, charset, baseURI) {
          const parsed = baseURI ? new URL(spec, baseURI.spec) : new URL(spec);
          return {
            spec: parsed.href,
            scheme: parsed.protocol.slice(0, -1),
            QueryInterface() {
              return { file: { path: decodeURIComponent(parsed.pathname) } };
            },
          };
        },
      },
      obs: { notifyObservers() {} },
      prompt: { confirm() { return confirmImport; } },
    };

    const context = vm.createContext({
      window: win,
      Services: services,
      IOUtils: io,
      PathUtils: {
        profileDir: "/profile",
        join: (...parts) => parts.join("/"),
        filename: (path) => path.split("/").at(-1),
        toFileURI: (path) => "file://" + path,
      },
      ChromeUtils: { registerWindowActor() {} },
      Ci: {
        nsIFileURL: {},
        nsIFilePicker: { modeOpen: 0, modeSave: 1, returnOK: 0, returnCancel: 1, returnReplace: 2 },
      },
      Cc: {
        "@mozilla.org/filepicker;1": {
          createInstance() {
            return {
              init() {},
              appendFilter() {},
              defaultString: "",
              file: { path: filePickerPath },
              open(callback) { callback(filePickerResult); },
            };
          },
        },
      },
      setInterval(callback) {
        const id = nextTimerId++;
        intervals.set(id, { callback, window: win });
        return id;
      },
      clearInterval(id) {
        intervals.delete(id);
      },
      setTimeout(callback) {
        const id = nextTimerId++;
        timeouts.set(id, { callback, window: win });
        return id;
      },
      clearTimeout(id) {
        timeouts.delete(id);
      },
      console: { debug() {}, info() {}, warn() {}, error() {} },
      Date: class TestDate extends Date {
        static now() { return currentTime; }
      },
      Map,
      Set,
      Promise,
      Array,
      Number,
      String,
      Math,
    });
    vm.runInContext(source, context, { filename: "userchrome-hot-reload.uc.js" });
    return win;
  }

  async function flushAsyncWork() {
    await new Promise((resolve) => setImmediate(resolve));
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  return {
    addWindow,
    setPref(name, value) {
      prefValues.set(name, value);
      for (const observer of prefObservers.get(name) ?? []) observer.observe();
    },
    intervals,
    timeouts,
    flushAsyncWork,
    setCssFiles(paths) {
      children = [...new Set([...entryFiles, ...paths])];
      for (const path of paths) {
        cssModified += 1;
        cssFileStats.set(path, { lastModified: cssModified, size: 10 });
        if (!cssTexts.has(path)) cssTexts.set(path, "");
      }
    },
    setExtraRoot(root, paths) {
      extraRoots.set(root, [...paths]);
      if (root.startsWith("/profile/chrome/") && !children.includes(root)) children.push(root);
      for (const path of paths) {
        cssModified += 1;
        cssFileStats.set(path, { lastModified: cssModified, size: 10 });
        if (!cssTexts.has(path)) cssTexts.set(path, "");
      }
    },
    modifyCssFile(path, content) {
      cssModified += 1;
      cssFileStats.set(path, { lastModified: cssModified, size: content.length });
      cssTexts.set(path, content);
    },
    replaceCssFile(path, content) {
      const previous = cssFileStats.get(path);
      assert.ok(previous, "expected the CSS file to exist before replacement");
      cssModified += 1;
      cssFileStats.set(path, { lastModified: cssModified, size: previous.size });
      cssTexts.set(path, content);
    },
    renameCssFile(oldPath, newPath) {
      const index = children.indexOf(oldPath);
      assert.notEqual(index, -1, "expected the CSS file to exist before rename");
      const previous = cssFileStats.get(oldPath);
      children[index] = newPath;
      cssFileStats.delete(oldPath);
      cssFileStats.set(newPath, {
        lastModified: (previous?.lastModified ?? 0) + 1,
        size: previous?.size ?? 10,
      });
      cssTexts.set(newPath, cssTexts.get(oldPath) ?? "");
      cssTexts.delete(oldPath);
    },
    advanceTime(milliseconds) {
      currentTime += milliseconds;
    },
    setCssText(path, content) {
      cssTexts.set(path, content);
      cssFileStats.set(path, { lastModified: cssModified, size: content.length });
    },
    sheetLoads: () => sheetLoads,
    directoryReads: (path) => directoryReadCounts.get(path) ?? 0,
    directoryReadTotal: () => [...directoryReadCounts.values()].reduce((total, count) => total + count, 0),
    wasStatRequested: (path) => statRequests.has(path),
    fileStatCount: (path) => fileStatCounts.get(path) ?? 0,
    configureFilePicker({ path = filePickerPath, result = 0 } = {}) { filePickerPath = path; filePickerResult = result; },
    setImportedSettings(path, payload) { fileStore.set(path, structuredClone(payload)); },
    exportedSettings(path = filePickerPath) { return structuredClone(fileStore.get(path)); },
    setImportConfirmation(value) { confirmImport = value; },
    getPreference(name) { return prefValues.get(name); },
    triggerMenuItem(id) {
      const item = menuItems.get(id);
      assert.ok(item, "expected app-menu item");
      const handler = item.__listeners.get("command");
      assert.equal(typeof handler, "function");
      handler();
    },
    addSpecialEntry(path, type) {
      children.push(path);
      specialEntries.set(path, type);
    },
    addPathExpandingSymlinkCycle(root) {
      children.push(root);
      pathExpandingCycleRoot = root;
    },
    modifySineStyle() {
      sineStyleModified += 1;
    },
    modifySineMetadata(nextData) {
      sineModsData = nextData;
      sineMetadataModified += 1;
    },
    setManager(win) {
      win.manager = {
        async rebuildMods(...args) {
          rebuildCalls.push(args);
          return true;
        },
      };
    },
    rebuildCalls,
    async runDebouncedReload() {
      const pending = [...timeouts.values()];
      assert.ok(pending.length > 0, "expected a pending debounced reload");
      timeouts.clear();
      for (const timer of pending) timer.callback();
      await flushAsyncWork();
    },
    runPollFor(win) {
      const timer = [...intervals.values()].find((entry) => entry.window === win);
      assert.ok(timer, "expected this window to own the poll interval");
      timer.callback();
    },
    closeWindow(win) {
      win.closed = true;
      win.__listeners.get("beforeunload")?.();
    },
    activePollers: () => intervals.size,
  };
}

test("new most-recent window takes ownership without leaving a second poller", async () => {
  const harness = createHarness();
  const first = harness.addWindow();
  await harness.flushAsyncWork();
  assert.equal(harness.activePollers(), 1);

  const second = harness.addWindow();
  await harness.flushAsyncWork();
  assert.equal(first.__userChromeHotReloadIsWatcherOwner, false);
  assert.equal(second.__userChromeHotReloadIsWatcherOwner, true);
  assert.equal(harness.activePollers(), 1);

  harness.closeWindow(second);
  assert.equal(first.__userChromeHotReloadIsWatcherOwner, true);
  assert.equal(harness.activePollers(), 1);
});

test("a pending debounced change is reloaded when watcher ownership moves", async () => {
  const harness = createHarness();
  const first = harness.addWindow();
  await harness.flushAsyncWork();

  harness.setCssFiles(["/profile/chrome/theme.css"]);
  harness.runPollFor(first);
  await harness.flushAsyncWork();
  assert.equal(harness.timeouts.size, 1, "file change should schedule a debounced reload");

  const second = harness.addWindow();
  await harness.flushAsyncWork();
  assert.equal(harness.activePollers(), 1);
  assert.equal(harness.timeouts.size, 0, "handoff should cancel the old window's debounce timer");
  assert.equal(second.__userChromeHotReloadLastReloadStatus, "Skipped",
    "handoff should force one reload pass for the pending change");
});

test("pause, resume, disable, and re-enable keep one watcher across windows", async () => {
  const harness = createHarness();
  const first = harness.addWindow();
  await harness.flushAsyncWork();
  const second = harness.addWindow();
  await harness.flushAsyncWork();
  assert.equal(harness.activePollers(), 1);
  assert.equal(second.__userChromeHotReloadIsWatcherOwner, true);

  const pausedPref = "extensions.zen-userchrome-hot-reload.paused";
  harness.setPref(pausedPref, true);
  assert.equal(harness.activePollers(), 0, "pausing should stop the only poller");
  harness.setPref(pausedPref, false);
  await harness.flushAsyncWork();
  assert.equal(harness.activePollers(), 1, "resuming should restore one poller");
  assert.equal(second.__userChromeHotReloadIsWatcherOwner, true);

  const enabledPref = "extensions.zen-userchrome-hot-reload.enabled";
  harness.setPref(enabledPref, false);
  assert.equal(harness.activePollers(), 0, "disabling should stop polling in every window");
  harness.setPref(enabledPref, true);
  await harness.flushAsyncWork();
  assert.equal(harness.activePollers(), 1, "re-enabling should start only one poller");
  assert.equal(second.__userChromeHotReloadIsWatcherOwner, true);
  assert.equal(first.__userChromeHotReloadIsWatcherOwner, false);
});


test("Sine rebuilds only for its tracked styles and never reloads mod JavaScript", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  harness.setManager(win);
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-sine-mods", true);
  await harness.flushAsyncWork();

  harness.setCssFiles(["/profile/chrome/theme.css"]);
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();
  assert.equal(harness.rebuildCalls.length, 0,
    "ordinary profile CSS changes should not rebuild Sine when metadata is available");

  harness.modifySineStyle();
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();
  assert.deepEqual(harness.rebuildCalls, [[false, true]],
    "Sine stylesheet changes should rebuild styles without reloading mod scripts");
});

test("Sine metadata changes trigger a rebuild and refresh the tracked style paths", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  harness.setManager(win);
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-sine-mods", true);
  await harness.flushAsyncWork();

  harness.modifySineMetadata({
    "test-mod": { enabled: true, style: { chrome: "new-theme.css" } },
  });
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();
  assert.deepEqual(harness.rebuildCalls, [[false, true]],
    "changing Sine's mod metadata should rebuild its generated styles");
});


test("unimported CSS files do not reload active stylesheets", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-chrome", true);
  await harness.flushAsyncWork();

  harness.setCssFiles(["/profile/chrome/unused.css"]);
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();

  assert.equal(harness.sheetLoads(), 0,
    "a tracked CSS file outside both entrypoint import graphs should be ignored");
});

test("CSS imported by userChrome.css reloads only the chrome stylesheet", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-chrome", true);
  await harness.flushAsyncWork();

  harness.modifyCssFile("/profile/chrome/active.css", ".active { color: green; }");
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();

  assert.equal(harness.sheetLoads(), 1,
    "a CSS dependency of userChrome.css should reload the browser chrome stylesheet");
});


test("unresolved imports retain the conservative full-reload fallback", async () => {
  const harness = createHarness();
  harness.setCssText("/profile/chrome/userChrome.css", '@import "not-tracked.css";');
  const win = harness.addWindow();
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-chrome", true);
  await harness.flushAsyncWork();

  harness.setCssFiles(["/profile/chrome/unused.css"]);
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();

  assert.equal(harness.sheetLoads(), 1,
    "an incomplete import graph must not suppress the chrome stylesheet reload");
});

test("userContent-only dependencies do not reload browser chrome", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-chrome", true);
  await harness.flushAsyncWork();

  harness.modifyCssFile("/profile/chrome/content.css", ".content { color: purple; }");
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();

  assert.equal(harness.sheetLoads(), 0,
    "a userContent.css-only dependency should not reload userChrome.css");
});


test("multiple watch roots detect CSS changes outside the profile chrome directory", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  harness.setPref("extensions.zen-userchrome-hot-reload.watch-path", '["/profile/chrome", "/external/styles"]');
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-chrome", true);
  harness.setExtraRoot("/external/styles", ["/external/styles/generated.css"]);
  harness.setCssText("/profile/chrome/userChrome.css", '@import "file:///external/styles/generated.css";');
  await harness.flushAsyncWork();
  harness.modifyCssFile("/external/styles/generated.css", ".generated { color: green; }");
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();
  assert.equal(harness.sheetLoads(), 1, "a secondary root change should trigger one reload");
});

test("duplicate watch roots do not duplicate a changed CSS path", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  harness.setPref("extensions.zen-userchrome-hot-reload.watch-path", '["/profile/chrome", "/profile/chrome"]');
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-chrome", true);
  await harness.flushAsyncWork();
  harness.modifyCssFile("/profile/chrome/active.css", ".active { color: orange; }");
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();
  assert.equal(harness.sheetLoads(), 1, "the same path must only trigger one reload");
});

test("Sine tracking works when profile chrome is not the first configured root", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  harness.setManager(win);
  harness.setPref("extensions.zen-userchrome-hot-reload.watch-path", '["/external/styles", "/profile/chrome"]');
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-sine-mods", true);
  harness.setExtraRoot("/external/styles", ["/external/styles/generated.css"]);
  await harness.flushAsyncWork();
  harness.modifySineStyle();
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();
  assert.deepEqual(harness.rebuildCalls, [[false, true]], "Sine stylesheet tracking must remain enabled");
});


test("parent and child watch roots scan their overlapping directory only once", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  harness.setPref("extensions.zen-userchrome-hot-reload.watch-path", '["/profile/chrome", "/profile/chrome/mods"]');
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-chrome", true);
  harness.setExtraRoot("/profile/chrome/mods", ["/profile/chrome/mods/theme.css"]);
  harness.setCssText("/profile/chrome/userChrome.css", '@import "mods/theme.css";');
  await harness.flushAsyncWork();
  assert.equal(harness.directoryReads("/profile/chrome/mods"), 1,
    "the child root should be scanned as part of the parent and not scanned a second time");

  harness.modifyCssFile("/profile/chrome/mods/theme.css", ".theme { color: teal; }");
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();
  assert.equal(harness.sheetLoads(), 1, "the overlapping CSS path should trigger exactly one reload");
  assert.equal(harness.directoryReads("/profile/chrome/mods"), 1,
    "the cached overlapping directory should not be rescanned for the second root");
});

test("same-size atomic CSS replacements are detected while directory listings stay cached", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-chrome", true);
  await harness.flushAsyncWork();
  assert.equal(harness.directoryReads("/profile/chrome"), 1);

  harness.replaceCssFile("/profile/chrome/active.css", ".active { color: blue; }");
  harness.runPollFor(win);
  await harness.flushAsyncWork();

  assert.equal(harness.directoryReads("/profile/chrome"), 1,
    "an unchanged directory listing should be reused");
  assert.equal(harness.timeouts.size, 1,
    "the per-file metadata check should detect the replacement without a directory rescan");
  await harness.runDebouncedReload();
  assert.equal(harness.sheetLoads(), 1,
    "the changed imported stylesheet should be reloaded");
});

test("periodic directory revalidation discovers renamed CSS entries with unchanged directory metadata", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  await harness.flushAsyncWork();
  assert.equal(harness.directoryReads("/profile/chrome"), 1);

  harness.renameCssFile("/profile/chrome/active.css", "/profile/chrome/renamed.css");
  harness.advanceTime(9_999);
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  assert.equal(harness.directoryReads("/profile/chrome"), 1,
    "the cached listing should remain effective before the revalidation interval");
  await harness.runDebouncedReload();

  harness.advanceTime(1);
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  assert.equal(harness.directoryReads("/profile/chrome"), 2,
    "the directory should be listed again after ten seconds even when its metadata is unchanged");
  assert.equal(harness.timeouts.size, 1,
    "the refreshed listing should discover the newly named CSS file");
});

test("Sine metadata cannot escape its mod directory through traversal paths", async () => {
  const harness = createHarness();
  harness.modifySineMetadata({
    "../outside-mod": { enabled: true, style: { chrome: "theme.css" } },
    "safe-mod": { enabled: true, style: { chrome: "../outside.css" } },
  });
  const win = harness.addWindow();
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-sine-mods", true);
  await harness.flushAsyncWork();

  assert.equal(harness.wasStatRequested("/profile/chrome/sine-mods/../outside-mod/theme.css"), false,
    "a mod ID containing traversal segments must be rejected");
  assert.equal(harness.wasStatRequested("/profile/chrome/sine-mods/safe-mod/../outside.css"), false,
    "a stylesheet path containing traversal segments must be rejected");
});

test("path-expanding symlink cycles remain bounded by the recursive scan depth limit", async () => {
  const harness = createHarness();
  harness.setPref("extensions.zen-userchrome-hot-reload.watch-nested-directories", true);
  harness.addPathExpandingSymlinkCycle("/profile/chrome/loop");
  harness.addWindow();
  await harness.flushAsyncWork();

  assert.ok(harness.directoryReadTotal() <= 65,
    "the root plus at most 64 nested directory levels should be scanned");
});

test("directory scans ignore non-CSS regular files and unexpected filesystem entry types", async () => {
  const harness = createHarness();
  harness.addSpecialEntry("/profile/chrome/unexpected.css", "symlink");
  harness.addSpecialEntry("/profile/chrome/mod-script.js", "regular");
  const win = harness.addWindow();
  await harness.flushAsyncWork();

  harness.runPollFor(win);
  await harness.flushAsyncWork();
  assert.equal(harness.timeouts.size, 0,
    "non-CSS files and non-regular CSS entries must not trigger stylesheet reloads");
});

test("relative watch roots are rejected and fall back to the profile chrome directory", async () => {
  const harness = createHarness();
  harness.setPref("extensions.zen-userchrome-hot-reload.watch-path", "../outside");
  harness.addWindow();
  await harness.flushAsyncWork();

  assert.equal(harness.wasStatRequested("../outside"), false,
    "a relative watch root must never be passed to filesystem scanning");
  assert.ok(harness.wasStatRequested("/profile/chrome"),
    "an invalid custom path should fall back to the profile chrome directory");
});

test("large nested CSS trees reuse directory listings while refreshing file metadata", async () => {
  const harness = createHarness();
  const directories = Array.from({ length: 10 }, (_, index) =>
    `/profile/chrome/generated-${index}`
  );
  const filesByDirectory = directories.map((directory, index) =>
    Array.from({ length: 50 }, (_, fileIndex) =>
      `${directory}/theme-${index}-${fileIndex}.css`
    )
  );
  directories.forEach((directory, index) => harness.setExtraRoot(directory, filesByDirectory[index]));
  harness.setPref("extensions.zen-userchrome-hot-reload.watch-nested-directories", true);
  const win = harness.addWindow();
  await harness.flushAsyncWork();

  assert.equal(harness.directoryReads("/profile/chrome"), 1);
  for (const directory of directories) {
    assert.equal(harness.directoryReads(directory), 1,
      "each nested directory should be listed once during the initial scan");
  }

  harness.runPollFor(win);
  await harness.flushAsyncWork();

  assert.equal(harness.directoryReads("/profile/chrome"), 1,
    "the root listing should be reused on the next poll");
  for (const directory of directories) {
    assert.equal(harness.directoryReads(directory), 1,
      "nested directory listings should remain cached on the next poll");
  }
  assert.equal(harness.fileStatCount(filesByDirectory[0][0]), 2,
    "CSS file metadata should still be refreshed on each poll");
  assert.equal(harness.fileStatCount(filesByDirectory[9][49]), 2,
    "the cache should behave consistently across the full 500-file fixture");
  assert.equal(harness.timeouts.size, 0,
    "an unchanged large tree should not trigger reloads");
});

test("settings export writes a versioned snapshot of supported preferences", async () => {
  const harness = createHarness();
  harness.setPref("extensions.zen-userchrome-hot-reload.poll-interval-ms", "750");
  harness.addWindow({ withAppMenu: true });
  await harness.flushAsyncWork();

  harness.triggerMenuItem("zen-userchrome-hot-reload-export-settings");
  await harness.flushAsyncWork();

  const payload = harness.exportedSettings();
  assert.equal(payload.format, "zen-userchrome-hot-reload-settings");
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.preferences["poll-interval-ms"], "750");
  assert.equal(Object.keys(payload.preferences).length, 13);
});

test("settings import applies only included known preferences after validation", async () => {
  const harness = createHarness();
  const path = "/tmp/import-settings.json";
  harness.setImportedSettings(path, {
    format: "zen-userchrome-hot-reload-settings",
    schemaVersion: 1,
    preferences: { "poll-interval-ms": "900", "reload-chrome": true },
  });
  harness.setPref("extensions.zen-userchrome-hot-reload.poll-interval-ms", "500");
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-chrome", false);
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-content", false);
  harness.configureFilePicker({ path });
  harness.addWindow({ withAppMenu: true });
  await harness.flushAsyncWork();

  harness.triggerMenuItem("zen-userchrome-hot-reload-import-settings");
  await harness.flushAsyncWork();

  assert.equal(harness.getPreference("extensions.zen-userchrome-hot-reload.poll-interval-ms"), "900");
  assert.equal(harness.getPreference("extensions.zen-userchrome-hot-reload.reload-chrome"), true);
  assert.equal(harness.getPreference("extensions.zen-userchrome-hot-reload.reload-content"), false);
});

test("invalid numeric settings are rejected without partially applying an import", async () => {
  const harness = createHarness();
  const path = "/tmp/invalid-numeric-settings.json";
  harness.setImportedSettings(path, {
    format: "zen-userchrome-hot-reload-settings",
    schemaVersion: 1,
    preferences: { "poll-interval-ms": "not-a-number", "reload-chrome": true },
  });
  harness.setPref("extensions.zen-userchrome-hot-reload.poll-interval-ms", "500");
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-chrome", false);
  harness.configureFilePicker({ path });
  harness.addWindow({ withAppMenu: true });
  await harness.flushAsyncWork();

  harness.triggerMenuItem("zen-userchrome-hot-reload-import-settings");
  await harness.flushAsyncWork();

  assert.equal(harness.getPreference("extensions.zen-userchrome-hot-reload.poll-interval-ms"), "500");
  assert.equal(harness.getPreference("extensions.zen-userchrome-hot-reload.reload-chrome"), false);
});

test("cancelled settings file selection leaves settings and exports untouched", async () => {
  const harness = createHarness();
  harness.configureFilePicker({ result: 1 });
  harness.setPref("extensions.zen-userchrome-hot-reload.poll-interval-ms", "500");
  harness.addWindow({ withAppMenu: true });
  await harness.flushAsyncWork();

  harness.triggerMenuItem("zen-userchrome-hot-reload-export-settings");
  await harness.flushAsyncWork();

  assert.equal(harness.exportedSettings(), undefined);
  assert.equal(harness.getPreference("extensions.zen-userchrome-hot-reload.poll-interval-ms"), "500");
});

test("declining settings import confirmation leaves preferences unchanged", async () => {
  const harness = createHarness();
  const path = "/tmp/declined-settings.json";
  harness.setImportedSettings(path, {
    format: "zen-userchrome-hot-reload-settings",
    schemaVersion: 1,
    preferences: { "poll-interval-ms": "900" },
  });
  harness.setPref("extensions.zen-userchrome-hot-reload.poll-interval-ms", "500");
  harness.setImportConfirmation(false);
  harness.configureFilePicker({ path });
  harness.addWindow({ withAppMenu: true });
  await harness.flushAsyncWork();

  harness.triggerMenuItem("zen-userchrome-hot-reload-import-settings");
  await harness.flushAsyncWork();

  assert.equal(harness.getPreference("extensions.zen-userchrome-hot-reload.poll-interval-ms"), "500");
});

test("invalid watch-path arrays reject the entire settings import before applying other keys", async () => {
  const harness = createHarness();
  const path = "/tmp/invalid-watch-path-settings.json";
  harness.setImportedSettings(path, {
    format: "zen-userchrome-hot-reload-settings",
    schemaVersion: 1,
    preferences: { "poll-interval-ms": "900", "watch-path": "[null]" },
  });
  harness.setPref("extensions.zen-userchrome-hot-reload.poll-interval-ms", "500");
  harness.configureFilePicker({ path });
  harness.addWindow({ withAppMenu: true });
  await harness.flushAsyncWork();

  harness.triggerMenuItem("zen-userchrome-hot-reload-import-settings");
  await harness.flushAsyncWork();

  assert.equal(harness.getPreference("extensions.zen-userchrome-hot-reload.poll-interval-ms"), "500");
});

test("unsupported settings schema is rejected without changing preferences", async () => {
  const harness = createHarness();
  const path = "/tmp/invalid-settings.json";
  harness.setImportedSettings(path, {
    format: "zen-userchrome-hot-reload-settings",
    schemaVersion: 99,
    preferences: { "poll-interval-ms": "900" },
  });
  harness.setPref("extensions.zen-userchrome-hot-reload.poll-interval-ms", "500");
  harness.configureFilePicker({ path });
  harness.addWindow({ withAppMenu: true });
  await harness.flushAsyncWork();

  harness.triggerMenuItem("zen-userchrome-hot-reload-import-settings");
  await harness.flushAsyncWork();

  assert.equal(harness.getPreference("extensions.zen-userchrome-hot-reload.poll-interval-ms"), "500");
});

test("a legacy single custom watch path remains supported", async () => {
  const harness = createHarness();
  const win = harness.addWindow();
  harness.setPref("extensions.zen-userchrome-hot-reload.watch-path", "/external/styles");
  harness.setPref("extensions.zen-userchrome-hot-reload.reload-chrome", true);
  harness.setExtraRoot("/external/styles", ["/external/styles/generated.css"]);
  harness.setCssText("/profile/chrome/userChrome.css", '@import "file:///external/styles/generated.css";');
  await harness.flushAsyncWork();
  harness.modifyCssFile("/external/styles/generated.css", ".generated { color: navy; }");
  harness.runPollFor(win);
  await harness.flushAsyncWork();
  await harness.runDebouncedReload();
  assert.equal(harness.sheetLoads(), 1, "the original single-path setting should continue to work");
});
