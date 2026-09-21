const REBUILD_MESSAGE = "UserChromeHotReload:RebuildUserStyles";
const CONTENT_URI =
  "chrome://sine/content/zen-userchrome-hot-reload/generated/content.css";

export class UserChromeHotReloadChild extends JSWindowActorChild {
  constructor() {
    super();
    Services.cpmm.addMessageListener(REBUILD_MESSAGE, this);
  }

  didDestroy() {
    Services.cpmm.removeMessageListener(REBUILD_MESSAGE, this);
  }

  handleEvent(event) {
    if (event.type === "DOMWindowCreated") {
      this.injectUserStyle();
    }
  }

  receiveMessage(message) {
    if (message.name === REBUILD_MESSAGE) {
      this.removeUserStyle();
      this.injectUserStyle();
    }
  }

  injectUserStyle() {
    const utils = this.contentWindow?.windowUtils;
    if (!utils) {
      return;
    }
    try {
      utils.loadSheet(Services.io.newURI(CONTENT_URI), utils.USER_SHEET);
    } catch (e) {
      console.error("[UserChrome Hot-Reload] Failed to inject content style:", e);
    }
  }

  removeUserStyle() {
    const utils = this.contentWindow?.windowUtils;
    if (!utils) {
      return;
    }
    try {
      utils.removeSheet(Services.io.newURI(CONTENT_URI), utils.USER_SHEET);
    } catch (e) {}
  }
}

export default UserChromeHotReloadChild;
