/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["TabEngine", "TabSetRecord"];

const TABS_TTL = 31622400; // 366 days (1 leap year).
const TAB_ENTRIES_LIMIT = 5; // How many URLs to include in tab history.

const { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);
const { TabStateFlusher } = ChromeUtils.import(
  "resource:///modules/sessionstore/TabStateFlusher.jsm"
);
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { Log } = ChromeUtils.import("resource://gre/modules/Log.jsm");
const { Store, SyncEngine, Tracker } = ChromeUtils.import(
  "resource://services-sync/engines.js"
);
const { CryptoWrapper } = ChromeUtils.import(
  "resource://services-sync/record.js"
);
const { Svc, Utils } = ChromeUtils.import("resource://services-sync/util.js");
const {
  LOGIN_SUCCEEDED,
  SCORE_INCREMENT_SMALL,
  STATUS_OK,
  URI_LENGTH_MAX,
} = ChromeUtils.import("resource://services-sync/constants.js");
const { CommonUtils } = ChromeUtils.import(
  "resource://services-common/utils.js"
);
const { Async } = ChromeUtils.import("resource://services-common/async.js");

const { SyncRecord, SyncTelemetry } = ChromeUtils.import(
  "resource://services-sync/telemetry.js"
);

const FAR_FUTURE = 4102405200000; // 2100/01/01

ChromeUtils.defineModuleGetter(
  this,
  "PrivateBrowsingUtils",
  "resource://gre/modules/PrivateBrowsingUtils.jsm"
);
ChromeUtils.defineModuleGetter(
  this,
  "SessionStore",
  "resource:///modules/sessionstore/SessionStore.jsm"
);

XPCOMUtils.defineLazyModuleGetters(this, {
  PlacesUtils: "resource://gre/modules/PlacesUtils.jsm",
});

ChromeUtils.defineModuleGetter(
  this,
  "ExperimentAPI",
  "resource://nimbus/ExperimentAPI.jsm"
);

XPCOMUtils.defineLazyModuleGetters(this, {
  NimbusFeatures: "resource://nimbus/ExperimentAPI.jsm",
});

XPCOMUtils.defineLazyPreferenceGetter(
  this,
  "TABS_FILTERED_SCHEMES",
  "services.sync.engine.tabs.filteredSchemes",
  "",
  null,
  val => {
    return new Set(val.split("|"));
  }
);

function TabSetRecord(collection, id) {
  CryptoWrapper.call(this, collection, id);
}
TabSetRecord.prototype = {
  __proto__: CryptoWrapper.prototype,
  _logName: "Sync.Record.Tabs",
  ttl: TABS_TTL,
};

Utils.deferGetSet(TabSetRecord, "cleartext", ["clientName", "tabs"]);

