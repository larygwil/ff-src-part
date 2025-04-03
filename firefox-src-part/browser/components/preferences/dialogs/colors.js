/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from /toolkit/content/preferencesBindings.js */

document
  .getElementById("key_close")
  .addEventListener("command", event => Preferences.close(event));

Preferences.addAll([
  { id: "browser.anchor_color", type: "string" },
  { id: "browser.visited_color", type: "string" },
  { id: "browser.display.foreground_color", type: "string" },
  { id: "browser.display.background_color", type: "string" },
]);
