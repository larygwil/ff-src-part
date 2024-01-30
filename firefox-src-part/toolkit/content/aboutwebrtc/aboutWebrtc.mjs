/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { GraphImpl } from "chrome://global/content/aboutwebrtc/graph.mjs";
import { GraphDb } from "chrome://global/content/aboutwebrtc/graphdb.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
});

function makeFilePickerService() {
  const fpContractID = "@mozilla.org/filepicker;1";
  const fpIID = Ci.nsIFilePicker;
  return Cc[fpContractID].createInstance(fpIID);
}

const WGI = WebrtcGlobalInformation;

const LOGFILE_NAME_DEFAULT = "aboutWebrtc.html";
const WEBRTC_TRACE_ALL = 65535;

class Renderer {
  // Long function names preserved until code can be uniformly moved to new names
  renderElement(eleName, options, l10n_id, l10n_args) {
    let elem = Object.assign(document.createElement(eleName), options);
    if (l10n_id) {
      document.l10n.setAttributes(elem, l10n_id, l10n_args);
    }
    return elem;
  }
  elem() {
    return this.renderElement(...arguments);
  }
  text(eleName, textContent, options) {
    return this.renderElement(eleName, Object.assign({ textContent }, options));
  }
  renderElements(eleName, options, list) {
    const element = renderElement(eleName, options);
    element.append(...list);
    return element;
  }
  elems() {
    return this.renderElements(...arguments);
  }
}

// Proxies a Renderer instance to provide some meta programming methods to make
// adding elements more readable, e.g. elemRenderer.elem_h4(...) instead of
// elemRenderer.elem("h4", ...).
const elemRenderer = new Proxy(new Renderer(), {
  get(target, prop, receiver) {
    // Function prefixes to proxy.
    const proxied = {
      elem_: (...args) => target.elem(...args),
      elems_: (...args) => target.elems(...args),
      text_: (...args) => target.text(...args),
    };
    for (let [prefix, func] of Object.entries(proxied)) {
      if (prop.startsWith(prefix) && prop.length > prefix.length) {
        return (...args) => func(prop.substring(prefix.length), ...args);
      }
    }
    // Pass non-matches to the base object
    return Reflect.get(...arguments);
  },
});

let graphData = [];
let mostRecentReports = {};
let sdpHistories = [];
let historyTsMemoForPcid = {};
let sdpHistoryTsMemoForPcid = {};

function clearStatsHistory() {
  graphData = [];
  mostRecentReports = {};
  sdpHistories = [];
  historyTsMemoForPcid = {};
  sdpHistoryTsMemoForPcid = {};
}

function appendReportToHistory(report) {
  appendSdpHistory(report);
  mostRecentReports[report.pcid] = report;
  if (graphData[report.pcid] === undefined) {
    graphData[report.pcid] ??= new GraphDb(report);
  } else {
    graphData[report.pcid].insertReportData(report);
  }
}

function appendSdpHistory({ pcid, sdpHistory: newHistory }) {
  sdpHistories[pcid] ??= [];
  let storedHistory = sdpHistories[pcid];
  newHistory.forEach(entry => {
    const { timestamp } = entry;
    if (!storedHistory.length || storedHistory.at(-1).timestamp < timestamp) {
      storedHistory.push(entry);
      sdpHistoryTsMemoForPcid[pcid] = timestamp;
    }
  });
}

function recentStats() {
  return Object.values(mostRecentReports);
}

// Returns the sdpHistory for a given stats report
function getSdpHistory({ pcid, timestamp: a }) {
  sdpHistories[pcid] ??= [];
  return sdpHistories[pcid].filter(({ timestamp: b }) => a >= b);
}

function appendStats(allStats) {
  allStats.forEach(appendReportToHistory);
}

function getAndUpdateStatsTsMemoForPcid(pcid) {
  historyTsMemoForPcid[pcid] = mostRecentReports[pcid]?.timestamp;
  return historyTsMemoForPcid[pcid] || null;
}

function getSdpTsMemoForPcid(pcid) {
  return sdpHistoryTsMemoForPcid[pcid] || null;
}

const REQUEST_FULL_REFRESH = true;
async function getStats(requestFullRefresh) {
  if (
    requestFullRefresh ||
    !Services.prefs.getBoolPref("media.aboutwebrtc.hist.enabled")
  ) {
    const { reports } = await new Promise(r => WGI.getAllStats(r));
    appendStats(reports);
    return reports.sort((a, b) => b.timestamp - a.timestamp);
  }
  const pcids = await new Promise(r => WGI.getStatsHistoryPcIds(r));
  await Promise.all(
    [...pcids].map(pcid =>
      new Promise(r =>
        WGI.getStatsHistorySince(
          r,
          pcid,
          getAndUpdateStatsTsMemoForPcid(pcid),
          getSdpTsMemoForPcid(pcid)
        )
      ).then(r => {
        appendStats(r.reports);
        r.sdpHistories.forEach(hist => appendSdpHistory(hist));
      })
    )
  );
  let recent = recentStats();
  return recent.sort((a, b) => b.timestamp - a.timestamp);
}

const getLog = () => new Promise(r => WGI.getLogging("", r));

const renderElement = (eleName, options, l10n_id, l10n_args) =>
  elemRenderer.elem(eleName, options, l10n_id, l10n_args);

const renderText = (eleName, textContent, options) =>
  elemRenderer.text(eleName, textContent, options);

const renderElements = (eleName, options, list) =>
  elemRenderer.elems(eleName, options, list);

