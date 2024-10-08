/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Dumping ground for simple services for which the isolation of a full global
 * is overkill. Be careful about namespace pollution, and be mindful about
 * importing lots of JSMs in global scope, since this file will almost certainly
 * be loaded from enough callsites that any such imports will always end up getting
 * eagerly loaded at startup.
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
});

XPCOMUtils.defineLazyServiceGetter(
  lazy,
  "streamConv",
  "@mozilla.org/streamConverters;1",
  "nsIStreamConverterService"
);
const ArrayBufferInputStream = Components.Constructor(
  "@mozilla.org/io/arraybuffer-input-stream;1",
  "nsIArrayBufferInputStream",
  "setData"
);

/*
 * This class provides a stream filter for locale messages in CSS files served
 * by the moz-extension: protocol handler.
 *
 * See SubstituteChannel in netwerk/protocol/res/ExtensionProtocolHandler.cpp
 * for usage.
 */
export function AddonLocalizationConverter() {}

AddonLocalizationConverter.prototype = {
  QueryInterface: ChromeUtils.generateQI(["nsIStreamConverter"]),

  FROM_TYPE: "application/vnd.mozilla.webext.unlocalized",
  TO_TYPE: "text/css",

  checkTypes(aFromType, aToType) {
    if (aFromType != this.FROM_TYPE) {
      throw Components.Exception(
        "Invalid aFromType value",
        Cr.NS_ERROR_INVALID_ARG,
        Components.stack.caller.caller
      );
    }
    if (aToType != this.TO_TYPE) {
      throw Components.Exception(
        "Invalid aToType value",
        Cr.NS_ERROR_INVALID_ARG,
        Components.stack.caller.caller
      );
    }
  },

  // aContext must be a nsIURI object for a valid moz-extension: URL.
  getAddon(aContext) {
    // In this case, we want the add-on ID even if the URL is web accessible,
    // so check the root rather than the exact path.
    let uri = Services.io.newURI("/", null, aContext);

    let addon = WebExtensionPolicy.getByURI(uri);
    if (!addon) {
      throw new Components.Exception(
        "Invalid context",
        Cr.NS_ERROR_INVALID_ARG
      );
    }
    return addon;
  },

  convertToStream(aAddon, aString) {
    aString = aAddon.localize(aString);
    let bytes = new TextEncoder().encode(aString).buffer;
    return new ArrayBufferInputStream(bytes, 0, bytes.byteLength);
  },

  convert(aStream, aFromType, aToType, aContext) {
    this.checkTypes(aFromType, aToType);
    let addon = this.getAddon(aContext);

    let count = aStream.available();
    let string = count
      ? new TextDecoder().decode(lazy.NetUtil.readInputStream(aStream, count))
      : "";
    return this.convertToStream(addon, string);
  },

  asyncConvertData(aFromType, aToType, aListener, aContext) {
    this.checkTypes(aFromType, aToType);
    this.addon = this.getAddon(aContext);
    this.listener = aListener;
  },

  onStartRequest() {
    this.parts = [];
    this.decoder = new TextDecoder();
  },

  onDataAvailable(aRequest, aInputStream, aOffset, aCount) {
    let bytes = lazy.NetUtil.readInputStream(aInputStream, aCount);
    this.parts.push(this.decoder.decode(bytes, { stream: true }));
  },

  onStopRequest(aRequest, aStatusCode) {
    try {
      this.listener.onStartRequest(aRequest, null);
      if (Components.isSuccessCode(aStatusCode)) {
        this.parts.push(this.decoder.decode());
        let string = this.parts.join("");
        let stream = this.convertToStream(this.addon, string);

        this.listener.onDataAvailable(aRequest, stream, 0, stream.available());
      }
    } catch (e) {
      aStatusCode = e.result || Cr.NS_ERROR_FAILURE;
    }
    this.listener.onStopRequest(aRequest, aStatusCode);
  },
};

export function HttpIndexViewer() {}

HttpIndexViewer.prototype = {
  QueryInterface: ChromeUtils.generateQI(["nsIDocumentLoaderFactory"]),

  createInstance(
    aCommand,
    aChannel,
    aLoadGroup,
    aContentType,
    aContainer,
    aExtraInfo,
    aDocListenerResult
  ) {
    // Bug 1824325: application/http-index-format is deprecated for almost all
    // sites, we only allow it for urls with a inner scheme of "file" or
    // "moz-gio" (specified in network.http_index_format.allowed_schemes).
    // This also includes jar: and resource:// uris, as jar: uris has a inner
    // scheme of "file", and resource:// uris have been turned into either a
    // jar: or file:// uri by the point where we are checking them here.

    let uri = aChannel.URI;
    if (uri instanceof Ci.nsINestedURI) {
      uri = uri.QueryInterface(Ci.nsINestedURI).innermostURI;
    }

    const allowedSchemes = Services.prefs.getStringPref(
      "network.http_index_format.allowed_schemes",
      ""
    );
    let isFile =
      allowedSchemes === "*" || allowedSchemes.split(",").some(uri.schemeIs);
    let contentType = isFile ? "text/html" : "text/plain";

    aChannel.contentType = contentType;

    // NOTE: This assumes that both text/html and text/plain will continue to be
    // handled by nsContentDLF. If this ever changes this logic will need to be
    // updated.
    let factory = Cc[
      "@mozilla.org/content/document-loader-factory;1"
    ].getService(Ci.nsIDocumentLoaderFactory);

    let listener = {};
    let res = factory.createInstance(
      "view",
      aChannel,
      aLoadGroup,
      contentType,
      aContainer,
      aExtraInfo,
      listener
    );

    if (isFile) {
      aDocListenerResult.value = lazy.streamConv.asyncConvertData(
        "application/http-index-format",
        "text/html",
        listener.value,
        null
      );
    } else {
      aDocListenerResult.value = listener.value;
      aChannel.loadInfo.browsingContext.window.console.warn(
        "application/http-index-format is deprecated, content will display as plain text"
      );
    }

    return res;
  },
};
