import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const sourcePath = fileURLToPath(new URL("../userchrome-hot-reload.uc.js", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

function createHarness() {
  const windows = [];
  const intervals = new Map();
  const timeouts = new Map();
  let nextTimerId = 1;
  let children = [];
  let cssModified = 1;

  const io = {
    async stat(path) {
      if (path === "/profile/chrome") {
        return { type: "directory", lastModified: 1, size: children.length };
      }
      if (children.includes(path)) {
        return { type: "regular", lastModified: cssModified, size: 10 };
      }
      throw new Error("Path not found: " + path);
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
      windowUtils: { USER_SHEET: 0, removeSheet() {}, loadSheet() {} },
      gBrowser: { tabs: [] },
      __listeners: listeners,
    };
    windows.push(win);

    const prefs = new Map([
      ["extensions.zen-userchrome-hot-reload.reload-chrome", false],
      ["extensions.zen-userchrome-hot-reload.reload-content", false],
      ["extensions.zen-userchrome-hot-reload.reload-sine-mods", false],
    ]);
    const services = {
      prefs: {
        prefHasUserValue: (name) => prefs.has(name),
        getBoolPref: (name) => prefs.get(name),
        getStringPref: (name) => prefs.get(name),
        getIntPref: (name) => prefs.get(name),
        addObserver() {},
        removeObserver() {},
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
      io: { newURI: (spec) => ({ spec }) },
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
    intervals,
    timeouts,
    flushAsyncWork,
    setCssFiles(paths) {
      children = [...paths];
      cssModified += 1;
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
