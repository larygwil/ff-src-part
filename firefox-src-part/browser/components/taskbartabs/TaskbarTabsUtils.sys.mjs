/* vim: se cin sw=2 ts=2 et filetype=javascript :
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

let lazy = {};

XPCOMUtils.defineLazyServiceGetters(lazy, {
  Favicons: ["@mozilla.org/browser/favicon-service;1", "nsIFaviconService"],
});

ChromeUtils.defineLazyGetter(lazy, "logConsole", () => {
  return console.createInstance({
    prefix: "TaskbarTabs",
    maxLogLevel: "Warn",
  });
});

export const TaskbarTabsUtils = {
  /**
   * Checks if Taskbar Tabs has been enabled.
   *
   * @returns {bool} `true` if the Taskbar Tabs pref is enabled.
   */
  isEnabled() {
    const pref = "browser.taskbarTabs.enabled";
    return Services.prefs.getBoolPref(pref, false);
  },

  /**
   * Returns a folder to store profile-specific Taskbar Tabs files.
   *
   * @returns {nsIFile} Folder to store Taskbar Tabs files.
   */
  getTaskbarTabsFolder() {
    // Construct the path `[Profile]/taskbartabs/`.
    let folder = Services.dirsvc.get("ProfD", Ci.nsIFile);
    folder.append("taskbartabs");
    return folder;
  },

  /**
   * Checks if the window is a Taskbar Tabs window.
   *
   * @param {Window} aWin - The window to inspect.
   * @returns {bool} true if the window is a Taskbar Tabs window.
   */
  isTaskbarTabWindow(aWin) {
    return aWin.document.documentElement.hasAttribute("taskbartab");
  },

  /**
   * Retrieves the Taskbar Tabs ID for the window.
   *
   * @param {DOMWindow} aWin - The window to retrieve the Taskbar Tabs ID.
   * @returns {string} The Taskbar Tabs ID for the window.
   */
  getTaskbarTabIdFromWindow(aWin) {
    return aWin.document.documentElement.getAttribute("taskbartab");
  },

  /**
   * Retrieves a favicon image container for the provided URL.
   *
   * @param {nsIURI} aUri - The URI to retrieve a favicon for.
   * @returns {imgIContainer} A container of the favicon retrieved, or the
   * default favicon.
   */
  async getFavicon(aUri) {
    let favicon = await lazy.Favicons.getFaviconForPage(aUri);

    let imgContainer;
    if (favicon) {
      lazy.logConsole.debug(`Using favicon at URI ${favicon.dataURI.spec}.`);
      try {
        imgContainer = await getImageFromUri(favicon.dataURI);
      } catch (e) {
        lazy.logConsole.error(
          `${e.message}, falling through to default favicon.`
        );
      }
    }

    if (!imgContainer) {
      lazy.logConsole.debug(
        `Unable to retrieve icon for ${aUri.spec}, using default favicon at ${lazy.Favicons.defaultFavicon.spec}.`
      );
      imgContainer = await getImageFromUri(lazy.Favicons.defaultFavicon);
    }

    return imgContainer;
  },
};

class ChannelListener {
  #request = null;
  #imageListener = null;
  #rejector = null;

  constructor(rejector) {
    this.#rejector = rejector;
  }

  setImageListener(imageListener) {
    this.#imageListener = imageListener;
    if (this.#request) {
      this.#imageListener.onStartRequest(this.#request);
    }
  }

  onStartRequest(request) {
    this.#request = request;
    if (this.#imageListener) {
      this.#imageListener.onStartRequest(request);
    }
  }

  onStopRequest(request, status) {
    if (this.#imageListener) {
      this.#imageListener.onStopRequest(request, status);
    }

    if (!Components.isSuccessCode(status)) {
      this.#rejector(new Components.Exception("Image loading failed", status));
    }

    this.#imageListener = null;
    this.#rejector = null;
    this.#request = null;
  }

  onDataAvailable(request, inputStream, offset, count) {
    if (this.#imageListener) {
      this.#imageListener.onDataAvailable(request, inputStream, offset, count);
    }
  }
}

/**
 * Retrieves an image given a URI.
 *
 * @param {nsIURI} aUri - The URI to retrieve an image from.
 * @returns {Promise<imgIContainer>} Resolves to an image container.
 */
async function getImageFromUri(aUri) {
  // Creating the Taskbar Tabs icon should not result in a network request.
  const protocolFlags = Services.io.getProtocolFlags(aUri.scheme);
  if (!(protocolFlags & Ci.nsIProtocolHandler.URI_IS_LOCAL_RESOURCE)) {
    throw new Error(
      `Scheme "${aUri.scheme}" is not supported for creating a Taskbar Tab icon, URI should be local`
    );
  }

  const channel = Services.io.newChannelFromURI(
    aUri,
    null,
    Services.scriptSecurityManager.getSystemPrincipal(),
    null,
    Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
    Ci.nsIContentPolicy.TYPE_IMAGE
  );

  return new Promise((resolve, reject) => {
    let imageTools = Cc["@mozilla.org/image/tools;1"].getService(Ci.imgITools);

    // Despite the docs it is fine to pass null here, we then just get a global loader.
    let imageLoader = imageTools.getImgLoaderForDocument(null);
    let observer = imageTools.createScriptedObserver({
      decodeComplete() {
        request.cancel(Cr.NS_BINDING_ABORTED);
        resolve(request.image);
      },
    });

    let channelListener = new ChannelListener(reject);
    channel.asyncOpen(channelListener);

    let streamListener = {};
    let request = imageLoader.loadImageWithChannelXPCOM(
      channel,
      observer,
      null,
      streamListener
    );
    // Force image decoding to start when the container is available.
    request.startDecoding(Ci.imgIContainer.FLAG_ASYNC_NOTIFY);

    // If the request is coming from the cache then there will be no listener
    // and the channel will have been automatically cancelled.
    if (streamListener.value) {
      channelListener.setImageListener(streamListener.value);
    }
  });
}
