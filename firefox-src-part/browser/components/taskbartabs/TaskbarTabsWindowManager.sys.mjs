/* vim: se cin sw=2 ts=2 et filetype=javascript :
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const kTaskbarTabsWindowFeatures =
  "titlebar,close,toolbar,location,personalbar=no,status,menubar=no,resizable,minimizable,scrollbars";

let lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  TaskbarTabsUtils: "resource:///modules/taskbartabs/TaskbarTabsUtils.sys.mjs",
});

XPCOMUtils.defineLazyServiceGetters(lazy, {
  WindowsUIUtils: ["@mozilla.org/windows-ui-utils;1", "nsIWindowsUIUtils"],
  WinTaskbar: ["@mozilla.org/windows-taskbar;1", "nsIWinTaskbar"],
});

ChromeUtils.defineLazyGetter(lazy, "logConsole", () => {
  return console.createInstance({
    prefix: "TaskbarTabs",
    maxLogLevel: "Warn",
  });
});

/**
 * Manager for the lifetimes of Taskbar Tab windows.
 */
export class TaskbarTabsWindowManager {
  // Map from the taskbar tab ID to a Set of window IDs. Use #trackWindow
  // and #untrackWindow.
  #openWindows = new Map();
  // Map from the tab browser permanent key to originating window ID.
  #tabOriginMap = new WeakMap();

  /**
   * Moves an existing browser tab into a Taskbar Tab.
   *
   * @param {TaskbarTab} aTaskbarTab - The Taskbar Tab to replace the window with.
   * @param {MozTabbrowserTab} aTab - The tab to adopt as a Taskbar Tab.
   * @returns {Promise<DOMWindow>} The newly created Taskbar Tab window.
   */
  async replaceTabWithWindow(aTaskbarTab, aTab) {
    let originWindow = aTab.ownerGlobal;

    // Save the parent window of this tab, so we can revert back if needed.
    let tabId = getTabId(aTab);
    let windowId = getWindowId(originWindow);

    let extraOptions = Cc["@mozilla.org/hash-property-bag;1"].createInstance(
      Ci.nsIWritablePropertyBag2
    );
    extraOptions.setPropertyAsAString("taskbartab", aTaskbarTab.id);

    let args = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
    args.appendElement(aTab);
    args.appendElement(extraOptions);

    this.#tabOriginMap.set(tabId, windowId);
    return await this.#openWindow(aTaskbarTab, args);
  }

  /**
   * Opens a new Taskbar Tab Window.
   *
   * @param {TaskbarTab} aTaskbarTab - The Taskbar Tab to open.
   * @returns {Promise<DOMWindow>} The newly-created Taskbar Tab window.
   */
  async openWindow(aTaskbarTab) {
    let url = Cc["@mozilla.org/supports-string;1"].createInstance(
      Ci.nsISupportsString
    );
    url.data = aTaskbarTab.startUrl;

    let extraOptions = Cc["@mozilla.org/hash-property-bag;1"].createInstance(
      Ci.nsIWritablePropertyBag2
    );
    extraOptions.setPropertyAsAString("taskbartab", aTaskbarTab.id);

    let userContextId = Cc["@mozilla.org/supports-PRUint32;1"].createInstance(
      Ci.nsISupportsPRUint32
    );
    userContextId.data = aTaskbarTab.userContextId;

    let args = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
    args.appendElement(url);
    args.appendElement(extraOptions);
    args.appendElement(null);
    args.appendElement(null);
    args.appendElement(undefined);
    args.appendElement(userContextId);
    args.appendElement(null);
    args.appendElement(null);
    args.appendElement(Services.scriptSecurityManager.getSystemPrincipal());

    return await this.#openWindow(aTaskbarTab, args);
  }

  /**
   * Handles common window opening behavior for Taskbar Tabs.
   *
   * @param {TaskbarTab} aTaskbarTab - The Taskbar Tab associated to the window.
   * @param {nsIMutableArray} aArgs - `args` to pass to the opening window.
   * @returns {Promise<DOMWindow>} Resolves once window has opened and tab count
   * has been incremented.
   */
  async #openWindow(aTaskbarTab, aArgs) {
    let url = Services.io.newURI(aTaskbarTab.startUrl);
    let imgPromise = lazy.TaskbarTabsUtils.getFavicon(url);

    let win = await lazy.BrowserWindowTracker.promiseOpenWindow({
      args: aArgs,
      features: kTaskbarTabsWindowFeatures,
      all: false,
    });

    imgPromise.then(imgContainer =>
      lazy.WindowsUIUtils.setWindowIcon(win, imgContainer, imgContainer)
    );

    this.#trackWindow(aTaskbarTab.id, win);

    lazy.WinTaskbar.setGroupIdForWindow(win, aTaskbarTab.id);
    win.focus();

    win.gBrowser.tabs.forEach(tab => {
      const browser = win.gBrowser.getBrowserForTab(tab);
      browser.browsingContext.displayMode = "minimal-ui";
    });