// Button control classes

class Control {
  label = null;
  message = null;
  messageArgs = null;
  messageHeader = null;

  render() {
    this.ctrl = renderElement(
      "button",
      { onclick: () => this.onClick() },
      this.label
    );
    this.msg = renderElement("p");
    this.update();
    return [this.ctrl, this.msg];
  }

  update() {
    document.l10n.setAttributes(this.ctrl, this.label);
    this.msg.textContent = "";
    if (this.message) {
      this.msg.append(
        renderElement(
          "span",
          {
            className: "info-label",
          },
          this.messageHeader
        ),
        renderElement(
          "span",
          {
            className: "info-body",
          },
          this.message,
          this.messageArgs
        )
      );
    }
  }
}

class SavePage extends Control {
  constructor() {
    super();
    this.messageHeader = "about-webrtc-save-page-label";
    this.label = "about-webrtc-save-page-label";
  }

  async onClick() {
    FoldEffect.expandAll();
    let [dialogTitle] = await document.l10n.formatValues([
      { id: "about-webrtc-save-page-dialog-title" },
    ]);
    let FilePicker = makeFilePickerService();
    const lazyFileUtils = lazy.FileUtils;
    FilePicker.init(window, dialogTitle, FilePicker.modeSave);
    FilePicker.defaultString = LOGFILE_NAME_DEFAULT;
    const rv = await new Promise(r => FilePicker.open(r));
    if (rv != FilePicker.returnOK && rv != FilePicker.returnReplace) {
      return;
    }
    const fout = lazyFileUtils.openAtomicFileOutputStream(
      FilePicker.file,
      lazyFileUtils.MODE_WRONLY | lazyFileUtils.MODE_CREATE
    );
    const content = document.querySelector("#content");
    const noPrintList = [...content.querySelectorAll(".no-print")];
    for (const node of noPrintList) {
      node.style.setProperty("display", "none");
    }
    try {
      fout.write(content.outerHTML, content.outerHTML.length);
    } finally {
      lazyFileUtils.closeAtomicFileOutputStream(fout);
      for (const node of noPrintList) {
        node.style.removeProperty("display");
      }
    }
    this.message = "about-webrtc-save-page-msg";
    this.messageArgs = { path: FilePicker.file.path };
    this.update();
  }
}

class DebugMode extends Control {
  constructor() {
    super();
    this.messageHeader = "about-webrtc-debug-mode-msg-label";

    if (WGI.debugLevel > 0) {
      this.setState(true);
    } else {
      this.label = "about-webrtc-debug-mode-off-state-label";
    }
  }

  setState(state) {
    this.label = state
      ? "about-webrtc-debug-mode-on-state-label"
      : "about-webrtc-debug-mode-off-state-label";
    try {
      const file = Services.prefs.getCharPref("media.webrtc.debug.log_file");
      this.message = state
        ? "about-webrtc-debug-mode-on-state-msg"
        : "about-webrtc-debug-mode-off-state-msg";
      this.messageArgs = { path: file };
    } catch (e) {
      this.message = null;
    }
    return state;
  }

  onClick() {
    this.setState((WGI.debugLevel = WGI.debugLevel ? 0 : WEBRTC_TRACE_ALL));
    this.update();
  }
}

class AecLogging extends Control {
  constructor() {
    super();
    this.messageHeader = "about-webrtc-aec-logging-msg-label";

    if (WGI.aecDebug) {
      this.setState(true);
    } else {
      this.label = "about-webrtc-aec-logging-off-state-label";
      this.message = null;
    }
  }

  setState(state) {
    this.label = state
      ? "about-webrtc-aec-logging-on-state-label"
      : "about-webrtc-aec-logging-off-state-label";
    try {
      if (!state) {
        const file = WGI.aecDebugLogDir;
        this.message = "about-webrtc-aec-logging-off-state-msg";
        this.messageArgs = { path: file };
      } else {
        this.message = "about-webrtc-aec-logging-on-state-msg";
      }
    } catch (e) {
      this.message = null;
    }
  }

  onClick() {
    this.setState((WGI.aecDebug = !WGI.aecDebug));
    this.update();
  }
}

class ShowTab extends Control {
  constructor(browserId) {
    super();
    this.label = "about-webrtc-show-tab-label";
    this.message = null;
    this.browserId = browserId;
  }

  onClick() {
    const globalBrowser =
      window.ownerGlobal.browsingContext.topChromeWindow.gBrowser;
    for (const tab of globalBrowser.visibleTabs) {
      if (tab.linkedBrowser && tab.linkedBrowser.browserId == this.browserId) {
        globalBrowser.selectedTab = tab;
        return;
      }
    }
    this.ctrl.disabled = true;
  }
}