function TabEngine(service) {
  SyncEngine.call(this, "Tabs", service);
}
TabEngine.prototype = {
  __proto__: SyncEngine.prototype,
  _storeObj: TabStore,
  _trackerObj: TabTracker,
  _recordObj: TabSetRecord,

  syncPriority: 3,

  async initialize() {
    await SyncEngine.prototype.initialize.call(this);

    // Reset the client on every startup so that we fetch recent tabs.
    await this._resetClient();
  },

  async getChangedIDs() {
    // No need for a proper timestamp (no conflict resolution needed).
    let changedIDs = {};
    if (this._tracker.modified) {
      changedIDs[this.service.clientsEngine.localID] = 0;
    }
    return changedIDs;
  },

  // API for use by Sync UI code to give user choices of tabs to open.
  getAllClients() {
    return this._store._remoteClients;
  },

  getClientById(id) {
    return this._store._remoteClients[id];
  },

  async _resetClient() {
    await SyncEngine.prototype._resetClient.call(this);
    await this._store.wipe();
    this._tracker.modified = true;
  },

  async removeClientData() {
    let url = this.engineURL + "/" + this.service.clientsEngine.localID;
    await this.service.resource(url).delete();
  },

  async _reconcile(item) {
    // Skip our own record.
    // TabStore.itemExists tests only against our local client ID.
    if (await this._store.itemExists(item.id)) {
      this._log.trace(
        "Ignoring incoming tab item because of its id: " + item.id
      );
      return false;
    }

    return SyncEngine.prototype._reconcile.call(this, item);
  },

  async trackRemainingChanges() {
    if (this._modified.count() > 0) {
      this._tracker.modified = true;
    }
  },

  async _onRecordsWritten(succeeded, failed, serverModifiedTime) {
    await super._onRecordsWritten(succeeded, failed, serverModifiedTime);
    if (failed.length) {
      // This should be impossible, so make a note. Maybe upgrade to `.error`?
      this._log.warn("the server rejected our tabs record");
    }
  },

  // Support for "quick writes"
  _engineLock: Utils.lock,
  _engineLocked: false,

  // Tabs has a special lock to help support its "quick write"
  get locked() {
    return this._engineLocked;
  },
  lock() {
    if (this._engineLocked) {
      return false;
    }
    this._engineLocked = true;
    return true;
  },
  unlock() {
    this._engineLocked = false;
  },

  // Quickly do a POST of our current tabs if possible.
  // This does things that would be dangerous for other engines - eg, posting
  // without checking what's on the server could cause data-loss for other
  // engines, but because each device exclusively owns exactly 1 tabs record
  // with a known ID, it's safe here.
  async quickWrite() {
    if (!this.enabled) {
      // this should be very rare, and only if tabs are disabled after the
      // timer is created.
      this._log.info("Can't do a quick-sync as tabs is disabled");
      return;
    }
    // This quick-sync doesn't drive the login state correctly, so just
    // decline to sync if out status is bad
    if (this.service.status.checkSetup() != STATUS_OK) {
      this._log.info(
        "Can't do a quick-sync due to the service status",
        this.service.status.toString()
      );
      return;
    }
    if (!this.service.serverConfiguration) {
      this._log.info("Can't do a quick sync before the first full sync");
      return;
    }
    try {
      await this._engineLock("tabs.js: quickWrite", async () => {
        // We want to restore the lastSync timestamp when complete so next sync
        // takes tabs written by other devices since our last real sync.
        // And for this POST we don't want the protections offered by
        // X-If-Unmodified-Since - we want the POST to work even if the remote
        // has moved on and we will catch back up next full sync.
        const origLastSync = await this.getLastSync();
        await this.setLastSync(FAR_FUTURE);
        try {
          await this._doQuickWrite();
        } finally {
          await this.setLastSync(origLastSync);
        }
      })();
    } catch (ex) {
      if (!Utils.isLockException(ex)) {
        throw ex;
      }
      this._log.info(
        "Can't do a quick-write as another tab sync is in progress"
      );
    }
  },

  // The guts of the quick-write sync, after we've taken the lock, checked
  // the service status etc.
  async _doQuickWrite() {
    // We need to track telemetry for these syncs too!
    const name = "tabs";
    let telemetryRecord = new SyncRecord(
      SyncTelemetry.allowedEngines,
      "quick-write"
    );
    telemetryRecord.onEngineStart(name);
    try {
      Async.checkAppReady();
      // tracking the modified items is normally done by _syncStartup(),
      // but we don't call that so we don't do the meta/global dances -
      // these dances would be very important for any other engine, but
      // we can avoid it for tabs because of the lack of reconcilliation.
      this._modified.replace(await this.pullChanges());
      this._tracker.clearChangedIDs();
      this._tracker.resetScore();

      // now just the "upload" part of a sync.
      Async.checkAppReady();
      await this._uploadOutgoing();
      telemetryRecord.onEngineApplied(name, 1);
      telemetryRecord.onEngineStop(name, null);
    } catch (ex) {
      telemetryRecord.onEngineStop(name, ex);
    } finally {
      // The top-level sync is never considered to fail here, just the engine
      telemetryRecord.finished(null);
      SyncTelemetry.takeTelemetryRecord(telemetryRecord);
    }
  },

  async _sync() {
    try {
      await this._engineLock("tabs.js: fullSync", async () => {
        await super._sync();
      })();
    } catch (ex) {
      if (!Utils.isLockException(ex)) {
        throw ex;
      }
      this._log.info(
        "Can't do full tabs sync as a quick-write is currently running"
      );
    }
  },
};

