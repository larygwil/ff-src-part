/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import { isOriginalId } from "devtools/client/shared/source-map-loader/index";
import {
  debuggerToSourceMapLocation,
  sourceMapToDebuggerLocation,
} from "./location";
import { waitForSourceToBeRegisteredInStore } from "../client/firefox/create";

/**
 * For any location, return the matching generated location.
 * If this is already a generated location, returns the same location.
 *
 * In additional to `SourceMapLoader.getGeneratedLocation`,
 * this asserts that the related source is still registered in the reducer current state.
 *
 * @param {Object} location
 * @param {Object} thunkArgs
 *        Redux action thunk arguments
 * @param {Object}
 *        The matching generated location.
 */
export async function getGeneratedLocation(location, thunkArgs) {
  if (!isOriginalId(location.sourceId)) {
    return location;
  }

  const { sourceMapLoader, getState } = thunkArgs;
  const generatedLocation = await sourceMapLoader.getGeneratedLocation(
    debuggerToSourceMapLocation(location)
  );
  if (!generatedLocation) {
    return location;
  }

  return sourceMapToDebuggerLocation(getState(), generatedLocation);
}

/**
 * For any location, return the matching original location.
 * If this is already an original location, returns the same location.
 *
 * In additional to `SourceMapLoader.getOriginalLocation`,
 * this automatically fetches the original source object in order to build
 * the original location object.
 *
 * @param {Object} location
 * @param {Object} thunkArgs
 *        Redux action thunk arguments
 * @param {boolean} waitForSource
 *        Default to false. If true is passed, this function will
 *        ensure waiting, possibly asynchronously for the related original source
 *        to be registered in the redux store.
 *
 * @param {Object}
 *        The matching original location.
 */
export async function getOriginalLocation(
  location,
  thunkArgs,
  waitForSource = false
) {
  if (isOriginalId(location.sourceId)) {
    return location;
  }
  const { getState, sourceMapLoader } = thunkArgs;
  const originalLocation = await sourceMapLoader.getOriginalLocation(
    debuggerToSourceMapLocation(location)
  );
  if (!originalLocation) {
    return location;
  }

  // When we are mapping frames while being paused,
  // the original source may not be registered yet in the reducer.
  if (waitForSource) {
    await waitForSourceToBeRegisteredInStore(originalLocation.sourceId);
  }

  return sourceMapToDebuggerLocation(getState(), originalLocation);
}

export async function getMappedLocation(location, thunkArgs) {
  if (!location.source) {
    throw new Error(`no source ${location.sourceId}`);
  }

  if (isOriginalId(location.sourceId)) {
    const generatedLocation = await getGeneratedLocation(location, thunkArgs);
    return { location, generatedLocation };
  }

  const generatedLocation = location;
  const originalLocation = await getOriginalLocation(
    generatedLocation,
    thunkArgs
  );

  return { location: originalLocation, generatedLocation };
}

/**
 * Gets the "mapped location".
 *
 * If the passed location is on a generated source, it gets the
 * related location in the original source.
 * If the passed location is on an original source, it gets the
 * related location in the generated source.
 */
export async function getRelatedMapLocation(location, thunkArgs) {
  if (!location.source) {
    return location;
  }

  if (isOriginalId(location.sourceId)) {
    return getGeneratedLocation(location, thunkArgs);
  }

  return getOriginalLocation(location, thunkArgs);
}
