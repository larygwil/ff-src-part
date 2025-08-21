/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/**
 * Ast reducer
 * @module reducers/ast
 */

import { makeBreakpointId } from "../utils/breakpoint/index";

export function initialASTState() {
  return {
    // We are using mutable objects as we never return the dictionary as-is from the selectors
    // but only their values.
    // Note that all these dictionaries are storing objects as values
    // which all will have:
    // * a "source" attribute,
    // * a "lines" array.
    mutableInScopeLines: new Map(),
  };
}

function update(state = initialASTState(), action) {
  switch (action.type) {
    case "IN_SCOPE_LINES": {
      state.mutableInScopeLines.set(makeBreakpointId(action.location), {
        lines: action.lines,
        source: action.location.source,
      });
      return {
        ...state,
      };
    }

    case "RESUME": {
      return initialASTState();
    }

    case "REMOVE_SOURCES": {
      const { sources } = action;
      if (!sources.length) {
        return state;
      }
      const { mutableInScopeLines } = state;
      let changed = false;
      for (const [breakpointId, { source }] in mutableInScopeLines.entries()) {
        if (sources.includes(source)) {
          mutableInScopeLines.delete(breakpointId);
          changed = true;
        }
      }

      return changed ? { ...state } : state;
    }

    default: {
      return state;
    }
  }
}

export default update;