function TabStore(name, engine) {
  Store.call(this, name, engine);
}
TabStore.prototype = {
  __proto__: Store.prototype,

  async itemExists(id) {
    return id == this.engine.service.clientsEngine.localID;
  },

  getWindowEnumerator() {
    return Services.wm.getEnumerator("navigator:browser");
  },

  shouldSkipWindow(win) {
    return win.closed || PrivateBrowsingUtils.isWindowPrivate(win);
  },

  getTabState(tab) {
    return JSON.parse(SessionStore.getTabState(tab));
  },

  async getAllTabs(filter) {
    let allTabs = [];

    for (let win of this.getWindowEnumerator()) {
      if (this.shouldSkipWindow(win)) {
        continue;
      }

      for (let tab of win.gBrowser.tabs) {
        let tabState = this.getTabState(tab);

        // Make sure there are history entries to look at.
        if (!tabState || !tabState.entries.length) {
          // If we detected a tab but no entries we should
          // flush the window so SessionState properly updates
          await TabStateFlusher.flushWindow(win);
          tabState = this.getTabState(tab);

          // We failed to get entries even after a flush
          // safe to skip this tab
          if (!tabState || !tabState.entries.length) {
            continue;
          }
        }

        let acceptable = !filter
          ? url => url
          : url =>
              url && !TABS_FILTERED_SCHEMES.has(Services.io.extractScheme(url));

        let entries = tabState.entries;
        let index = tabState.index;
        let current = entries[index - 1];

        // We ignore the tab completely if the current entry url is
        // not acceptable (we need something accurate to open).
        if (!acceptable(current.url)) {
          continue;
        }

        if (current.url.length > URI_LENGTH_MAX) {
          this._log.trace("Skipping over-long URL.");
          continue;
        }

        // The element at `index` is the current page. Previous URLs were
        // previously visited URLs; subsequent URLs are in the 'forward' stack,
        // which we can't represent in Sync, so we truncate here.
        let candidates =
          entries.length == index ? entries : entries.slice(0, index);

        let urls = candidates
          .map(entry => entry.url)
          .filter(acceptable)
          .reverse(); // Because Sync puts current at index 0, and history after.

        // Truncate if necessary.
        if (urls.length > TAB_ENTRIES_LIMIT) {
          urls.length = TAB_ENTRIES_LIMIT;
        }

        // tabState has .image, but it's a large data: url. So we ask the favicon service for the url.
        let icon = "";
        try {
          let iconData = await PlacesUtils.promiseFaviconData(urls[0]);
          icon = iconData.uri.spec;
        } catch (ex) {
          this._log.trace(`Failed to fetch favicon for ${urls[0]}`, ex);
        }
        allTabs.push({
          title: current.title || "",
          urlHistory: urls,
          icon,
          lastUsed: Math.floor((tabState.lastAccessed || 0) / 1000),
        });
      }
    }

    return allTabs;
  },

  async createRecord(id, collection) {
    let record = new TabSetRecord(collection, id);
    record.clientName = this.engine.service.clientsEngine.localName;

    // Sort tabs in descending-used order to grab the most recently used
    let tabs = (await this.getAllTabs(true)).sort(function(a, b) {
      return b.lastUsed - a.lastUsed;
    });
    const maxPayloadSize = this.engine.service.getMemcacheMaxRecordPayloadSize();
    let records = Utils.tryFitItems(tabs, maxPayloadSize);

    if (records.length != tabs.length) {
      this._log.warn(
        `Can't fit all tabs in sync payload: have ${tabs.length}, but can only fit ${records.length}.`
      );
    }

    if (this._log.level <= Log.Level.Trace) {
      records.forEach(tab => {
        this._log.trace("Wrapping tab: ", tab);
      });
    }

    record.tabs = records;
    return record;
  },

  async getAllIDs() {
    // Don't report any tabs if all windows are in private browsing for
    // first syncs.
    let ids = {};
    let allWindowsArePrivate = false;
    for (let win of Services.wm.getEnumerator("navigator:browser")) {
      if (PrivateBrowsingUtils.isWindowPrivate(win)) {
        // Ensure that at least there is a private window.
        allWindowsArePrivate = true;
      } else {
        // If there is a not private windown then finish and continue.
        allWindowsArePrivate = false;
        break;
      }
    }

    if (
      allWindowsArePrivate &&
      !PrivateBrowsingUtils.permanentPrivateBrowsing
    ) {
      return ids;
    }

    ids[this.engine.service.clientsEngine.localID] = true;
    return ids;
  },

  async wipe() {
    this._remoteClients = {};
  },

  async create(record) {
    this._log.debug("Adding remote tabs from " + record.id);
    this._remoteClients[record.id] = Object.assign({}, record.cleartext, {
      lastModified: record.modified,
    });
  },

  async update(record) {
    this._log.trace("Ignoring tab updates as local ones win");
  },
};

