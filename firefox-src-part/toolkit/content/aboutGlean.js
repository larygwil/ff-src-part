/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Docs: https://devdocs.io/d3~3/
Services.scriptloader.loadSubScript(
  "chrome://global/content/third_party/d3/d3.js"
);
const d3 = this.d3;

const { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);

let REDESIGN_ENABLED = false;
const METRIC_DATA = {};
let MAPPED_METRIC_DATA = [];
let FILTERED_METRIC_DATA = [];
let LIMITED_METRIC_DATA = [];
let LIMIT_OFFSET = 0;
let LIMIT_COUNT = 200;
let METRIC_DATA_INITIALIZED = false;
const INVALID_VALUE_REASONS = {
  LABELED_METRIC: 0,
  UNKNOWN_METRIC: 1,
};
const SIMPLE_TYPES = {
  Boolean: "Boolean",
  String: "String",
  StringList: "StringList",
  Text: "Text",
  Counter: "Counter",
};
const SELECTED_METRICS = [];
let DOCUMENT_BODY_SEL = undefined;

function updatePrefsAndDefines() {
  let upload = Services.prefs.getBoolPref(
    "datareporting.healthreport.uploadEnabled"
  );
  document.l10n.setAttributes(
    document.querySelector("[data-l10n-id='about-glean-data-upload']"),
    "about-glean-data-upload",
    {
      "data-upload-pref-value": upload,
    }
  );
  let port = Services.prefs.getIntPref("telemetry.fog.test.localhost_port");
  document.l10n.setAttributes(
    document.querySelector("[data-l10n-id='about-glean-local-port']"),
    "about-glean-local-port",
    {
      "local-port-pref-value": port,
    }
  );
  document.l10n.setAttributes(
    document.querySelector("[data-l10n-id='about-glean-glean-android']"),
    "about-glean-glean-android",
    { "glean-android-define-value": AppConstants.MOZ_GLEAN_ANDROID }
  );
  document.l10n.setAttributes(
    document.querySelector("[data-l10n-id='about-glean-moz-official']"),
    "about-glean-moz-official",
    { "moz-official-define-value": AppConstants.MOZILLA_OFFICIAL }
  );

  // Knowing what we know, and copying logic from viaduct_uploader.rs,
  // (which is documented in Preferences and Defines),
  // tell the fine user whether and why upload is disabled.
  let uploadMessageEl = document.getElementById("upload-status");
  let uploadL10nId = "about-glean-upload-enabled";
  if (!upload) {
    uploadL10nId = "about-glean-upload-disabled";
  } else if (port < 0 || (port == 0 && !AppConstants.MOZILLA_OFFICIAL)) {
    uploadL10nId = "about-glean-upload-fake-enabled";
    // This message has a link to the Glean Debug Ping Viewer in it.
    // We must add the anchor element now so that Fluent can match it.
    let a = document.createElement("a");
    a.href = "https://debug-ping-preview.firebaseapp.com/";
    a.setAttribute("data-l10n-name", "glean-debug-ping-viewer");
    uploadMessageEl.appendChild(a);
  } else if (port > 0) {
    uploadL10nId = "about-glean-upload-enabled-local";
  }
  document.l10n.setAttributes(uploadMessageEl, uploadL10nId);
}

function camelToKebab(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    let c = str.charAt(i);
    if (c == c.toUpperCase()) {
      out += "-";
      c = c.toLowerCase();
    }
    out += c;
  }
  return out;
}

// I'm consciously omitting "deletion-request" until someone can come up with
// a use-case for sending it via about:glean.
const GLEAN_BUILTIN_PINGS = ["metrics", "events", "baseline"];
const NO_PING = "(don't submit any ping)";

