/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

export * from "./blackbox";
export * from "./breakableLines";
export * from "./loadSourceText";
export * from "./newSources";
export * from "./prettyPrint";
export * from "./select";
export { setSymbols } from "./symbols";

export function setOverrideSource(cx, source, path) {
  return ({ client, dispatch }) => {
    if (!source || !source.url) {
      return;
    }
    const { url } = source;
    client.setOverride(url, path);
    dispatch({
      type: "SET_OVERRIDE",
      cx,
      url,
      path,
    });
  };
}

export function removeOverrideSource(cx, source) {
  return ({ client, dispatch }) => {
    if (!source || !source.url) {
      return;
    }
    const { url } = source;
    client.removeOverride(url);
    dispatch({
      type: "REMOVE_OVERRIDE",
      cx,
      url,
    });
  };
}
