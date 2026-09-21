export class UserChromeHotReloadChild extends JSWindowActorChild {
  receiveMessage(message) {
    if (message.name !== "update-sheets") {
      return;
    }
    const { uri } = message.data || {};
    if (!uri) {
      return;
    }
    try {
      const utils = this.contentWindow.windowUtils;
      const sheetURI = Services.io.newURI(uri);
      try {
        utils.removeSheet(sheetURI, utils.USER_SHEET);
      } catch (e) {}
      utils.loadSheet(sheetURI, utils.USER_SHEET);
    } catch (e) {
      console.error("[UserChrome Hot-Reload] Failed to reload content sheet:", e);
    }
  }
}

export default UserChromeHotReloadChild;