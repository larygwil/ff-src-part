/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  Component,
} = require("resource://devtools/client/shared/vendor/react.js");
const PropTypes = require("resource://devtools/client/shared/vendor/react-prop-types.js");
const dom = require("resource://devtools/client/shared/vendor/react-dom-factories.js");
const {
  connect,
} = require("resource://devtools/client/shared/vendor/react-redux.js");
const { PluralForm } = require("resource://devtools/shared/plural-form.js");
const Actions = require("resource://devtools/client/netmonitor/src/actions/index.js");
const {
  getDisplayedRequestsSummary,
  getDisplayedTimingMarker,
} = require("resource://devtools/client/netmonitor/src/selectors/index.js");
const {
  getFormattedSize,
  getFormattedTime,
} = require("resource://devtools/client/netmonitor/src/utils/format-utils.js");
const {
  L10N,
} = require("resource://devtools/client/netmonitor/src/utils/l10n.js");
const {
  propertiesEqual,
} = require("resource://devtools/client/netmonitor/src/utils/request-utils.js");

const { button, div } = dom;

const REQUESTS_COUNT_EMPTY = L10N.getStr(
  "networkMenu.summary.requestsCountEmpty"
);
const TOOLTIP_PERF = L10N.getStr("networkMenu.summary.tooltip.perf");
const TOOLTIP_REQUESTS_COUNT = L10N.getStr(
  "networkMenu.summary.tooltip.requestsCount"
);
const TOOLTIP_TRANSFERRED = L10N.getStr(
  "networkMenu.summary.tooltip.transferred"
);
const TOOLTIP_FINISH = L10N.getStr("networkMenu.summary.tooltip.finish");
const TOOLTIP_DOM_CONTENT_LOADED = L10N.getStr(
  "networkMenu.summary.tooltip.domContentLoaded"
);
const TOOLTIP_LOAD = L10N.getStr("networkMenu.summary.tooltip.load");

const UPDATED_SUMMARY_PROPS = ["count", "contentSize", "transferredSize", "ms"];

const UPDATED_TIMING_PROPS = ["DOMContentLoaded", "load"];

/**
 * Status Bar component
 * Displays the summary of total size and transferred size by all requests
 * Also displays different timing markers
 */
class StatusBar extends Component {
  static get propTypes() {
    return {
      connector: PropTypes.object.isRequired,
      openStatistics: PropTypes.func.isRequired,
      summary: PropTypes.object.isRequired,
      timingMarkers: PropTypes.object.isRequired,
    };
  }

  shouldComponentUpdate(nextProps) {
    const { summary, timingMarkers } = this.props;
    return (
      !propertiesEqual(UPDATED_SUMMARY_PROPS, summary, nextProps.summary) ||
      !propertiesEqual(
        UPDATED_TIMING_PROPS,
        timingMarkers,
        nextProps.timingMarkers
      )
    );
  }

  render() {
    const { openStatistics, summary, timingMarkers, connector } = this.props;
    const { count, contentSize, transferredSize, ms } = summary;
    const { DOMContentLoaded, load } = timingMarkers;

    const toolbox = connector.getToolbox();
    const countText =
      count === 0
        ? REQUESTS_COUNT_EMPTY
        : PluralForm.get(
            count,
            L10N.getStr("networkMenu.summary.requestsCount2")
          ).replace("#1", count);
    const transferText = L10N.getFormatStrWithNumbers(
      "networkMenu.summary.transferred",
      getFormattedSize(contentSize),
      getFormattedSize(transferredSize)
    );
    const finishText = L10N.getFormatStrWithNumbers(
      "networkMenu.summary.finish",
      getFormattedTime(ms)
    );

    return div(
      { className: "devtools-toolbar devtools-toolbar-bottom" },
      !toolbox.isBrowserToolbox
        ? button({
            className: "devtools-button requests-list-network-summary-button",
            title: TOOLTIP_PERF,
            onClick: openStatistics,
          })
        : null,
      div(
        {
          className: "status-bar-label requests-list-network-summary-count",
          title: TOOLTIP_REQUESTS_COUNT,
        },
        countText
      ),
      count !== 0 &&
        div(
          {
            className:
              "status-bar-label requests-list-network-summary-transfer",
            title: TOOLTIP_TRANSFERRED,
          },
          transferText
        ),
      count !== 0 &&
        div(
          {
            className: "status-bar-label requests-list-network-summary-finish",
            title: TOOLTIP_FINISH,
          },
          finishText
        ),
      DOMContentLoaded > -1 &&
        div(
          {
            className: "status-bar-label dom-content-loaded",
            title: TOOLTIP_DOM_CONTENT_LOADED,
          },
          `DOMContentLoaded: ${getFormattedTime(DOMContentLoaded)}`
        ),
      load > -1 &&
        div(
          {
            className: "status-bar-label load",
            title: TOOLTIP_LOAD,
          },
          `load: ${getFormattedTime(load)}`
        )
    );
  }
}

module.exports = connect(
  state => ({
    summary: getDisplayedRequestsSummary(state),
    timingMarkers: {
      DOMContentLoaded: getDisplayedTimingMarker(
        state,
        "firstDocumentDOMContentLoadedTimestamp"
      ),
      load: getDisplayedTimingMarker(state, "firstDocumentLoadTimestamp"),
    },
  }),
  (dispatch, props) => ({
    openStatistics: () =>
      dispatch(Actions.openStatistics(props.connector, true)),
  })
)(StatusBar);