function TabTracker(name, engine) {
  Tracker.call(this, name, engine);

  // Make sure "this" pointer is always set correctly for event listeners.
  this.onTab = Utils.bind2(this, this.onTab);
  this._unregisterListeners = Utils.bind2(this, this._unregisterListeners);
}
TabTracker.prototype = {
  __proto__: Tracker.prototype,

  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),

  clearChangedIDs() {
    this.modified = false;
  },

  _topics: ["TabOpen", "TabClose", "TabSelect"],

  _registerListenersForWindow(window) {
    this._log.trace("Registering tab listeners in window");
    for (let topic of this._topics) {
      window.addEventListener(topic, this.onTab);
    }
    window.addEventListener("unload", this._unregisterListeners);
    // If it's got a tab browser we can listen for things like navigation.
    if (window.gBrowser) {
      window.gBrowser.addProgressListener(this);
    }
  },

  _unregisterListeners(event) {
    this._unregisterListenersForWindow(event.target);
  },

  _unregisterListenersForWindow(window) {
    this._log.trace("Removing tab listeners in window");
    window.removeEventListener("unload", this._unregisterListeners);
    for (let topic of this._topics) {
      window.removeEventListener(topic, this.onTab);
    }
    if (window.gBrowser) {
      window.gBrowser.removeProgressListener(this);
    }
  },

  onStart() {
    Svc.Obs.add("domwindowopened", this.asyncObserver);
    for (let win of Services.wm.getEnumerator("navigator:browser")) {
      this._registerListenersForWindow(win);
    }
  },

  onStop() {
    Svc.Obs.remove("domwindowopened", this.asyncObserver);
    for (let win of Services.wm.getEnumerator("navigator:browser")) {
      this._unregisterListenersForWindow(win);
    }
  },

  async observe(subject, topic, data) {
    switch (topic) {
      case "domwindowopened":
        let onLoad = () => {
          subject.removeEventListener("load", onLoad);
          // Only register after the window is done loading to avoid unloads.
          this._registerListenersForWindow(subject);
        };

        // Add tab listeners now that a window has opened.
        subject.addEventListener("load", onLoad);
        break;
    }
  },

  onTab(event) {
    if (event.originalTarget.linkedBrowser) {
      let browser = event.originalTarget.linkedBrowser;
      if (
        PrivateBrowsingUtils.isBrowserPrivate(browser) &&
        !PrivateBrowsingUtils.permanentPrivateBrowsing
      ) {
        this._log.trace("Ignoring tab event from private browsing.");
        return;
      }
    }

    this._log.trace("onTab event: " + event.type);
    this.callScheduleSync(SCORE_INCREMENT_SMALL);
  },

  // web progress listeners.
  onLocationChange(webProgress, request, locationURI, flags) {
    // We only care about top-level location changes which are not in the same
    // document.
    if (
      flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT ||
      !webProgress.isTopLevel ||
      !locationURI
    ) {
      return;
    }

    // Synced tabs do not sync certain urls, we should ignore scheduling a sync
    // if we have navigate to one of those urls
    if (TABS_FILTERED_SCHEMES.has(locationURI.scheme)) {
      return;
    }

    this.callScheduleSync();
  },

  callScheduleSync(scoreIncrement) {
    this.modified = true;

    let { scheduler } = this.engine.service;
    const delayInMs = NimbusFeatures.syncAfterTabChange.getVariable(
      "syncDelayAfterTabChange"
    );

    // If we are part of the experiment don't use score here
    // and instead schedule a sync once we detect a tab change
    // to ensure the server always has the most up to date tabs
    if (
      delayInMs > 0 &&
      scheduler.numClients > 1 // Don't constantly schedule syncs for single client users
    ) {
      if (this.tabsQuickWriteTimer) {
        this._log.debug(
          "Detected a tab change, but a quick-write is already scheduled"
        );
        return;
      }
      this._log.debug(
        "Detected a tab change: scheduling a quick-write in " + delayInMs + "ms"
      );
      CommonUtils.namedTimer(
        () => {
          this._log.trace("tab quick-sync timer fired.");
          this.engine
            .quickWrite()
            .then(() => {
              this._log.trace("tab quick-sync done.");
            })
            .catch(ex => {
              this._log.error("tab quick-sync failed.", ex);
            });
        },
        delayInMs,
        this,
        "tabsQuickWriteTimer"
      );
    } else if (scoreIncrement) {
      this.score += scoreIncrement;
    }
  },
};
