/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import {
  getSelectedFrameInlinePreviews,
  getSelectedLocation,
  getSelectedScope,
} from "../../selectors/index";
import { features } from "../../utils/prefs";
import { getEditor } from "../../utils/editor/index";
import { validateSelectedFrame } from "../../utils/context";

/**
 * Update the inline previews for the currently selected frame.
 */
export function generateInlinePreview(selectedFrame) {
  return async function (thunkArgs) {
    const { dispatch, getState } = thunkArgs;
    if (!features.inlinePreview) {
      return null;
    }

    // Avoid regenerating inline previews when we already have preview data
    if (getSelectedFrameInlinePreviews(getState())) {
      return null;
    }

    const scope = getSelectedScope(getState());
    if (!scope || !scope.bindings) {
      return null;
    }

    const allPreviews = await getPreviews(selectedFrame, scope, thunkArgs);
    // Sort previews by line and column so they're displayed in the right order in the editor
    allPreviews.sort((previewA, previewB) => {
      if (previewA.line < previewB.line) {
        return -1;
      }
      if (previewA.line > previewB.line) {
        return 1;
      }
      // If we have the same line number
      return previewA.column < previewB.column ? -1 : 1;
    });

    const previews = {};
    for (const preview of allPreviews) {
      const { line } = preview;
      if (!previews[line]) {
        previews[line] = [];
      }
      previews[line].push(preview);
    }

    validateSelectedFrame(getState(), selectedFrame);

    return dispatch({
      type: "ADD_INLINE_PREVIEW",
      selectedFrame,
      previews,
    });
  };
}
/**
 * Creates all the previews
 *
 * @param {Object} selectedFrame
 * @param {Object} scope - Scope from the platform
 * @param {Object} thunkArgs
 * @returns
 */
async function getPreviews(selectedFrame, scope, thunkArgs) {
  const { client, parserWorker, getState } = thunkArgs;

  // It's important to use selectedLocation, because we don't know
  // if we'll be viewing the original or generated frame location
  const selectedLocation = getSelectedLocation(getState());
  if (!selectedLocation) {
    return [];
  }

  if (!parserWorker.isLocationSupported(selectedLocation)) {
    return [];
  }

  const allPreviews = [];
  if (features.codemirrorNext) {
    // Get all the bindings for all scopes up until and including the first function scope.
    let allBindings = {};
    while (scope && scope.bindings) {
      const bindings = getScopeBindings(scope);
      allBindings = { ...allBindings, ...bindings };
      if (scope.type === "function") {
        break;
      }
      scope = scope.parent;
    }
    const editor = getEditor(features.codemirrorNext);
    const references = await editor.getBindingReferences(
      selectedLocation,
      Object.keys(allBindings)
    );

    validateSelectedFrame(getState(), selectedFrame);

    for (const name in references) {
      const previews = await generatePreviewsForBinding(
        references[name],
        selectedLocation.line,
        name,
        allBindings[name].value,
        client,
        selectedFrame.thread
      );
      allPreviews.push(...previews);
    }
  } else {
    const originalAstScopes = await parserWorker.getScopes(selectedLocation);
    if (!originalAstScopes) {
      return [];
    }

    // Bailout if we resumed or moved to another frame while computing the scope
    validateSelectedFrame(getState(), selectedFrame);
    let level = 0;
    while (scope && scope.bindings) {
      // All the bindings from the platform environment
      const bindings = getScopeBindings(scope);

      // Generate the previews for all the bindings
      const allPreviewBindingsComplete = Object.keys(bindings).map(
        async name => {
          // Get previews for this binding
          const previews = await generatePreviewsForBinding(
            originalAstScopes[level]?.bindings[name],
            selectedLocation.line,
            name,
            bindings[name].value,
            client,
            selectedFrame.thread
          );

          allPreviews.push(...previews);
        }
      );
      await Promise.all(allPreviewBindingsComplete);

      // Bailout if we resumed or moved to another frame while fetching the values from the backend
      validateSelectedFrame(getState(), selectedFrame);

      // We need to display all variables in for all block scopes up until
      // and including the first function scope.
      if (scope.type === "function") {
        break;
      }
      level++;
      scope = scope.parent;
    }
  }
  return allPreviews;
}

