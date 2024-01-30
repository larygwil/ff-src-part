/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = ["browsingContext"];

const { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);

XPCOMUtils.defineLazyModuleGetters(this, {
  LoadListener: "chrome://remote/content/shared/listeners/LoadListener.jsm",
  Module: "chrome://remote/content/shared/messagehandler/Module.jsm",
});

class BrowsingContextModule extends Module {
  #loadListener;

  constructor(messageHandler) {
    super(messageHandler);

    // Setup the LoadListener as early as possible.
    this.#loadListener = new LoadListener(this.messageHandler.window);
    this.#loadListener.on("DOMContentLoaded", this.#onDOMContentLoaded);
  }

  destroy() {
    this.#loadListener.destroy();
  }

  #subscribeEvent(event) {
    if (event === "browsingContext.DOMContentLoaded") {
      this.#loadListener.startListening();
    }
  }

  #unsubscribeEvent(event) {
    if (event === "browsingContext.DOMContentLoaded") {
      this.#loadListener.stopListening();
    }
  }

  #onDOMContentLoaded = (eventName, data) => {
    this.messageHandler.emitEvent("browsingContext.DOMContentLoaded", {
      baseURL: data.target.baseURI,
      contextId: this.messageHandler.contextId,
      documentURL: data.target.URL,
      innerWindowId: this.messageHandler.innerWindowId,
      readyState: data.target.readyState,
    });
  };

  /**
   * Internal commands
   */

  _applySessionData(params) {
    // TODO: Bug 1741861. Move this logic to a shared module or the an abstract
    // class.
    const { category, added = [], removed = [] } = params;
    if (category === "internal-event") {
      for (const event of added) {
        this.#subscribeEvent(event);
      }
      for (const event of removed) {
        this.#unsubscribeEvent(event);
      }
    }
  }

  _getBaseURL() {
    return this.messageHandler.window.document.baseURI;
  }
}

const browsingContext = BrowsingContextModule;
