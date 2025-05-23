/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SyncedTabsDeckStore } from "resource:///modules/syncedtabs/SyncedTabsDeckStore.sys.mjs";
import { SyncedTabsDeckView } from "resource:///modules/syncedtabs/SyncedTabsDeckView.sys.mjs";
import { SyncedTabsListStore } from "resource:///modules/syncedtabs/SyncedTabsListStore.sys.mjs";
import { TabListComponent } from "resource:///modules/syncedtabs/TabListComponent.sys.mjs";
import { TabListView } from "resource:///modules/syncedtabs/TabListView.sys.mjs";
import { getChromeWindow } from "resource:///modules/syncedtabs/util.sys.mjs";
import { UIState } from "resource://services-sync/UIState.sys.mjs";

/* SyncedTabsDeckComponent
 * This component instantiates views and storage objects as well as defines
 * behaviors that will be passed down to the views. This helps keep the views
 * isolated and easier to test.
 */

export function SyncedTabsDeckComponent({
  window,
  SyncedTabs,
  deckStore,
  listStore,
  listComponent,
  DeckView,
  getChromeWindowMock,
}) {
  this._window = window;
  this._SyncedTabs = SyncedTabs;
  this._DeckView = DeckView || SyncedTabsDeckView;
  // used to stub during tests
  this._getChromeWindow = getChromeWindowMock || getChromeWindow;

  this._deckStore = deckStore || new SyncedTabsDeckStore();
  this._syncedTabsListStore = listStore || new SyncedTabsListStore(SyncedTabs);
  this.tabListComponent =
    listComponent ||
    new TabListComponent({
      window: this._window,
      store: this._syncedTabsListStore,
      View: TabListView,
      SyncedTabs,
      clipboardHelper: Cc["@mozilla.org/widget/clipboardhelper;1"].getService(
        Ci.nsIClipboardHelper
      ),
      getChromeWindow: this._getChromeWindow,
    });
}

SyncedTabsDeckComponent.prototype = {
  PANELS: {
    TABS_CONTAINER: "tabs-container",
    TABS_FETCHING: "tabs-fetching",
    LOGIN_FAILED: "reauth",
    NOT_AUTHED_INFO: "notAuthedInfo",
    SYNC_DISABLED: "syncDisabled",
    SINGLE_DEVICE_INFO: "singleDeviceInfo",
    TABS_DISABLED: "tabs-disabled",
    UNVERIFIED: "unverified",
  },

  get container() {
    return this._deckView ? this._deckView.container : null;
  },

  init() {
    Services.obs.addObserver(this, this._SyncedTabs.TOPIC_TABS_CHANGED);
    Services.obs.addObserver(this, UIState.ON_UPDATE);

    // Add app locale change support for HTML sidebar
    Services.obs.addObserver(this, "intl:app-locales-changed");
    this.updateDir();

    // Go ahead and trigger sync
    this._SyncedTabs.syncTabs().catch(console.error);

    this._deckView = new this._DeckView(this._window, this.tabListComponent, {
      onConnectDeviceClick: event => this.openConnectDevice(event),
      onSyncPrefClick: event => this.openSyncPrefs(event),
    });

    this._deckStore.on("change", state => this._deckView.render(state));
    // Trigger the initial rendering of the deck view
    // Object.values only in nightly
    this._deckStore.setPanels(
      Object.keys(this.PANELS).map(k => this.PANELS[k])
    );
    // Set the initial panel to display
    this.updatePanel();
    this._recordPanelToggle(true);
  },

  uninit() {
    Services.obs.removeObserver(this, this._SyncedTabs.TOPIC_TABS_CHANGED);
    Services.obs.removeObserver(this, UIState.ON_UPDATE);
    Services.obs.removeObserver(this, "intl:app-locales-changed");
    this._deckView.destroy();
    this._recordPanelToggle(false);
  },

  async _recordPanelToggle(opened) {
    const state = UIState.get();
    const { status } = state;
    Glean.syncedTabs.sidebarToggle.record({
      opened,
      synced_tabs_loaded: status === UIState.STATUS_SIGNED_IN,
      version: "old",
    });
  },

  observe(subject, topic) {
    switch (topic) {
      case this._SyncedTabs.TOPIC_TABS_CHANGED:
        this._syncedTabsListStore.getData();
        this.updatePanel();
        break;
      case UIState.ON_UPDATE:
        this.updatePanel();
        break;
      case "intl:app-locales-changed":
        this.updateDir();
        break;
      default:
        break;
    }
  },

  async getPanelStatus() {
    try {
      const state = UIState.get();
      const { status } = state;
      if (status == UIState.STATUS_NOT_CONFIGURED) {
        return this.PANELS.NOT_AUTHED_INFO;
      } else if (status == UIState.STATUS_LOGIN_FAILED) {
        return this.PANELS.LOGIN_FAILED;
      } else if (status == UIState.STATUS_NOT_VERIFIED) {
        return this.PANELS.UNVERIFIED;
      } else if (!state.syncEnabled) {
        return this.PANELS.SYNC_DISABLED;
      } else if (!this._SyncedTabs.isConfiguredToSyncTabs) {
        return this.PANELS.TABS_DISABLED;
      } else if (!this._SyncedTabs.hasSyncedThisSession) {
        return this.PANELS.TABS_FETCHING;
      }
      const clients = await this._SyncedTabs.getTabClients();
      if (clients.length) {
        return this.PANELS.TABS_CONTAINER;
      }
      return this.PANELS.SINGLE_DEVICE_INFO;
    } catch (err) {
      console.error(err);
      return this.PANELS.NOT_AUTHED_INFO;
    }
  },

  updateDir() {
    // If the HTML document doesn't exist, we can't update the window
    if (!this._window.document) {
      return;
    }

    if (Services.locale.isAppLocaleRTL) {
      this._window.document.body.dir = "rtl";
    } else {
      this._window.document.body.dir = "ltr";
    }
  },

  updatePanel() {
    // return promise for tests
    return this.getPanelStatus()
      .then(panelId => this._deckStore.selectPanel(panelId))
      .catch(console.error);
  },

  openSyncPrefs() {
    this._getChromeWindow(this._window).gSync.openPrefs("tabs-sidebar");
  },

  openConnectDevice() {
    this._getChromeWindow(this._window).gSync.openConnectAnotherDevice(
      "tabs-sidebar"
    );
  },
};