/**
 * Merge both variables and arguments into a unique "bindings" objects, where arguments overrides variables.
 *
 * @param {Object} scope
 * @returns
 */
function getScopeBindings(scope) {
  const bindings = { ...scope.bindings.variables };
  scope.bindings.arguments.forEach(argument => {
    Object.keys(argument).forEach(key => {
      bindings[key] = argument[key];
    });
  });
  return bindings;
}

/**
 * Generates the previews from the binding information
 *
 * @param {Object} bindingData - Scope binding data from the AST about a particular variable/argument at a particular level in the scope.
 * @param {Number} pausedOnLine - The current line we are paused on
 * @param {String} name - Name of binding from the platfom scopes
 * @param {String} value - Value of the binding from the platform scopes
 * @param {Object} client - Client object for loading properties
 * @param {Object} thread - Thread used to get the expressions values
 * @returns
 */
async function generatePreviewsForBinding(
  bindingData,
  pausedOnLine,
  name,
  value,
  client,
  thread
) {
  if (!bindingData) {
    return [];
  }

  // Show a variable only once ( an object and it's child property are
  // counted as different )
  const identifiers = new Set();
  const previews = [];
  // We start from end as we want to show values besides variable
  // located nearest to the breakpoint
  for (let i = bindingData.refs.length - 1; i >= 0; i--) {
    const ref = bindingData.refs[i];
    // Subtracting 1 from line as codemirror lines are 0 indexed
    const line = ref.start.line - 1;
    const column = ref.start.column;
    // We don't want to render inline preview below the paused line
    if (line >= pausedOnLine - 1) {
      continue;
    }

    const { displayName, displayValue } = await getExpressionNameAndValue(
      name,
      value,
      ref,
      client,
      thread
    );

    // Variable with same name exists, display value of current or
    // closest to the current scope's variable
    if (identifiers.has(displayName)) {
      continue;
    }
    identifiers.add(displayName);

    previews.push({
      line,
      column,
      // This attribute helps distinguish pause from trace previews
      type: "paused",
      name: displayName,
      value: displayValue,
    });
  }
  return previews;
}

/**
 * Get the name and value details to be displayed in the inline preview
 *
 * @param {String} name - Binding name
 * @param {String} value - Binding value which is the Enviroment object actor form
 * @param {Object} ref - Binding reference
 * @param {Object} client - Client object for loading properties
 * @param {String} thread - Thread used to get the expression values
 * @returns
 */
async function getExpressionNameAndValue(name, value, ref, client, thread) {
  let displayName = name;
  let displayValue = value;

  // We want to show values of properties of objects only and not
  // function calls on other data types like someArr.forEach etc..
  let properties = null;
  if (value.actor && value.class === "Object") {
    properties = await client.loadObjectProperties(
      {
        name,
        path: name,
        contents: { value },
      },
      thread
    );
  }

  // Only variables of type Object will have properties
  if (properties) {
    let { meta } = ref;
    // Presence of meta property means expression contains child property
    // reference eg: objName.propName
    while (meta) {
      // Initially properties will be an array, after that it will be an object
      if (displayValue === value) {
        const property = properties.find(prop => prop.name === meta.property);
        displayValue = property?.contents.value;
        displayName += `.${meta.property}`;
      } else if (displayValue?.preview?.ownProperties) {
        const { ownProperties } = displayValue.preview;
        Object.keys(ownProperties).forEach(prop => {
          if (prop === meta.property) {
            displayValue = ownProperties[prop].value;
            displayName += `.${meta.property}`;
          }
        });
      }
      meta = meta.parent;
    }
  }

  return { displayName, displayValue };
}
