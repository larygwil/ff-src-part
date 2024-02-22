/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// React & Redux
const {
  createFactory,
} = require("resource://devtools/client/shared/vendor/react.js");
const PropTypes = require("resource://devtools/client/shared/vendor/react-prop-types.js");
const dom = require("resource://devtools/client/shared/vendor/react-dom-factories.js");
const GripMessageBody = require("resource://devtools/client/webconsole/components/Output/GripMessageBody.js");

const {
  MESSAGE_TYPE,
} = require("resource://devtools/client/webconsole/constants.js");

const Message = createFactory(
  require("resource://devtools/client/webconsole/components/Output/Message.js")
);

JSTracerTrace.displayName = "JSTracerTrace";

JSTracerTrace.propTypes = {
  dispatch: PropTypes.func.isRequired,
  message: PropTypes.object.isRequired,
  serviceContainer: PropTypes.object.isRequired,
  timestampsVisible: PropTypes.bool.isRequired,
  maybeScrollToBottom: PropTypes.func,
};

function JSTracerTrace(props) {
  const {
    dispatch,
    message,
    serviceContainer,
    timestampsVisible,
    repeat,
    maybeScrollToBottom,
    setExpanded,
  } = props;

  const {
    // List of common attributes for all tracer messages
    timeStamp,
    prefix,
    depth,
    source,

    // Attribute specific to DOM event
    eventName,

    // Attributes specific to function calls
    frame,
    implementation,
    displayName,
    parameters,

    // Attributes specific to function call returns
    returnedValue,
    relatedTraceId,
    // See tracer.jsm FRAME_EXIT_REASONS
    why,
  } = message;

  // When we are logging a DOM event, we have the `eventName` defined.
  let messageBody;
  if (eventName) {
    messageBody = [dom.span({ className: "jstracer-dom-event" }, eventName)];
  } else if (typeof relatedTraceId == "number") {
    messageBody = [
      dom.span({ className: "jstracer-io" }, "⟵ "),
      dom.span({ className: "jstracer-display-name" }, displayName),
    ];
  } else {
    messageBody = [
      dom.span({ className: "jstracer-io" }, "⟶ "),
      dom.span({ className: "jstracer-implementation" }, implementation),
      // Add a space in order to improve copy paste rendering
      dom.span({ className: "jstracer-display-name" }, " " + displayName),
    ];
  }

  let messageBodyConfig;
  if (parameters || why) {
    messageBodyConfig = {
      dispatch,
      serviceContainer,
      maybeScrollToBottom,
      setExpanded,
      type: "",
      useQuotes: true,

      // Disable custom formatter for now in traces
      customFormat: false,
    };
  }
  // Arguments will only be passed on-demand

  if (parameters) {
    messageBody.push("(", ...formatReps(messageBodyConfig, parameters), ")");
  }
  // Returned value will also only be passed on-demand
  if (why) {
    messageBody.push(
      // Add a spaces in order to improve copy paste rendering
      dom.span({ className: "jstracer-exit-frame-reason" }, " " + why + " "),
      formatRep(messageBodyConfig, returnedValue)
    );
  }

  if (prefix) {
    messageBody.unshift(
      dom.span(
        {
          className: "console-message-prefix",
        },
        `${prefix}`
      )
    );
  }

  const topLevelClasses = ["cm-s-mozilla"];

  return Message({
    collapsible: false,
    source,
    level: MESSAGE_TYPE.JSTRACER,
    topLevelClasses,
    messageBody,
    repeat,
    frame,
    stacktrace: null,
    attachment: null,
    serviceContainer,
    dispatch,
    indent: depth,
    timeStamp,
    timestampsVisible,
    parameters,
    message,
    maybeScrollToBottom,
  });
}

/**
 * Generated the list of GripMessageBody for a list of objects.
 * GripMessageBody is Rep's rendering for a given Object, via its object actor's front.
 */
function formatReps(messageBodyConfig, objects) {
  const elements = [];
  const length = objects.length;
  for (let i = 0; i < length; i++) {
    elements.push(formatRep(messageBodyConfig, objects[i], i));

    // We need to interleave a comma if we are not on the last element
    if (i !== length - 1) {
      elements.push(", ");
    }
  }

  return elements;
}

function formatRep(messageBodyConfig, grip, key) {
  return GripMessageBody({
    ...messageBodyConfig,
    grip,
    key,
  });
}

module.exports = JSTracerTrace;