(async () => {
  // Setup. Retrieve reports & log while page loads.
  const haveReports = getStats();
  const haveLog = getLog();
  await new Promise(r => (window.onload = r));
  {
    const ctrl = renderElement("div", { className: "control" });
    const msg = renderElement("div", { className: "message" });
    const add = ([control, message]) => {
      ctrl.appendChild(control);
      msg.appendChild(message);
    };
    add(new SavePage().render());
    add(new DebugMode().render());
    add(new AecLogging().render());
    // Add the autorefresh checkbox and its label
    const autorefresh = document.createElement("input");
    Object.assign(autorefresh, {
      type: "checkbox",
      id: "autorefresh",
      checked: true,
    });
    const autorefreshLabel = document.createElement("label");
    document.l10n.setAttributes(
      autorefreshLabel,
      "about-webrtc-auto-refresh-label"
    );

    const ctrls = document.querySelector("#controls");
    ctrls.append(renderElements("div", { className: "controls" }, [ctrl, msg]));
    ctrls.appendChild(autorefresh);
    ctrls.appendChild(autorefreshLabel);
  }

  // Render pcs and log
  let reports = await haveReports;
  let log = await haveLog;

  reports.sort((a, b) => a.browserId - b.browserId);

  let peerConnections = renderElement("div");
  let connectionLog = renderElement("div");
  let userPrefs = renderElement("div");

  const content = document.querySelector("#content");
  content.append(peerConnections, connectionLog, userPrefs);

  // This does not handle the auto-refresh, only the manual refreshes needed
  // for certain user actions, and the initial population of the data
  function refresh() {
    const pcDiv = renderElements("div", { className: "stats" }, [
      renderElements("span", { className: "section-heading" }, [
        renderElement("h3", {}, "about-webrtc-stats-heading"),
        renderElement(
          "button",
          {
            className: "no-print",
            onclick: async () => {
              WGI.clearAllStats();
              clearStatsHistory();
              reports = await getStats(REQUEST_FULL_REFRESH);
              refresh();
            },
          },
          "about-webrtc-stats-clear"
        ),
      ]),
      ...reports.map(renderPeerConnection),
    ]);
    const logDiv = renderElements("div", { className: "log" }, [
      renderElements("span", { className: "section-heading" }, [
        renderElement("h3", {}, "about-webrtc-log-heading"),
        renderElement(
          "button",
          {
            className: "no-print",
            onclick: async () => {
              WGI.clearLogging();
              log = await getLog();
              refresh();
            },
          },
          "about-webrtc-log-clear"
        ),
      ]),
    ]);
    if (log.length) {
      const div = renderFoldableSection(logDiv, {
        showMsg: "about-webrtc-log-show-msg",
        hideMsg: "about-webrtc-log-hide-msg",
      });
      div.append(...log.map(line => renderText("p", line)));
      logDiv.append(div);
    }
    // Replace previous info
    peerConnections.replaceWith(pcDiv);
    connectionLog.replaceWith(logDiv);
    userPrefs.replaceWith((userPrefs = renderUserPrefs()));

    peerConnections = pcDiv;
    connectionLog = logDiv;
  }
  refresh();

  async function translate(element) {
    const frag = document.createDocumentFragment();
    frag.append(element);
    await document.l10n.translateFragment(frag);
    return frag;
  }

  window.setInterval(
    async hist => {
      const statReports = await getStats();
      // Only refresh if the autorefresh checkbox is checked
      if (!document.getElementById("autorefresh").checked) {
        return;
      }
      const rndr = elemRenderer;

      const translateSection = async (report, id, renderFunc) => {
        const element = document.getElementById(`${id}: ${report.pcid}`);
        const result =
          element && (await translate(renderFunc(rndr, report, hist)));
        return { element, translated: result };
      };

      const sections = (
        await Promise.all(
          statReports.flatMap(report => [
            translateSection(report, "ice-stats", renderICEStats),
            translateSection(report, "rtp-stats", renderRTPStats),
            translateSection(report, "bandwidth-stats", renderBandwidthStats),
            translateSection(report, "frame-stats", renderFrameRateStats),
          ])
        )
      ).filter(({ element }) => element);

      document.l10n.pauseObserving();
      for (const { element, translated } of sections) {
        element.replaceWith(translated);
      }
      document.l10n.resumeObserving();
    },
    250,
    {}
  );
})();

function renderPeerConnection(report) {
  const rndr = elemRenderer;
  const {
    pcid,
    browserId,
    closed: isClosed,
    timestamp,
    configuration,
  } = report;

  const pcDiv = renderElement("div", { className: "peer-connection" });
  {
    const id = pcid.match(/id=(\S+)/)[1];
    const url = pcid.match(/url=([^)]+)/)[1];
    const now = new Date(timestamp);

    pcDiv.append(
      isClosed
        ? renderElement("h3", {}, "about-webrtc-connection-closed", {
            "browser-id": browserId,
            id,
            url,
            now,
          })
        : renderElement("h3", {}, "about-webrtc-connection-open", {
            "browser-id": browserId,
            id,
            url,
            now,
          })
    );
    pcDiv.append(new ShowTab(browserId).render()[0]);
  }
  {
    const section = renderFoldableSection(pcDiv);
    section.append(
      renderElements("div", {}, [
        renderElement(
          "span",
          {
            className: "info-label",
          },
          "about-webrtc-peerconnection-id-label"
        ),
        renderText("span", pcid, { className: "info-body" }),
        renderConfiguration(rndr, configuration),
      ]),
      renderRTPStats(rndr, report),
      renderICEStats(rndr, report),
      renderSDPStats(rndr, report),
      renderBandwidthStats(rndr, report),
      renderFrameRateStats(rndr, report)
    );
    pcDiv.append(section);
  }
  return pcDiv;
}

const trimNewlines = sdp => sdp.replaceAll("\r\n", "\n");

const tabElementProps = (element, elemSubId, pcid) => ({
  className:
    elemSubId != "answer"
      ? `tab-${element}`
      : `tab-${element} active-tab-${element}`,
  id: `tab_${element}_${elemSubId}_${pcid}`,
});

const renderSDPTab = (rndr, sdp, props) =>
  rndr.elems("div", props, [rndr.text("pre", trimNewlines(sdp))]);

