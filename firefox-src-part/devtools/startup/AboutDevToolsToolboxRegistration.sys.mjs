/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Register about:devtools-toolbox which allows to open a devtools toolbox
// in a Firefox tab or a custom html iframe in browser.html

const { nsIAboutModule } = Ci;

export function AboutDevtoolsToolbox() {}

AboutDevtoolsToolbox.prototype = {
  uri: Services.io.newURI("chrome://devtools/content/framework/toolbox.xhtml"),
  classDescription: "about:devtools-toolbox",
  classID: Components.ID("11342911-3135-45a8-8d71-737a2b0ad469"),
  contractID: "@mozilla.org/network/protocol/about;1?what=devtools-toolbox",

  QueryInterface: ChromeUtils.generateQI([nsIAboutModule]),

  newChannel(uri, loadInfo) {
    const chan = Services.io.newChannelFromURIWithLoadInfo(this.uri, loadInfo);
    chan.owner = Services.scriptSecurityManager.getSystemPrincipal();
    return chan;
  },

  getURIFlags() {
    return (
      nsIAboutModule.ALLOW_SCRIPT |
      nsIAboutModule.ENABLE_INDEXED_DB |
      nsIAboutModule.HIDE_FROM_ABOUTABOUT
    );
  },

  getChromeURI(_uri) {
    return this.uri;
  },
};
