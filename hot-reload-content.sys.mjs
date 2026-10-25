export class UserChromeHotReloadChild extends JSWindowActorChild {
  receiveMessage(message) {
    if (message.name !== "update-sheets") {
      return;
    }
    const { uri } = message.data || {};
    if (!uri) {
      return { ok: false, error: "Missing stylesheet URI" };
    }
    try {
      const win = this.contentWindow;
      const utils = win?.windowUtils;
      if (!utils) {
        return { ok: false, error: "Content window unavailable" };
      }
      const sheetURI = Services.io.newURI(uri);
      try {
        utils.removeSheet(sheetURI, utils.USER_SHEET);
      } catch (e) {}
      utils.loadSheet(sheetURI, utils.USER_SHEET);
      return { ok: true };
    } catch (e) {
      console.error("[UserChrome Hot-Reload] Failed to reload content sheet:", e);
      return { ok: false, error: String(e) };
    }
  }
}

export default UserChromeHotReloadChild;