const renderSDPHistoryTab = (rndr, hist, props) => {
  // All SDP in sequential order. Add onclick handler to scroll the associated
  // SDP into view below.
  let first = Math.min(...hist.map(({ timestamp }) => timestamp));
  const parts = hist.map(({ isLocal, timestamp, sdp, errors: errs }) => {
    let errorsSubSect = () => [
      rndr.elem_h5({}, "about-webrtc-sdp-parsing-errors-heading"),
      ...errs.map(({ lineNumber: n, error: e }) => rndr.text_br(`${n}: ${e}`)),
    ];

    let sdpSection = [
      rndr.elem_h5({}, "about-webrtc-sdp-set-timestamp", {
        timestamp,
        "relative-timestamp": timestamp - first,
      }),
      ...(errs && errs.length ? errorsSubSect() : []),
      rndr.text_pre(trimNewlines(sdp)),
    ];

    return {
      link: rndr.elems_div({}, [
        rndr.elem_h5(
          {
            className: "sdp-history-link",
            onclick: () => sdpSection[0].scrollIntoView(),
          },
          isLocal
            ? "about-webrtc-sdp-set-at-timestamp-local"
            : "about-webrtc-sdp-set-at-timestamp-remote",
          { timestamp }
        ),
      ]),
      ...(isLocal ? { local: sdpSection } : { remote: sdpSection }),
    };
  });

  return rndr.elems_div(props, [
    // Render the links
    rndr.elems_div(
      {},
      parts.map(({ link }) => link)
    ),
    rndr.elems_div({ className: "sdp-history" }, [
      // Render the SDP into separate columns for local and remote.
      rndr.elems_div({}, [
        rndr.elem_h4({}, "about-webrtc-local-sdp-heading"),
        ...parts.filter(({ local }) => local).flatMap(({ local }) => local),
      ]),
      rndr.elems_div({}, [
        rndr.elem_h4({}, "about-webrtc-remote-sdp-heading"),
        ...parts.filter(({ remote }) => remote).flatMap(({ remote }) => remote),
      ]),
    ]),
  ]);
};

function renderSDPStats(rndr, { offerer, pcid, timestamp }) {
  // Get the most recent (as of timestamp) local and remote SDPs from the
  // history
  const sdpEntries = getSdpHistory({ pcid, timestamp });
  const localSdp = sdpEntries.findLast(({ isLocal }) => isLocal)?.sdp || "";
  const remoteSdp = sdpEntries.findLast(({ isLocal }) => !isLocal)?.sdp || "";

  const sdps = offerer
    ? { offer: localSdp, answer: remoteSdp }
    : { offer: remoteSdp, answer: localSdp };

  const sdpLabels = offerer
    ? { offer: "local", answer: "remote" }
    : { offer: "remote", answer: "local" };

  sdpLabels.l10n = {
    offer: offerer
      ? "about-webrtc-local-sdp-heading-offer"
      : "about-webrtc-remote-sdp-heading-offer",
    answer: offerer
      ? "about-webrtc-remote-sdp-heading-answer"
      : "about-webrtc-local-sdp-heading-answer",
    history: "about-webrtc-sdp-history-heading",
  };

  const tabPaneProps = elemSubId => tabElementProps("pane", elemSubId, pcid);

  const panes = {
    answer: renderSDPTab(rndr, sdps.answer, tabPaneProps("answer")),
    offer: renderSDPTab(rndr, sdps.offer, tabPaneProps("offer")),
    history: renderSDPHistoryTab(
      rndr,
      getSdpHistory({ pcid, timestamp }),
      tabPaneProps("history")
    ),
  };

  // Creates the properties and l10n label for tab buttons
  const tabButtonProps = (elemSubId, pane) => [
    {
      ...tabElementProps("button", elemSubId, pcid),
      onclick({ currentTarget: t }) {
        const flipPane = c => c.classList.toggle("active-tab-pane", c == pane);
        Object.values(panes).forEach(flipPane);
        const selButton = c => c.classList.toggle("active-tab-button", c == t);
        [...t.parentElement.children].forEach(selButton);
      },
    },
    sdpLabels.l10n[elemSubId],
  ];

  const sdpDiv = rndr.elems_div({}, [
    rndr.elem_h4({}, "about-webrtc-sdp-heading"),
  ]);
  let foldSection = renderFoldableSection(sdpDiv, {
    showMsg: "about-webrtc-show-msg-sdp",
    hideMsg: "about-webrtc-hide-msg-sdp",
  });
  foldSection.append(
    rndr.elems_div({ className: "tab-buttons" }, [
      ...Object.entries(panes).map(([elemSubId, pane]) =>
        rndr.elem_button(...tabButtonProps(elemSubId, pane))
      ),
      ...Object.values(panes),
    ])
  );
  sdpDiv.append(foldSection);

  return sdpDiv;
}

function renderBandwidthStats(rndr, report) {
  const statsDiv = renderElement("div", {
    id: "bandwidth-stats: " + report.pcid,
  });
  const table = renderSimpleTable(
    "",
    [
      "about-webrtc-track-identifier",
      "about-webrtc-send-bandwidth-bytes-sec",
      "about-webrtc-receive-bandwidth-bytes-sec",
      "about-webrtc-max-padding-bytes-sec",
      "about-webrtc-pacer-delay-ms",
      "about-webrtc-round-trip-time-ms",
    ],
    report.bandwidthEstimations.map(stat => [
      stat.trackIdentifier,
      stat.sendBandwidthBps,
      stat.receiveBandwidthBps,
      stat.maxPaddingBps,
      stat.pacerDelayMs,
      stat.rttMs,
    ])
  );
  statsDiv.append(
    renderElement("h4", {}, "about-webrtc-bandwidth-stats-heading"),
    table
  );
  return statsDiv;
}

