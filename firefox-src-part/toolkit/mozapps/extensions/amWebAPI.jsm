/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);
ChromeUtils.defineModuleGetter(
  this,
  "Services",
  "resource://gre/modules/Services.jsm"
);

XPCOMUtils.defineLazyPreferenceGetter(
  this,
  "AMO_ABUSEREPORT",
  "extensions.abuseReport.amWebAPI.enabled",
  false
);

const MSG_PROMISE_REQUEST = "WebAPIPromiseRequest";
const MSG_PROMISE_RESULT = "WebAPIPromiseResult";
const MSG_INSTALL_EVENT = "WebAPIInstallEvent";
const MSG_INSTALL_CLEANUP = "WebAPICleanup";
const MSG_ADDON_EVENT_REQ = "WebAPIAddonEventRequest";
const MSG_ADDON_EVENT = "WebAPIAddonEvent";

class APIBroker {
  constructor(mm) {
    this.mm = mm;

    this._promises = new Map();

    // _installMap maps integer ids to DOM AddonInstall instances
    this._installMap = new Map();

    this.mm.addMessageListener(MSG_PROMISE_RESULT, this);
    this.mm.addMessageListener(MSG_INSTALL_EVENT, this);

    this._eventListener = null;
  }

  receiveMessage(message) {
    let payload = message.data;

    switch (message.name) {
      case MSG_PROMISE_RESULT: {
        if (!this._promises.has(payload.callbackID)) {
          return;
        }

        let resolve = this._promises.get(payload.callbackID);
        this._promises.delete(payload.callbackID);
        resolve(payload);
        break;
      }

      case MSG_INSTALL_EVENT: {
        let install = this._installMap.get(payload.id);
        if (!install) {
          let err = new Error(
            `Got install event for unknown install ${payload.id}`
          );
          Cu.reportError(err);
          return;
        }
        install._dispatch(payload);
        break;
      }

      case MSG_ADDON_EVENT: {
        if (this._eventListener) {
          this._eventListener(payload);
        }
      }
    }
  }

  sendRequest(type, ...args) {
    return new Promise(resolve => {
      let callbackID = APIBroker._nextID++;

      this._promises.set(callbackID, resolve);
      this.mm.sendAsyncMessage(MSG_PROMISE_REQUEST, { type, callbackID, args });
    });
  }

  setAddonListener(callback) {
    this._eventListener = callback;
    if (callback) {
      this.mm.addMessageListener(MSG_ADDON_EVENT, this);
      this.mm.sendAsyncMessage(MSG_ADDON_EVENT_REQ, { enabled: true });
    } else {
      this.mm.removeMessageListener(MSG_ADDON_EVENT, this);
      this.mm.sendAsyncMessage(MSG_ADDON_EVENT_REQ, { enabled: false });
    }
  }

  sendCleanup(ids) {
    this.setAddonListener(null);
    this.mm.sendAsyncMessage(MSG_INSTALL_CLEANUP, { ids });
  }
}

APIBroker._nextID = 0;

// Base class for building classes to back content-exposed interfaces.
class APIObject {
  init(window, broker, properties) {
    this.window = window;
    this.broker = broker;

    // Copy any provided properties onto this object, webidl bindings
    // will only expose to content what should be exposed.
    for (let key of Object.keys(properties)) {
      this[key] = properties[key];
    }
  }

  /**
   * Helper to implement an asychronous method visible to content, where
   * the method is implemented by sending a message to the parent process
   * and then wrapping the returned object or error in an appropriate object.
   * This helper method ensures that:
   *  - Returned Promise objects are from the content window
   *  - Rejected Promises have Error objects from the content window
   *  - Only non-internal errors are exposed to the caller
   *
   * @param {string} apiRequest The command to invoke in the parent process.
   * @param {array<cloneable>} apiArgs The arguments to include with the
   *                                   request to the parent process.
   * @param {function} resultConvert If provided, a function called with the
   *                                 result from the parent process as an
   *                                 argument.  Used to convert the result
   *                                 into something appropriate for content.
   * @returns {Promise<any>} A Promise suitable for passing directly to content.
   */
  _apiTask(apiRequest, apiArgs, resultConverter) {
    let win = this.window;
    let broker = this.broker;
    return new win.Promise((resolve, reject) => {
      (async function() {
        let result = await broker.sendRequest(apiRequest, ...apiArgs);
        if ("reject" in result) {
          let err = new win.Error(result.reject.message);
          // We don't currently put any other properties onto Errors
          // generated by mozAddonManager.  If/when we do, they will
          // need to get copied here.
          reject(err);
          return;
        }

        let obj = result.resolve;
        if (resultConverter) {
          obj = resultConverter(obj);
        }
        resolve(obj);
      })().catch(err => {
        Cu.reportError(err);
        reject(new win.Error("Unexpected internal error"));
      });
    });
  }
}