function refillPingNames() {
  const builtInGroup = document.getElementById("builtin-pings");
  const customGroup = document.getElementById("custom-pings");

  // Add built-in ping options to the dropdown.
  GLEAN_BUILTIN_PINGS.forEach(id => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = camelToKebab(id);
    builtInGroup.appendChild(option);
  });

  // Add "(don't submit any ping)" as last built-in option in the dropdown.
  const noPingOption = document.createElement("option");
  noPingOption.value = NO_PING;
  document.l10n.setAttributes(noPingOption, "about-glean-no-ping-label");
  builtInGroup.appendChild(noPingOption);

  // Add alpha sorted custom ping options to the dropdown.
  Object.keys(GleanPings)
    .map(id => ({ id, label: camelToKebab(id) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach(({ label }) => {
      const option = document.createElement("option");
      option.textContent = label;
      customGroup.appendChild(option);
    });
}

// If there's been a previous tag, use it.
// If not, be _slightly_ clever and derive a default one from the profile dir.
function fillDebugTag() {
  const DEBUG_TAG_PREF = "telemetry.fog.aboutGlean.debugTag";
  let debugTag;
  if (Services.prefs.prefHasUserValue(DEBUG_TAG_PREF)) {
    debugTag = Services.prefs.getStringPref(DEBUG_TAG_PREF);
  } else {
    const debugTagPrefix = "about-glean-";
    const profileDir = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
    let charSum = Array.from(profileDir).reduce(
      (prev, cur) => prev + cur.charCodeAt(0),
      0
    );

    debugTag = debugTagPrefix + (charSum % 1000);
  }

  let tagInput = document.getElementById("tag-pings");
  tagInput.value = debugTag;
  const updateDebugTagValues = () => {
    document.l10n.setAttributes(
      document.querySelector(
        "[data-l10n-id='about-glean-label-for-controls-submit']"
      ),
      "about-glean-label-for-controls-submit",
      { "debug-tag": tagInput.value }
    );
    const GDPV_ROOT = "https://debug-ping-preview.firebaseapp.com/pings/";
    let gdpvLink = document.querySelector(
      "[data-l10n-name='gdpv-tagged-pings-link']"
    );
    gdpvLink.href = GDPV_ROOT + tagInput.value;
  };
  tagInput.addEventListener("change", () => {
    Services.prefs.setStringPref(DEBUG_TAG_PREF, tagInput.value);
    updateDebugTagValues();
  });
  updateDebugTagValues();
}

function showTab(button) {
  let current_tab = document.querySelector(".active");
  let category = button.getAttribute("id").substring("category-".length);
  let content = document.getElementById(category);
  if (current_tab == content) {
    return;
  }
  current_tab.classList.remove("active");
  current_tab.hidden = true;
  content.classList.add("active");
  content.hidden = false;
  let current_button = document.querySelector("[selected=true]");
  current_button.removeAttribute("selected");
  button.setAttribute("selected", "true");

  if (category == "metrics-table") {
    // Init base level metric data
    initializeMetricData();

    const table = document.getElementById("metrics-table-instance");
    table.removeAttribute("hidden");

    // Map the metric data into a better defined type structure
    MAPPED_METRIC_DATA = Object.entries(METRIC_DATA).flatMap(
      ([category, metrics]) =>
        Object.entries(metrics).map(([name, metric]) => ({
          category,
          name,
          fullName: `${category}.${name}`,
          ...metric,
        }))
    );
    updateFilteredMetricData();
    updateTable();
  }
}

function handleRedesign() {
  REDESIGN_ENABLED = Services.prefs.getBoolPref("about.glean.redesign.enabled");
  // If about:glean redesign is enabled, add the navigation category for it.
  if (REDESIGN_ENABLED) {
    const categories = document.getElementById("categories");
    const div = document.createElement("div");
    div.id = "category-metrics-table";
    div.className = "category";
    div.setAttribute("role", "menuitem");
    div.setAttribute("tabindex", 0);
    const span = document.createElement("span");
    span.className = "category-name";
    span.setAttribute("data-l10n-id", "about-glean-category-metrics-table");
    div.appendChild(span);
    categories.appendChild(div);

    document
      .getElementById("enable-new-features")
      .setAttribute("data-l10n-id", "about-glean-disable-new-features-button");

    /**
     * Handle metric filter input.
     *
     * This uses a timeout to debounce the events down to 200ms.
     * Instead of updating the DOM every time the input changes, it'll only update when the input hasn't changed in the last 200ms since it last changed.
     */
    let inputTimeout = undefined;
    document.getElementById("filter-metrics").addEventListener("input", e => {
      clearTimeout(inputTimeout);
      inputTimeout = setTimeout(() => {
        updateFilteredMetricData(e.target.value ?? "");
      }, 200);
    });

    // Handle loading all metric data
    document.getElementById("load-all").addEventListener("click", () => {
      MAPPED_METRIC_DATA.forEach(datum => {
        updateDatum(datum);
      });
      updateTable();
    });
  } else {
    document
      .getElementById("enable-new-features")
      .setAttribute("data-l10n-id", "about-glean-enable-new-features-button");
    document.getElementById("category-metrics-table")?.remove();
  }
}

function onLoad() {
  let menu = document.getElementById("categories");
  menu.addEventListener("click", function click(e) {
    if (e.target && e.target.parentNode == menu) {
      showTab(e.target);
    }
  });
  menu.addEventListener("keydown", function keypress(e) {
    if (
      e.target &&
      e.target.parentNode == menu &&
      (e.key == " " || e.key == "Enter")
    ) {
      showTab(e.target);
    }
  });
  showTab(document.getElementById("category-about-glean"));

  updatePrefsAndDefines();
  refillPingNames();
  fillDebugTag();
  document.getElementById("controls-submit").addEventListener("click", () => {
    let tag = document.getElementById("tag-pings").value;
    let log = document.getElementById("log-pings").checked;
    let ping = document.getElementById("ping-names").value;
    let feedbackToast = document.getElementById("feedback");

    Services.fog.setLogPings(log);
    Services.fog.setTagPings(tag);

    if (ping != NO_PING) {
      Services.fog.sendPing(ping);
      feedbackToast.setAttribute(
        "data-l10n-id",
        "about-glean-feedback-settings-and-ping"
      );
    } else {
      feedbackToast.setAttribute(
        "data-l10n-id",
        "about-glean-feedback-settings-only"
      );
    }

    feedbackToast.style.visibility = "visible";
    setTimeout(() => {
      feedbackToast.style.visibility = "hidden";
    }, 3000);
  });

  handleRedesign();

  DOCUMENT_BODY_SEL = d3.select(document.body);

  document
    .getElementById("enable-new-features")
    .addEventListener("click", () => {
      if (!REDESIGN_ENABLED) {
        Services.prefs.setBoolPref("about.glean.redesign.enabled", true);
      } else {
        Services.prefs.setBoolPref("about.glean.redesign.enabled", false);
      }
      handleRedesign();
    });
}

/**
 * Initializes the base level metric data.
 *
 * Should only be able to be called once.
 */
function initializeMetricData() {
  if (METRIC_DATA_INITIALIZED) {
    return;
  }
  for (let [category, metrics] of Object.entries(Glean)) {
    for (let [metricName, metric] of Object.entries(metrics)) {
      // Trim "Glean" from the constructor names (e.g. "GleanBoolean" -> "Boolean").
      let constructorName = metric.constructor.name.replace("Glean", "");
      // For labeled metrics, get their submetrics' constructor names and append it
      if (constructorName == "Labeled") {
        constructorName += metric.__other__.constructor.name.replace(
          "Glean",
          ""
        );
      }
      if (!METRIC_DATA[category]) {
        METRIC_DATA[category] = {};
      }
      METRIC_DATA[category][metricName] = {
        type: constructorName,
        value: undefined,
        metric,
      };
    }
  }
  METRIC_DATA_INITIALIZED = true;
}

function updateButtonsSelection(selection) {
  selection.attr("data-l10n-id", d =>
    d.watching ? "about-glean-button-unwatch" : "about-glean-button-watch"
  );
}

function createOrUpdateHistogram(selection, datum) {
  const values = Object.entries(datum.value?.values || {}).map((d, i) => [
    ...d,
    i,
  ]);

  if (!values || values.length === 0) {
    selection.select("p")?.remove();
    selection
      .append("p")
      .attr("data-l10n-id", "about-glean-no-data-to-display");
    selection.select("svg")?.remove();
    return;
  }
  selection.select("p")?.remove();

  const max = values.map(d => d[1]).sort((a, b) => b - a)[0],
    keyMax = values.map(d => d[0]).sort((a, b) => b - a)[0],
    boxWidth = Math.max(`${Math.max(max, keyMax)}`.length * 10, 30),
    boxPadding = 5,
    chartMax = 150,
    leftPadding = 20,
    chartPadding = 50,
    scaledMax = 110,
    denom = max / scaledMax;

  let hist = selection.select(`svg[data-d3-datum='${datum.fullName}']`);
  if (hist.empty()) {
    hist = selection
      .append("svg")
      .classed({ histogram: true })
      .attr("data-d3-datum", datum.fullName)
      .attr(
        "width",
        values.length * (boxWidth + boxPadding) + chartPadding + leftPadding
      )
      .attr("height", chartMax + chartPadding);
  }

  let boxesContainer = hist.select("g.boxes");
  if (boxesContainer.empty()) {
    boxesContainer = hist.append("g").classed({ boxes: true });
  }

  const boxes = boxesContainer.selectAll("g").data(values, d => d);

  const newBoxes = boxes.enter().append("g").attr("tabindex", 0);
  newBoxes.append("rect").attr("width", boxWidth);
  newBoxes.append("text").attr("data-d3-role", "y");
  newBoxes.append("text").attr("data-d3-role", "x");

  const xFn = index => boxWidth * index + boxPadding * index + leftPadding;
  const yFn = yv =>
    Math.abs(Math.max(yv / denom, 1) - scaledMax) + (chartMax - scaledMax);

  boxes
    .selectAll("rect")
    .attr("height", d => Math.max(d[1] / denom, 1))
    .attr("x", (_, __, i) => xFn(i))
    .attr("y", d => yFn(d[1]));
  boxes
    .selectAll("text[data-d3-role=y]")
    .attr("x", (_, __, i) => xFn(i))
    .attr("y", d => yFn(d[1]) - 5)
    .text(d => d[1]);
  boxes
    .selectAll("text[data-d3-role=x]")
    .attr("x", d => xFn(d[2]))
    .attr("y", chartMax + 20)
    .text(d => d[0]);

  function focusStart(_) {
    this.classList.add("hovered");
  }

  function focusEnd(_) {
    this.classList.remove("hovered");
  }

  boxes
    .attr("data-d3-box", d => d[0])
    .on("focusin", focusStart)
    .on("mouseover", focusStart)
    .on("focusout", focusEnd)
    .on("mouseout", focusEnd);

  boxes.exit().remove();
}

function createOrUpdateEventChart(selection, datum) {
  const values = (datum.value || []).map((d, i) => ({
    ...d,
    index: i,
    fullName: datum.fullName,
  }));

  if (!values || values.length === 0) {
    selection.select("p")?.remove();
    selection
      .append("p")
      .attr("data-l10n-id", "about-glean-no-data-to-display");
    selection.select("svg")?.remove();
    return;
  }
  selection.select("p")?.remove();

  const height = 75,
    width = 500,
    max = values.map(d => d.timestamp).sort((a, b) => b - a)[0],
    min = values.map(d => d.timestamp).sort((a, b) => a - b)[0],
    chartPadding = 50,
    circleRadius = 6;

  let diagram = selection.select(`svg[data-d3-datum='${datum.fullName}']`);
  if (diagram.empty()) {
    diagram = selection
      .append("svg")
      .classed({ timeline: true })
      .attr("data-d3-datum", datum.fullName)
      .attr("width", width)
      .attr("height", height);
    diagram
      .append("line")
      .attr("x1", chartPadding)
      .attr("y1", height / 2)
      .attr("x2", width - chartPadding)
      .attr("y2", height / 2);
    diagram
      .append("line")
      .attr("x1", chartPadding + 10)
      .attr("y1", height / 2 - 10)
      .attr("x2", chartPadding + 10)
      .attr("y2", height / 2 + 10);
    diagram
      .append("line")
      .attr("x1", width - chartPadding - 10)
      .attr("y1", height / 2 - 10)
      .attr("x2", width - chartPadding - 10)
      .attr("y2", height / 2 + 10);
  }

  let code = selection.select("pre");
  if (code.empty()) {
    code = selection.append("pre").classed({ withChart: true }).append("code");
  } else {
    code = code.select("code");
  }

  const xFn = d3.scale
    .linear()
    .domain([min, max])
    .range([10 + chartPadding, width - chartPadding - 10]);

  let eventsContainer = diagram.select("g.events");
  if (eventsContainer.empty()) {
    eventsContainer = diagram.append("g").classed({ events: true });
  }

  const events = eventsContainer
    .selectAll("g.event")
    .data(values, d => `${d.fullName}-${d.index}-${d.timestamp}`);

  const newEvents = events
    .enter()
    .append("g")
    .classed({ event: true })
    .attr("tabindex", 0);

  newEvents
    .append("circle")
    .attr("cy", height / 2)
    .attr("r", circleRadius);

  function focusStart(_) {
    this.classList.add("hovered");
  }

  function focusEnd(_) {
    this.classList.remove("hovered");
  }

  function select(_) {
    const dataPoint = this.__data__;
    code.text(prettyPrint(dataPoint.extra));

    document.querySelectorAll("g.event.selected").forEach(el => {
      el.classList.remove("selected");
      el.querySelector("text")?.remove();
    });
    this.classList.add("selected");

    const text = this.appendChild(
      document.createElementNS("http://www.w3.org/2000/svg", "text")
    );
    text.setAttribute("y", height / 2 + 25);
    text.setAttribute(
      "x",
      xFn(dataPoint.timestamp) - `${dataPoint.timestamp}`.length * 4.5
    );
    text.textContent = dataPoint.timestamp;
  }

  events.attr("data-d3-datum", d => `${d.fullName}-${d.index}-${d.timestamp}`);

  events.selectAll("circle").attr("cx", d => xFn(d.timestamp));

  events
    .on("focusin", select)
    .on("mouseover", focusStart)
    .on("focusout", focusEnd)
    .on("mouseout", focusEnd);

  events.exit().remove();
}

function updateValueSelection(selection) {
  // Set the `data-l10n-id` attribute to the appropriate warning if the value is invalid, otherwise
  // unset it by returning `null`.
  selection
    ?.attr("data-l10n-id", d => {
      switch (d.invalidValue) {
        case INVALID_VALUE_REASONS.LABELED_METRIC:
          return "about-glean-labeled-metric-warning";
        case INVALID_VALUE_REASONS.UNKNOWN_METRIC:
          return "about-glean-unknown-metric-type-warning";
        default:
          return null;
      }
    })
    ?.each(function (datum) {
      if (datum.loaded) {
        let codeSelection = d3.select(this).select("pre>code");
        switch (datum.type) {
          case "Event":
            createOrUpdateEventChart(d3.select(this), datum);
            break;
          case "CustomDistribution":
          case "MemoryDistribution":
          case "TimingDistribution":
            createOrUpdateHistogram(d3.select(this), datum);
            break;
          default:
            if (codeSelection.empty()) {
              codeSelection = d3.select(this).append("pre").append("code");
            }
            codeSelection.text(prettyPrint(datum.value));
        }
      }
    });
}

/**
 * Updates a datum object with its value from `testGetValue`.
 *
 * @param {*} datum the datum object to update
 * @param {*} update update the table after updating the datum (defaults to `true`)
 */
function updateDatum(datum) {
  if (typeof datum.metric.testGetValue == "function") {
    try {
      datum.value = datum.metric.testGetValue();
      datum.error = undefined;
    } catch (e) {
      datum.error = e;
    }
    datum.loaded = true;
    datum.invalidValue = undefined;
  } else if (datum.type.includes("Labeled")) {
    datum.invalidValue = INVALID_VALUE_REASONS.LABELED_METRIC;
  } else {
    datum.invalidValue = INVALID_VALUE_REASONS.UNKNOWN_METRIC;
  }

  updateValueSelection(
    DOCUMENT_BODY_SEL.select(
      `tr[data-d3-row="${datum.fullName}"]>td[data-d3-cell=value]`
    )
  );
}

/**
 * Prettifies a JSON value to make it render more nicely in the table.
 *
 * @param {*} jsonValue the JSON value to prettify
 * @returns a string containing the prettified JSON value in a pre+code
 */
function prettyPrint(jsonValue) {
  if (typeof jsonValue == "object") {
    jsonValue = Object.keys(jsonValue ?? {})
      .sort()
      .reduce((obj, key) => {
        obj[key] = jsonValue[key];
        return obj;
      }, {});
  }
  // from devtools/client/jsonview/json-viewer.mjs
  const pretty = JSON.stringify(
    jsonValue,
    (key, value) => {
      if (value?.type === Symbol("JSON_NUMBER")) {
        return JSON.rawJSON(value.source);
      }

      // By default, -0 will be stringified as `0`, so we need to handle it
      if (Object.is(value, -0)) {
        return JSON.rawJSON("-0");
      }

      return value;
    },
    "  "
  );
  return pretty;
}

/**
 * Updates the `about:glean` metrics table body based on the data points in FILTERED_METRIC_DATA.
 */
function updateTable() {
  LIMITED_METRIC_DATA = FILTERED_METRIC_DATA.toSorted((a, b) =>
    d3.ascending(a.fullName, b.fullName)
  ).filter((_, i) => i >= LIMIT_OFFSET && i < LIMIT_COUNT + LIMIT_OFFSET);

  // Let's talk about d3.js
  // `d3.select` is a rough equivalent to `document.querySelector`, but the resulting object(s) are things d3 knows how to manipulate.
  const tbody = DOCUMENT_BODY_SEL.select("#metrics-table-body");
  // Select all the `tr` elements within the previously selected `tbody` element.
  const rows = tbody
    .selectAll("tr")
    // Set the data for the `tr` elements to be the FILTERED_METRIC_DATA, keyed off the data element's full name
    .data(LIMITED_METRIC_DATA, d => d.fullName);

  // `.enter()` means this section determines how we handle new data elements in the array.
  // We class them and insert the appropriate data cells
  let newRows = rows
    .enter()
    .append("tr")
    .attr("data-d3-row", d => d.fullName)
    .classed({ "metric-row": true });

  const actions = newRows
    .append("td")
    .attr("data-d3-cell", "actions")
    .append("div");
  // Set the HTML content for the `category` and `name` cells, and store the name cells in-scope so we can
  // append our buttons to them.
  newRows
    .append("td")
    .attr("data-d3-cell", "category")
    .append("pre")
    .text(d => d.category);
  newRows
    .append("td")
    .attr("data-d3-cell", "name")
    .append("pre")
    .text(d => d.name);
  // Handle displaying the metric type.
  newRows
    .append("td")
    .attr("data-d3-cell", "type")
    .text(d => d.type);
  newRows.append("td").attr("data-d3-cell", "value");

  actions
    .append("button")
    .attr("data-l10n-id", "about-glean-button-load-value")
    .on("click", datum => updateDatum(datum));
  actions
    .append("button")
    .attr("data-l10n-id", "about-glean-button-dictionary-link")
    .classed({ primary: true })
    // On click, rewrite the metric category+name to snake-case, so we can link to the Glean dictionary.
    // TODO: add canonical_name field to metrics https://bugzilla.mozilla.org/show_bug.cgi?id=1983630
    .on("click", datum => {
      const upperRegExp = /[A-Z]/;
      const app = "firefox_desktop";
      let category = datum.category;
      let index = category.search(upperRegExp);
      while (index != -1) {
        category = category.replace(
          upperRegExp,
          "_" + category[index].toLowerCase()
        );
        index = category.search(upperRegExp);
      }

      let name = datum.name;
      index = name.search(upperRegExp);
      while (index != -1) {
        name = name.replace(upperRegExp, "_" + name[index].toLowerCase());
        index = name.search(upperRegExp);
      }
      window
        .open(
          `https://dictionary.telemetry.mozilla.org/apps/${app}/metrics/${category}_${name}`,
          "_blank"
        )
        .focus();
    });

  // Since `.enter` has been called on `rows` and we've handled new data points, everything
  // that touches `rows` from here on out will affect ALL elements, old and new.

  updateButtonsSelection(
    rows.selectAll("td[data-d3-cell=actions] button[data-d3-button=watch]")
  );
  // Handle the metric's value.
  updateValueSelection(rows.selectAll("td[data-d3-cell=value]"));

  // Sort the `tr` elements by full metric category+name.
  rows.sort((a, b) => d3.ascending(a.fullName, b.fullName));

  // Handle exiting data points by removing their elements.
  rows.exit().remove();

  // Manually trigger translation on the table, as DOM updates after the first application of the `data-l10n-id` will not translate.
  document.l10n.translateFragment(
    document.querySelector("#metrics-table-body")
  );
}

/**
 * Updates the FILTERED_METRIC_DATA value based on the provided `searchString`.
 *
 * @param {*} searchString the string by which the metric data will be filtered
 */
function updateFilteredMetricData(searchString) {
  if (!searchString) {
    FILTERED_METRIC_DATA = MAPPED_METRIC_DATA;
  } else {
    const simpleTypeValueSearch = datum => {
      if (!Object.values(SIMPLE_TYPES).includes(datum.type)) {
        return false;
      }
      switch (datum.type) {
        case SIMPLE_TYPES.Boolean:
          if (searchString == "true") {
            return datum.value === true;
          } else if (searchString == "false") {
            return datum.value === false;
          }
          return false;
        default:
          return false;
      }
    };
    FILTERED_METRIC_DATA = MAPPED_METRIC_DATA.filter(
      datum =>
        datum.category.includes(searchString) ||
        datum.name.includes(searchString) ||
        datum.type.includes(searchString) ||
        simpleTypeValueSearch(datum)
    );
  }

  if (FILTERED_METRIC_DATA.length > LIMIT_COUNT + LIMIT_OFFSET) {
    const table = document.getElementById("metrics-table-instance");
    let scrollTimeout,
      scrollTimeoutIsCleared = true;
    table.addEventListener("scroll", el => {
      if (scrollTimeoutIsCleared) {
        scrollTimeout = setTimeout(
          ({ target }) => {
            clearTimeout(scrollTimeout);
            scrollTimeoutIsCleared = true;
            let changes = false;
            if (target.scrollTop < 1500) {
              if (LIMIT_COUNT >= 500 && LIMIT_OFFSET > 0) {
                LIMIT_OFFSET = LIMIT_OFFSET - 100 < 0 ? 0 : LIMIT_OFFSET - 100;
                changes = true;
              }
            } else if (target.scrollHeight - target.scrollTop < 1500) {
              if (LIMIT_COUNT >= 500) {
                if (
                  LIMIT_OFFSET + LIMIT_COUNT + 100 >
                  FILTERED_METRIC_DATA.length
                ) {
                  LIMIT_OFFSET = FILTERED_METRIC_DATA.length - LIMIT_COUNT;
                } else if (
                  LIMIT_OFFSET + LIMIT_COUNT <
                  FILTERED_METRIC_DATA.length - 100
                ) {
                  LIMIT_OFFSET += 100;
                }
              } else {
                LIMIT_COUNT += 100;
              }
              changes = true;
            }
            if (changes) {
              updateTable();
            }
          },
          10,
          el
        );
        scrollTimeoutIsCleared = false;
      }
    });
  } else {
    LIMIT_COUNT = 200;
    LIMIT_OFFSET = 0;
  }

  updateTable();
}

window.addEventListener("load", onLoad);
