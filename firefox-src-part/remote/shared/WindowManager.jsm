/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = ["windowManager"];

const { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);

XPCOMUtils.defineLazyModuleGetters(this, {
  Services: "resource://gre/modules/Services.jsm",

  AppInfo: "chrome://remote/content/marionette/appinfo.js",
  error: "chrome://remote/content/shared/webdriver/Errors.jsm",
  TabManager: "chrome://remote/content/shared/TabManager.jsm",
  TimedPromise: "chrome://remote/content/marionette/sync.js",
  EventPromise: "chrome://remote/content/shared/Sync.jsm",
  waitForObserverTopic: "chrome://remote/content/marionette/sync.js",
});

/**
 * Provides helpers to interact with Window objects.
 *
 * @class WindowManager
 */
class WindowManager {
  constructor() {
    // Maps ChromeWindow to uuid: WeakMap.<Object, string>
    this._chromeWindowHandles = new WeakMap();
  }

  get chromeWindowHandles() {
    const chromeWindowHandles = [];

    for (const win of this.windows) {
      chromeWindowHandles.push(this.getIdForWindow(win));
    }

    return chromeWindowHandles;
  }

  get windows() {
    return Services.wm.getEnumerator(null);
  }

  /**
   * Find a specific window matching the provided window handle.
   *
   * @param {String} handle
   *     The unique handle of either a chrome window or a content browser, as
   *     returned by :js:func:`#getIdForBrowser` or :js:func:`#getIdForWindow`.
   *
   * @return {Object} A window properties object,
   *     @see :js:func:`GeckoDriver#getWindowProperties`
   */
  findWindowByHandle(handle) {
    for (const win of this.windows) {
      // In case the wanted window is a chrome window, we are done.
      const chromeWindowId = this.getIdForWindow(win);
      if (chromeWindowId == handle) {
        return this.getWindowProperties(win);
      }

      // Otherwise check if the chrome window has a tab browser, and that it
      // contains a tab with the wanted window handle.
      const tabBrowser = TabManager.getTabBrowser(win);
      if (tabBrowser && tabBrowser.tabs) {
        for (let i = 0; i < tabBrowser.tabs.length; ++i) {
          let contentBrowser = TabManager.getBrowserForTab(tabBrowser.tabs[i]);
          let contentWindowId = TabManager.getIdForBrowser(contentBrowser);

          if (contentWindowId == handle) {
            return this.getWindowProperties(win, { tabIndex: i });
          }
        }
      }
    }

    return null;
  }

  /**
   * A set of properties describing a window and that should allow to uniquely
   * identify it. The described window can either be a Chrome Window or a
   * Content Window.
   *
   * @typedef {Object} WindowProperties
   * @property {Window} win - The Chrome Window containing the window.
   *     When describing a Chrome Window, this is the window itself.
   * @property {String} id - The unique id of the containing Chrome Window.
   * @property {Boolean} hasTabBrowser - `true` if the Chrome Window has a
   *     tabBrowser.
   * @property {Number} tabIndex - Optional, the index of the specific tab
   *     within the window.
   */

  /**
   * Returns a WindowProperties object, that can be used with :js:func:`GeckoDriver#setWindowHandle`.
   *
   * @param {Window} win
   *     The Chrome Window for which we want to create a properties object.
   * @param {Object} options
   * @param {Number} options.tabIndex
   *     Tab index of a specific Content Window in the specified Chrome Window.
   * @return {WindowProperties} A window properties object.
   */
  getWindowProperties(win, options = {}) {
    if (!Window.isInstance(win)) {
      throw new TypeError("Invalid argument, expected a Window object");
    }

    return {
      win,
      id: this.getIdForWindow(win),
      hasTabBrowser: !!TabManager.getTabBrowser(win),
      tabIndex: options.tabIndex,
    };
  }

  /**
   * Retrieves an id for the given chrome window. The id is a dynamically
   * generated uuid associated with the window object.
   *
   * @param {window} win
   *     The window object for which we want to retrieve the id.
   * @return {String} The unique id for this chrome window.
   */
  getIdForWindow(win) {
    if (!this._chromeWindowHandles.has(win)) {
      const uuid = Services.uuid.generateUUID().toString();
      this._chromeWindowHandles.set(win, uuid.substring(1, uuid.length - 1));
    }
    return this._chromeWindowHandles.get(win);
  }