class Addon extends APIObject {
  constructor(...args) {
    super();
    this.init(...args);
  }

  uninstall() {
    return this._apiTask("addonUninstall", [this.id]);
  }

  setEnabled(value) {
    return this._apiTask("addonSetEnabled", [this.id, value]);
  }
}

class AddonInstall extends APIObject {
  constructor(window, broker, properties) {
    super();
    this.init(window, broker, properties);

    broker._installMap.set(properties.id, this);
  }

  _dispatch(data) {
    // The message for the event includes updated copies of all install
    // properties.  Use the usual "let webidl filter visible properties" trick.
    for (let key of Object.keys(data)) {
      this[key] = data[key];
    }

    let event = new this.window.Event(data.event);
    this.__DOM_IMPL__.dispatchEvent(event);
  }

  install() {
    return this._apiTask("addonInstallDoInstall", [this.id]);
  }

  cancel() {
    return this._apiTask("addonInstallCancel", [this.id]);
  }
}

class WebAPI extends APIObject {
  constructor() {
    super();
    this.allInstalls = [];
    this.listenerCount = 0;
  }

  init(window) {
    let mm = window.docShell.messageManager;
    let broker = new APIBroker(mm);

    super.init(window, broker, {});

    window.addEventListener("unload", event => {
      this.broker.sendCleanup(this.allInstalls);
    });
  }

  getAddonByID(id) {
    return this._apiTask("getAddonByID", [id], addonInfo => {
      if (!addonInfo) {
        return null;
      }
      let addon = new Addon(this.window, this.broker, addonInfo);
      return this.window.Addon._create(this.window, addon);
    });
  }

  createInstall(options) {
    if (!Services.prefs.getBoolPref("xpinstall.enabled", true)) {
      throw new this.window.Error("Software installation is disabled.");
    }

    const triggeringPrincipal = this.window.document.nodePrincipal;

    let installOptions = {
      ...options,
      triggeringPrincipal,
      // Provide the host from which the amWebAPI is being called
      // (so that we can detect if the API is being used from the disco pane,
      // AMO, testpilot or another unknown webpage).
      sourceHost: this.window.location?.host,
      sourceURL: this.window.location?.href,
    };
    return this._apiTask("createInstall", [installOptions], installInfo => {
      if (!installInfo) {
        return null;
      }
      let install = new AddonInstall(this.window, this.broker, installInfo);
      this.allInstalls.push(installInfo.id);
      return this.window.AddonInstall._create(this.window, install);
    });
  }

  reportAbuse(id) {
    return this._apiTask("addonReportAbuse", [id]);
  }

  get abuseReportPanelEnabled() {
    return AMO_ABUSEREPORT;
  }

  eventListenerAdded(type) {
    if (this.listenerCount == 0) {
      this.broker.setAddonListener(data => {
        let event = new this.window.AddonEvent(data.event, data);
        this.__DOM_IMPL__.dispatchEvent(event);
      });
    }
    this.listenerCount++;
  }

  eventListenerRemoved(type) {
    this.listenerCount--;
    if (this.listenerCount == 0) {
      this.broker.setAddonListener(null);
    }
  }
}
WebAPI.prototype.QueryInterface = ChromeUtils.generateQI([
  "nsIDOMGlobalPropertyInitializer",
]);
WebAPI.prototype.classID = Components.ID(
  "{8866d8e3-4ea5-48b7-a891-13ba0ac15235}"
);
var EXPORTED_SYMBOLS = ["WebAPI"];