function renderFrameRateStats(rndr, report) {
  const statsDiv = renderElement("div", { id: "frame-stats: " + report.pcid });
  report.videoFrameHistories.forEach(hist => {
    const stats = hist.entries.map(stat => {
      stat.elapsed = stat.lastFrameTimestamp - stat.firstFrameTimestamp;
      if (stat.elapsed < 1) {
        stat.elapsed = "0.00";
      }
      stat.elapsed = (stat.elapsed / 1_000).toFixed(3);
      if (stat.elapsed && stat.consecutiveFrames) {
        stat.avgFramerate = (stat.consecutiveFrames / stat.elapsed).toFixed(2);
      } else {
        stat.avgFramerate = "0.00";
      }
      return stat;
    });

    const table = renderSimpleTable(
      "",
      [
        "about-webrtc-width-px",
        "about-webrtc-height-px",
        "about-webrtc-consecutive-frames",
        "about-webrtc-time-elapsed",
        "about-webrtc-estimated-framerate",
        "about-webrtc-rotation-degrees",
        "about-webrtc-first-frame-timestamp",
        "about-webrtc-last-frame-timestamp",
        "about-webrtc-local-receive-ssrc",
        "about-webrtc-remote-send-ssrc",
      ],
      stats.map(stat =>
        [
          stat.width,
          stat.height,
          stat.consecutiveFrames,
          stat.elapsed,
          stat.avgFramerate,
          stat.rotationAngle,
          stat.firstFrameTimestamp,
          stat.lastFrameTimestamp,
          stat.localSsrc,
          stat.remoteSsrc || "?",
        ].map(entry => (Object.is(entry, undefined) ? "<<undefined>>" : entry))
      )
    );

    statsDiv.append(
      renderElement("h4", {}, "about-webrtc-frame-stats-heading", {
        "track-identifier": hist.trackIdentifier,
      }),
      table
    );
  });

  return statsDiv;
}

function renderRTPStats(rndr, report, hist) {
  const rtpStats = [
    ...(report.inboundRtpStreamStats || []),
    ...(report.outboundRtpStreamStats || []),
  ];
  const remoteRtpStats = [
    ...(report.remoteInboundRtpStreamStats || []),
    ...(report.remoteOutboundRtpStreamStats || []),
  ];

  // Generate an id-to-streamStat index for each remote streamStat. This will
  // be used next to link the remote to its local side.
  const remoteRtpStatsMap = {};
  for (const stat of remoteRtpStats) {
    remoteRtpStatsMap[stat.id] = stat;
  }

  // If a streamStat has a remoteId attribute, create a remoteRtpStats
  // attribute that references the remote streamStat entry directly.
  // That is, the index generated above is merged into the returned list.
  for (const stat of rtpStats.filter(s => "remoteId" in s)) {
    stat.remoteRtpStats = remoteRtpStatsMap[stat.remoteId];
  }
  for (const stat of rtpStats.filter(s => "codecId" in s)) {
    stat.codecStat = report.codecStats.find(({ id }) => id == stat.codecId);
  }
  const graphsByStat = stat =>
    (graphData[report.pcid]?.getGraphDataById(stat.id) || []).map(gd => {
      // For some (remote) graphs data comes in slowly.
      // Those graphs can be larger to show trends.
      const histSecs = gd.getConfig().histSecs;
      const canvas = rndr.elem_canvas({
        width: (histSecs > 30 ? histSecs / 3 : 15) * 20,
        height: 100,
        className: "line-graph",
      });
      const graph = new GraphImpl(canvas, canvas.width, canvas.height);
      graph.startTime = () => stat.timestamp - histSecs * 1000;
      graph.stopTime = () => stat.timestamp;
      if (gd.subKey == "packetsLost") {
        const oldMaxColor = graph.maxColor;
        graph.maxColor = data => (data.value == 0 ? "red" : oldMaxColor(data));
      }
      // Get a bit more history for averages (20%)
      const dataSet = gd.getDataSetSince(
        graph.startTime() - histSecs * 0.2 * 1000
      );
      graph.drawSparseValues(dataSet, gd.subKey, gd.getConfig());
      return canvas;
    });
  // Render stats set
  return renderElements("div", { id: "rtp-stats: " + report.pcid }, [
    renderElement("h4", {}, "about-webrtc-rtp-stats-heading"),
    ...rtpStats.map(stat => {
      const { ssrc, remoteId, remoteRtpStats: rtcpStats } = stat;
      const remoteGraphs = rtcpStats
        ? [
            rndr.elems_div({}, [
              rndr.text_h6(rtcpStats.type),
              ...graphsByStat(rtcpStats),
            ]),
          ]
        : [];
      const mime = stat?.codecStat?.mimeType?.concat(" - ") || "";
      const div = renderElements("div", {}, [
        rndr.text_h5(`${mime}SSRC ${ssrc}`),
        rndr.elems_div({}, [rndr.text_h6(stat.type), ...graphsByStat(stat)]),
        ...remoteGraphs,
        renderCodecStats(stat),
        renderTransportStats(stat, true, hist),
      ]);
      if (remoteId && rtcpStats) {
        div.append(renderTransportStats(rtcpStats, false));
      }
      return div;
    }),
  ]);
}