    return win;
  }

  /**
   * Adds the window to the set of windows open within the taskbar tab.
   * The window will automatically be removed when the window closes if
   * it hasn't been untracked already.
   *
   * @param {string} aId Taskbar Tab ID that the window should be assigned to.
   * @param {DOMWindow} aWindow Window to track.
   */
  #trackWindow(aId, aWindow) {
    let openWindows = this.#openWindows.get(aId);
    if (typeof openWindows === "undefined") {
      openWindows = new Set();
      this.#openWindows.set(aId, openWindows);
    }

    openWindows.add(getWindowId(aWindow));
    aWindow.addEventListener("unload", _e => this.#untrackWindow(aId, aWindow));
  }

  /**
   * Remove the window from the set of windows open within the taskbar tab.
   * This function is idempotent.
   *
   * @param {string} aId Taskbar Tab ID that the window should be assigned to.
   * @param {DOMWindow} aWindow Window to track.
   */
  #untrackWindow(aId, aWindow) {
    let openWindows = this.#openWindows.get(aId);
    if (typeof openWindows === "undefined") {
      // If it is undefined, the window wasn't being tracked anyways.
      return;
    }

    openWindows.delete(getWindowId(aWindow));
    if (openWindows.size === 0) {
      // Avoid leaking entries in the map.
      this.#openWindows.delete(aId);
    }
  }

  /**
   * Reverts a web app to a tab in a regular Firefox window. We will try to use
   * the window the taskbar tab originated from, if that's not avaliable, we
   * will use the most recently active window. If no window is avalaible, a new
   * one will be opened.
   *
   * @param {DOMWindow} aWindow - A Taskbar Tab window.
   */
  async ejectWindow(aWindow) {
    lazy.logConsole.info("Ejecting window from Taskbar Tabs.");

    let taskbarTabId = lazy.TaskbarTabsUtils.getTaskbarTabIdFromWindow(aWindow);
    if (!taskbarTabId) {
      throw new Error("No Taskbar Tab ID found on window.");
    } else {
      lazy.logConsole.debug(`Taskbar Tab ID is ${taskbarTabId}`);
    }

    let windowList = lazy.BrowserWindowTracker.getOrderedWindows({
      private: false,
    });

    // A Taskbar Tab should only contain one tab, but iterate over the browser's
    // tabs just in case one snuck in.
    for (const tab of aWindow.gBrowser.tabs) {
      let tabId = getTabId(tab);
      let originWindowId = this.#tabOriginMap.get(tabId);

      let win =
        // Find the originating window for the Taskbar Tab if it still exists.
        windowList.find(window => {
          let windowId = getWindowId(window);
          let matching = windowId === originWindowId;
          if (matching) {
            lazy.logConsole.debug(
              `Ejecting into originating window: ${windowId}`
            );
          }
          return matching;
        });

      if (!win) {
        // Otherwise the most recent non-Taskbar Tabs window interacted with.
        win = lazy.BrowserWindowTracker.getTopWindow({
          private: false,
        });

        if (win) {
          lazy.logConsole.debug(`Ejecting into top window.`);
        }
      }

      let newTab;
      if (win) {
        // Set this tab to the last tab position of the window.
        newTab = win.gBrowser.adoptTab(tab, {
          tabIndex: win.gBrowser.openTabs.length,
          selectTab: true,
        });
      } else {
        lazy.logConsole.debug(
          "No originating or existing browser window found, ejecting into newly created window."
        );
        win = await lazy.BrowserWindowTracker.promiseOpenWindow({ args: tab });
        newTab = win.gBrowser.tabs[0];
      }

      win.focus();

      let browser = win.gBrowser.getBrowserForTab(newTab);
      browser.browsingContext.displayMode = "browser";

      this.#tabOriginMap.delete(tabId);
    }

    this.#untrackWindow(taskbarTabId, aWindow);
  }

  /**
   * Returns a count of the current windows associated to a Taskbar Tab.
   *
   * @param {string} aId - The Taskbar Tab ID.
   * @returns {integer} Count of windows associated to the Taskbar Tab ID.
   */
  getCountForId(aId) {
    return this.#openWindows.get(aId)?.size ?? 0;
  }

  /**
   * Utility function to mock `nsIWindowsUIUtils`.
   *
   * @param {nsIWindowsUIUtils} mock - A mock of nsIWindowsUIUtils.
   */
  testOnlyMockUIUtils(mock) {
    if (!Cu.isInAutomation) {
      throw new Error("Can only mock utils in automation.");
    }
    // eslint-disable-next-line mozilla/valid-lazy
    Object.defineProperty(lazy, "WindowsUIUtils", {
      get() {
        if (mock) {
          return mock;
        }
        return Cc["@mozilla.org/windows-ui-utils;1"].getService(
          Ci.nsIWindowsUIUtils
        );
      },
    });
  }
}

/**
 * Retrieves the browser tab's ID.
 *
 * @param {MozTabbrowserTab} aTab - Tab to retrieve the ID from.
 * @returns {object} The permanent key identifying the tab.
 */
function getTabId(aTab) {
  return aTab.permanentKey;
}

/**
 * Retrieves the window ID.
 *
 * @param {DOMWindow} aWindow
 * @returns {string} A unique string identifying the window.
 */
function getWindowId(aWindow) {
  return aWindow.docShell.outerWindowID;
}
