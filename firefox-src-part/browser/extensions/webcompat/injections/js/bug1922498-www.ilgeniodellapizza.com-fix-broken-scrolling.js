/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Bug 1922498 - scrolling is broken on www.ilgeniodellapizza.com
 *
 * The site is expecting wheelDeltaY to have the opposite sign, breaking scrolling.
 * We can override the value to flip the sign and scale down the value.
 */

/* globals exportFunction */

console.info(
  "wheelDeltaY is being overriden for compatibility reasons. See https://bugzilla.mozilla.org/show_bug.cgi?id=1922498 for details."
);

const proto = window.wrappedJSObject.WheelEvent.prototype;
const descriptor = Object.getOwnPropertyDescriptor(proto, "wheelDeltaY");
const { get } = descriptor;

descriptor.get = exportFunction(function () {
  const value = get.call(this);
  return -value / 40;
}, window);

Object.defineProperty(proto, "wheelDeltaY", descriptor);