function renderCodecStats({
  codecStat,
  framesEncoded,
  framesDecoded,
  framesDropped,
  discardedPackets,
  packetsReceived,
}) {
  let elements = [];

  if (codecStat) {
    elements.push(
      renderText("span", `${codecStat.payloadType} ${codecStat.mimeType}`, {})
    );
    if (framesEncoded !== undefined || framesDecoded !== undefined) {
      elements.push(
        renderElement(
          "span",
          { className: "stat-label" },
          "about-webrtc-frames",
          {
            frames: framesEncoded || framesDecoded || 0,
          }
        )
      );
    }
    if (codecStat.channels !== undefined) {
      elements.push(
        renderElement(
          "span",
          { className: "stat-label" },
          "about-webrtc-channels",
          {
            channels: codecStat.channels,
          }
        )
      );
    }
    elements.push(
      renderText(
        "span",
        ` ${codecStat.clockRate} ${codecStat.sdpFmtpLine || ""}`,
        {}
      )
    );
  }
  if (framesDropped !== undefined) {
    elements.push(
      renderElement(
        "span",
        { className: "stat-label" },
        "about-webrtc-dropped-frames-label"
      )
    );
    elements.push(renderText("span", ` ${framesDropped}`, {}));
  }
  if (discardedPackets !== undefined) {
    elements.push(
      renderElement(
        "span",
        { className: "stat-label" },
        "about-webrtc-discarded-packets-label"
      )
    );
    elements.push(renderText("span", ` ${discardedPackets}`, {}));
  }
  if (elements.length) {
    if (packetsReceived !== undefined) {
      elements.unshift(
        renderElement("span", {}, "about-webrtc-decoder-label"),
        renderText("span", ": ")
      );
    } else {
      elements.unshift(
        renderElement("span", {}, "about-webrtc-encoder-label"),
        renderText("span", ": ")
      );
    }
  }
  return renderElements("div", {}, elements);
}

function renderTransportStats(
  {
    id,
    timestamp,
    type,
    packetsReceived,
    bytesReceived,
    packetsLost,
    jitter,
    roundTripTime,
    packetsSent,
    bytesSent,
  },
  local,
  hist
) {
  if (hist) {
    if (hist[id] === undefined) {
      hist[id] = {};
    }
  }

  const estimateKBps = (curTimestamp, lastTimestamp, bytes, lastBytes) => {
    if (!curTimestamp || !lastTimestamp || !bytes || !lastBytes) {
      return "0.0";
    }
    const elapsedTime = curTimestamp - lastTimestamp;
    if (elapsedTime <= 0) {
      return "0.0";
    }
    return ((bytes - lastBytes) / elapsedTime).toFixed(1);
  };

  let elements = [];

  if (local) {
    elements.push(
      renderElement("span", {}, "about-webrtc-type-local"),
      renderText("span", ": ")
    );
  } else {
    elements.push(
      renderElement("span", {}, "about-webrtc-type-remote"),
      renderText("span", ": ")
    );
  }

  const time = new Date(timestamp).toTimeString();
  elements.push(renderText("span", `${time} ${type}`));

  if (packetsReceived) {
    elements.push(
      renderElement(
        "span",
        { className: "stat-label" },
        "about-webrtc-received-label",
        {
          packets: packetsReceived,
        }
      )
    );

    if (bytesReceived) {
      let s = ` (${(bytesReceived / 1024).toFixed(2)} Kb`;
      if (local && hist) {
        s += ` , ${estimateKBps(
          timestamp,
          hist[id].lastTimestamp,
          bytesReceived,
          hist[id].lastBytesReceived
        )} KBps`;
      }
      s += ")";
      elements.push(renderText("span", s));
    }

    elements.push(
      renderElement(
        "span",
        { className: "stat-label" },
        "about-webrtc-lost-label",
        {
          packets: packetsLost,
        }
      )
    );
    elements.push(
      renderElement(
        "span",
        { className: "stat-label" },
        "about-webrtc-jitter-label",
        {
          jitter,
        }
      )
    );

    if (roundTripTime !== undefined) {
      elements.push(renderText("span", ` RTT: ${roundTripTime * 1000} ms`));
    }
  } else if (packetsSent) {
    elements.push(
      renderElement(
        "span",
        { className: "stat-label" },
        "about-webrtc-sent-label",
        {
          packets: packetsSent,
        }
      )
    );
    if (bytesSent) {
      let s = ` (${(bytesSent / 1024).toFixed(2)} Kb`;
      if (local && hist) {
        s += `, ${estimateKBps(
          timestamp,
          hist[id].lastTimestamp,
          bytesSent,
          hist[id].lastBytesSent
        )} KBps`;
      }
      s += ")";
      elements.push(renderText("span", s));
    }
  }

  // Update history
  if (hist) {
    hist[id].lastBytesReceived = bytesReceived;
    hist[id].lastBytesSent = bytesSent;
    hist[id].lastTimestamp = timestamp;
  }

  return renderElements("div", {}, elements);
}

function renderRawIceTable(caption, candidates) {
  const table = renderSimpleTable(
    "",
    [caption],
    [...new Set(candidates.sort())].filter(i => i).map(i => [i])
  );
  table.className = "raw-candidate";
  return table;
}

