/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Bug 1769762 - Empty out navigator.plugins
 * WebCompat issue #103612 - https://webcompat.com/issues/103612
 *
 * Certain features of the site are breaking if navigator.plugins array is not empty:
 *
 * 1. "Likes" on the comments are not saved
 * 2. Can't reply to other people's comments
 * 3. "Likes" on the videos are not saved
 * 4. Can't follow an account (after refreshing "Follow" button is visible again)
 *
 * (note that the first 2 are still broken if you open devtools even with this intervention)
 */

/* globals exportFunction */

console.info(
  "The PluginArray has been overridden for compatibility reasons. See https://bugzilla.mozilla.org/show_bug.cgi?id=1753874 for details."
);

const pluginsArray = new window.wrappedJSObject.Array();
Object.setPrototypeOf(pluginsArray, PluginArray.prototype);
const navProto = Object.getPrototypeOf(navigator.wrappedJSObject);
const pluginsDesc = Object.getOwnPropertyDescriptor(navProto, "plugins");
pluginsDesc.get = exportFunction(() => pluginsArray, window);
Object.defineProperty(navProto, "plugins", pluginsDesc);
