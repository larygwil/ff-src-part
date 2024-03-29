/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  MESSAGES_ADD,
  MESSAGES_CLEAR,
  PRIVATE_MESSAGES_CLEAR,
  FRONTS_TO_RELEASE_CLEAR,
} = require("resource://devtools/client/webconsole/constants.js");

/**
 * This enhancer is responsible for releasing actors on the backend.
 * When messages with arguments are removed from the store we should also
 * clean up the backend.
 */
function enableActorReleaser(webConsoleUI) {
  return next => (reducer, initialState, enhancer) => {
    function releaseActorsEnhancer(state, action) {
      state = reducer(state, action);

      const { type } = action;
      if (
        webConsoleUI &&
        [MESSAGES_ADD, MESSAGES_CLEAR, PRIVATE_MESSAGES_CLEAR].includes(type)
      ) {
        const { frontInSidebar } = state.ui;
        let { frontsToRelease } = state.messages;
        // Ignore the front for object still displayed in the sidebar, if there is one.
        frontsToRelease = frontInSidebar
          ? frontsToRelease.filter(
              front => frontInSidebar.actorID !== front.actorID
            )
          : state.messages.frontsToRelease;

        webConsoleUI.hud.commands.objectCommand
          .releaseObjects(frontsToRelease)
          // Emit an event we can listen to to make sure all the fronts were released.
          .then(() => webConsoleUI.emitForTests("fronts-released"));

        // Reset `frontsToRelease` in message reducer.
        state = reducer(state, {
          type: FRONTS_TO_RELEASE_CLEAR,
        });
      }

      return state;
    }

    return next(releaseActorsEnhancer, initialState, enhancer);
  };
}

module.exports = enableActorReleaser;
