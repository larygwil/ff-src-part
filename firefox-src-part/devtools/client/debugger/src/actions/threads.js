/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import { createThread } from "../client/firefox/create";
import { getSourcesToRemoveForThread } from "../selectors/index";
import { removeSources } from "./sources/removeSources";

export function addTarget(targetFront) {
  return { type: "INSERT_THREAD", newThread: createThread(targetFront) };
}

export function removeTarget(targetFront) {
  return async ({ getState, dispatch }) => {
    const threadActorID = targetFront.targetForm.threadActor;

    // Just before emitting the REMOVE_THREAD action,
    // synchronously compute the list of source and source actor objects
    // which should be removed as that one target get removed.
    //
    // The list of source objects isn't trivial to compute as these objects
    // are shared across targets/threads.
    const { actors, sources } = getSourcesToRemoveForThread(
      getState(),
      threadActorID
    );

    // Notify the reducers that a target/thread is being removed.
    // This will be fired on navigation for all existing targets.
    // That except the top target, when pausing on unload, where the top target may still hold longer.
    // Also except for service worker targets, which may be kept alive.
    dispatch({
      type: "REMOVE_THREAD",
      threadActorID,
    });
    // A distinct action is used to notify about all the sources and source actors objects
    // to be removed. This action is shared by some other codepath. Like removing the pretty printed source.
    await dispatch(removeSources(sources, actors));
  };
}

export function toggleJavaScriptEnabled(enabled) {
  return async ({ dispatch, client }) => {
    await client.toggleJavaScriptEnabled(enabled);
    dispatch({
      type: "TOGGLE_JAVASCRIPT_ENABLED",
      value: enabled,
    });
  };
}
