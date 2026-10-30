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
  const entryFiles = [
    "/profile/chrome/userChrome.css",
    "/profile/chrome/userContent.css",
    "/profile/chrome/active.css",
    "/profile/chrome/content.css",
  ];
  let children = [...entryFiles];
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
      if (path === "/profile/chrome") {
        return { type: "directory", lastModified: 1, size: children.length };
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
      if (cssFileStats.has(path) && children.includes(path)) {
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
      if (path !== "/profile/chrome/sine-mods/mods.json") {
        throw new Error("Unexpected JSON path: " + path);
      }
      return structuredClone(sineModsData);
    },
    async getChildren() {
      return [...children];
    },
  };

  function addWindow() {
    const listeners = new Map();
    const win = {
      closed: false,
      document: { getElementById: () => null },
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
      Ci: { nsIFileURL: {} },
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
      Date,
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
    modifyCssFile(path, content) {
      cssModified += 1;
      cssFileStats.set(path, { lastModified: cssModified, size: content.length });
      cssTexts.set(path, content);
    },
    setCssText(path, content) {
      cssTexts.set(path, content);
      cssFileStats.set(path, { lastModified: cssModified, size: content.length });
    },
    sheetLoads: () => sheetLoads,
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