  /**
   * Close the specified window.
   *
   * @param {window} win
   *     The window to close.
   * @return {Promise}
   *     A promise which is resolved when the current window has been closed.
   */
  async closeWindow(win) {
    const destroyed = waitForObserverTopic("xul-window-destroyed", {
      checkFn: () => win && win.closed,
    });

    win.close();

    return destroyed;
  }

  /**
   * Focus the specified window.
   *
   * @param {window} win
   *     The window to focus.
   * @return {Promise}
   *     A promise which is resolved when the window has been focused.
   */
  async focusWindow(win) {
    if (Services.focus.activeWindow != win) {
      let activated = new EventPromise(win, "activate");
      let focused = new EventPromise(win, "focus", { capture: true });

      win.focus();

      await Promise.all([activated, focused]);
    }
  }

  /**
   * Open a new browser window.
   *
   * @param {Object=} options
   * @param {Boolean=} options.focus
   *     If true, the opened window will receive the focus. Defaults to false.
   * @param {Boolean=} options.isPrivate
   *     If true, the opened window will be a private window. Defaults to false.
   * @param {ChromeWindow=} options.openerWindow
   *     Use this window as the opener of the new window. Defaults to the
   *     topmost window.
   * @return {Promise}
   *     A promise resolving to the newly created chrome window.
   */
  async openBrowserWindow(options = {}) {
    let { focus = false, isPrivate = false, openerWindow = null } = options;

    switch (AppInfo.name) {
      case "Firefox":
        if (openerWindow === null) {
          // If no opener was provided, fallback to the topmost window.
          openerWindow = Services.wm.getMostRecentBrowserWindow();
        }

        if (!openerWindow) {
          throw new error.UnsupportedOperationError(
            `openWindow() could not find a valid opener window`
          );
        }

        // Open new browser window, and wait until it is fully loaded.
        // Also wait for the window to be focused and activated to prevent a
        // race condition when promptly focusing to the original window again.
        const win = openerWindow.OpenBrowserWindow({ private: isPrivate });

        const activated = new EventPromise(win, "activate");
        const focused = new EventPromise(win, "focus", { capture: true });
        const startup = waitForObserverTopic(
          "browser-delayed-startup-finished",
          {
            checkFn: subject => subject == win,
          }
        );

        // TODO: Both for WebDriver BiDi and classic, opening a new window
        // should not run the focus steps. When focus is false we should avoid
        // focusing the new window completely. See Bug 1766329
        win.focus();

        await Promise.all([activated, focused, startup]);

        // The new window shouldn't get focused. As such set the
        // focus back to the opening window.
        if (!focus) {
          await this.focusWindow(openerWindow);
        }

        return win;

      default:
        throw new error.UnsupportedOperationError(
          `openWindow() not supported in ${AppInfo.name}`
        );
    }
  }

  /**
   * Wait until the initial application window has been opened and loaded.
   *
   * @return {Promise<WindowProxy>}
   *     A promise that resolved to the application window.
   */
  waitForInitialApplicationWindowLoaded() {
    return new TimedPromise(
      async resolve => {
        const windowReadyTopic = AppInfo.isThunderbird
          ? "mail-delayed-startup-finished"
          : "browser-delayed-startup-finished";

        // This call includes a fallback to "mail3:pane" as well.
        const win = Services.wm.getMostRecentBrowserWindow();

        const windowLoaded = waitForObserverTopic(windowReadyTopic, {
          checkFn: subject => (win !== null ? subject == win : true),
        });

        // The current window has already been finished loading.
        if (win && win.document.readyState == "complete") {
          resolve(win);
          return;
        }

        // Wait for the next browser/mail window to open and finished loading.
        const { subject } = await windowLoaded;
        resolve(subject);
      },
      {
        errorMessage: "No applicable application window found",
      }
    );
  }
}

// Expose a shared singleton.
const windowManager = new WindowManager();