function renderConfiguration(rndr, c) {
  const provided = "about-webrtc-configuration-element-provided";
  const notProvided = "about-webrtc-configuration-element-not-provided";

  // Create the text for a configuration field
  const cfg = (obj, key) => [
    renderElement("br"),
    `${key}: `,
    key in obj ? obj[key] : renderElement("i", {}, notProvided),
  ];

  // Create the text for a fooProvided configuration field
  const pro = (obj, key) => [
    renderElement("br"),
    `${key}(`,
    renderElement("i", {}, provided),
    `/`,
    renderElement("i", {}, notProvided),
    `): `,
    renderElement("i", {}, obj[`${key}Provided`] ? provided : notProvided),
  ];

  const confDiv = rndr.elem_div({ display: "contents" });
  let disclosure = renderFoldableSection(confDiv, {
    showMsg: "about-webrtc-pc-configuration-show-msg",
    hideMsg: "about-webrtc-pc-configuration-hide-msg",
  });
  disclosure.append(
    rndr.elems_div({ classList: "peer-connection-config" }, [
      "RTCConfiguration",
      ...cfg(c, "bundlePolicy"),
      ...cfg(c, "iceTransportPolicy"),
      ...pro(c, "peerIdentity"),
      ...cfg(c, "sdpSemantics"),
      renderElement("br"),
      "iceServers: ",
      ...(!c.iceServers
        ? [renderElement("i", {}, notProvided)]
        : c.iceServers.map(i =>
            renderElements("div", {}, [
              `urls: ${JSON.stringify(i.urls)}`,
              ...pro(i, "credential"),
              ...pro(i, "userName"),
            ])
          )),
    ])
  );
  confDiv.append(disclosure);
  return confDiv;
}

function renderICEStats(rndr, report) {
  const iceDiv = renderElements("div", { id: "ice-stats: " + report.pcid }, [
    renderElement("h4", {}, "about-webrtc-ice-stats-heading"),
  ]);

  // Render ICECandidate table
  {
    const caption = renderElement(
      "caption",
      { className: "no-print" },
      "about-webrtc-trickle-caption-msg"
    );

    // Generate ICE stats
    const stats = [];
    {
      // Create an index based on candidate ID for each element in the
      // iceCandidateStats array.
      const candidates = {};
      for (const candidate of report.iceCandidateStats) {
        candidates[candidate.id] = candidate;
      }

      // a method to see if a given candidate id is in the array of tickled
      // candidates.
      const isTrickled = candidateId =>
        report.trickledIceCandidateStats.some(({ id }) => id == candidateId);

      // A component may have a remote or local candidate address or both.
      // Combine those with both; these will be the peer candidates.
      const matched = {};

      for (const {
        localCandidateId,
        remoteCandidateId,
        componentId,
        state,
        priority,
        nominated,
        selected,
        bytesSent,
        bytesReceived,
      } of report.iceCandidatePairStats) {
        const local = candidates[localCandidateId];
        if (local) {
          const stat = {
            ["local-candidate"]: candidateToString(local),
            componentId,
            state,
            priority,
            nominated,
            selected,
            bytesSent,
            bytesReceived,
          };
          matched[local.id] = true;
          if (isTrickled(local.id)) {
            stat["local-trickled"] = true;
          }

          const remote = candidates[remoteCandidateId];
          if (remote) {
            stat["remote-candidate"] = candidateToString(remote);
            matched[remote.id] = true;
            if (isTrickled(remote.id)) {
              stat["remote-trickled"] = true;
            }
          }
          stats.push(stat);
        }
      }

      // sort (group by) componentId first, then bytesSent if available, else by
      // priority
      stats.sort((a, b) => {
        if (a.componentId != b.componentId) {
          return a.componentId - b.componentId;
        }
        return b.bytesSent
          ? b.bytesSent - (a.bytesSent || 0)
          : (b.priority || 0) - (a.priority || 0);
      });
    }
    // Render ICE stats
    // don't use |stat.x || ""| here because it hides 0 values
    const statsTable = renderSimpleTable(
      caption,
      [
        "about-webrtc-ice-state",
        "about-webrtc-nominated",
        "about-webrtc-selected",
        "about-webrtc-local-candidate",
        "about-webrtc-remote-candidate",
        "about-webrtc-ice-component-id",
        "about-webrtc-priority",
        "about-webrtc-ice-pair-bytes-sent",
        "about-webrtc-ice-pair-bytes-received",
      ],
      stats.map(stat =>
        [
          stat.state,
          stat.nominated,
          stat.selected,
          stat["local-candidate"],
          stat["remote-candidate"],
          stat.componentId,
          stat.priority,
          stat.bytesSent,
          stat.bytesReceived,
        ].map(entry => (Object.is(entry, undefined) ? "" : entry))
      )
    );

    // after rendering the table, we need to change the class name for each
    // candidate pair's local or remote candidate if it was trickled.
    let index = 0;
    for (const {
      state,
      nominated,
      selected,
      "local-trickled": localTrickled,
      "remote-trickled": remoteTrickled,
    } of stats) {
      // look at statsTable row index + 1 to skip column headers
      const { cells } = statsTable.rows[++index];
      cells[0].className = `ice-${state}`;
      if (nominated) {
        cells[1].className = "ice-succeeded";
      }
      if (selected) {
        cells[2].className = "ice-succeeded";
      }
      if (localTrickled) {
        cells[3].className = "ice-trickled";
      }
      if (remoteTrickled) {
        cells[4].className = "ice-trickled";
      }
    }

    // if the current row's component id changes, mark the bottom of the
    // previous row with a thin, black border to differentiate the
    // component id grouping.
    let previousRow;
    for (const row of statsTable.rows) {
      if (previousRow) {
        if (previousRow.cells[5].innerHTML != row.cells[5].innerHTML) {
          previousRow.className = "bottom-border";
        }
      }
      previousRow = row;
    }
    iceDiv.append(statsTable);
  }
  // restart/rollback counts.
  iceDiv.append(
    renderIceMetric("about-webrtc-ice-restart-count-label", report.iceRestarts),
    renderIceMetric(
      "about-webrtc-ice-rollback-count-label",
      report.iceRollbacks
    )
  );

  // Render raw ICECandidate section
  {
    const section = renderElements("div", {}, [
      renderElement("h4", {}, "about-webrtc-raw-candidates-heading"),
    ]);
    const foldSection = renderFoldableSection(section, {
      showMsg: "about-webrtc-raw-cand-show-msg",
      hideMsg: "about-webrtc-raw-cand-hide-msg",
    });

    // render raw candidates
    foldSection.append(
      renderElements("div", {}, [
        renderRawIceTable(
          "about-webrtc-raw-local-candidate",
          report.rawLocalCandidates
        ),
        renderRawIceTable(
          "about-webrtc-raw-remote-candidate",
          report.rawRemoteCandidates
        ),
      ])
    );
    section.append(foldSection);
    iceDiv.append(section);
  }
  return iceDiv;
}

function renderIceMetric(label, value) {
  return renderElements("div", {}, [
    renderElement("span", { className: "info-label" }, label),
    renderText("span", value, { className: "info-body" }),
  ]);
}

function candidateToString({
  type,
  address,
  port,
  protocol,
  candidateType,
  relayProtocol,
  proxied,
} = {}) {
  if (!type) {
    return "*";
  }
  if (relayProtocol) {
    candidateType = `${candidateType}-${relayProtocol}`;
  }
  proxied = type == "local-candidate" ? ` [${proxied}]` : "";
  return `${address}:${port}/${protocol}(${candidateType})${proxied}`;
}

function renderUserPrefs() {
  const getPref = key => {
    switch (Services.prefs.getPrefType(key)) {
      case Services.prefs.PREF_BOOL:
        return Services.prefs.getBoolPref(key);
      case Services.prefs.PREF_INT:
        return Services.prefs.getIntPref(key);
      case Services.prefs.PREF_STRING:
        return Services.prefs.getStringPref(key);
    }
    return "";
  };
  const prefs = [
    "media.aboutwebrtc",
    "media.peerconnection",
    "media.navigator",
    "media.getusermedia",
    "media.gmp-gmpopenh264.enabled",
  ];
  const renderPref = p => renderText("p", `${p}: ${getPref(p)}`);
  const display = prefs
    .flatMap(Services.prefs.getChildList)
    .filter(Services.prefs.prefHasUserValue)
    .map(renderPref);
  return renderElements(
    "div",
    {
      id: "prefs",
      className: "prefs",
      style: display.length ? "" : "visibility:hidden",
    },
    [
      renderElements("span", { className: "section-heading" }, [
        renderElement(
          "h3",
          {},
          "about-webrtc-custom-webrtc-configuration-heading"
        ),
      ]),
      ...display,
    ]
  );
}

function renderFoldableSection(parentElem, options = {}) {
  const section = renderElement("div");
  if (parentElem) {
    const ctrl = renderElements("div", { className: "section-ctrl no-print" }, [
      new FoldEffect(section, options).render(),
    ]);
    parentElem.append(ctrl);
  }
  return section;
}

function renderSimpleTable(caption, headings, data) {
  const heads = headings.map(text => renderElement("th", {}, text));
  const renderCell = text => renderText("td", text);

  return renderElements("table", {}, [
    caption,
    renderElements("tr", {}, heads),
    ...data.map(line => renderElements("tr", {}, line.map(renderCell))),
  ]);
}

class FoldEffect {
  constructor(
    target,
    {
      showMsg = "about-webrtc-fold-show-msg",
      hideMsg = "about-webrtc-fold-hide-msg",
    } = {}
  ) {
    Object.assign(this, { target, showMsg, hideMsg });
  }

  render() {
    this.target.classList.add("fold-target");
    this.trigger = renderElement("div", { className: "fold-trigger" });
    this.trigger.classList.add(this.showMsg, this.hideMsg);
    this.collapse();
    this.trigger.onclick = () => {
      if (this.target.classList.contains("fold-closed")) {
        this.expand();
      } else {
        this.collapse();
      }
    };
    return this.trigger;
  }

  expand() {
    this.target.classList.remove("fold-closed");
    document.l10n.setAttributes(this.trigger, this.hideMsg);
  }

  collapse() {
    this.target.classList.add("fold-closed");
    document.l10n.setAttributes(this.trigger, this.showMsg);
  }

  static expandAll() {
    for (const target of document.getElementsByClassName("fold-closed")) {
      target.classList.remove("fold-closed");
    }
    for (const trigger of document.getElementsByClassName("fold-trigger")) {
      const hideMsg = trigger.classList[2];
      document.l10n.setAttributes(trigger, hideMsg);
    }
  }

  static collapseAll() {
    for (const target of document.getElementsByClassName("fold-target")) {
      target.classList.add("fold-closed");
    }
    for (const trigger of document.getElementsByClassName("fold-trigger")) {
      const showMsg = trigger.classList[1];
      document.l10n.setAttributes(trigger, showMsg);
    }
  }
}
