/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  SmartTabGroupingManager:
    "moz-src:///browser/components/tabbrowser/SmartTabGrouping.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "console", () =>
  console.createInstance({
    prefix: "AutoTabGrouping",
    maxLogLevelPref: "browser.smartwindow.autoTabGrouping.loglevel",
  })
);

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "maxGroups",
  "browser.smartwindow.autoTabGrouping.maxGroups",
  3
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "minTabsPerGroup",
  "browser.smartwindow.autoTabGrouping.minTabsPerGroup",
  2
);

// Tab-group color names, mirroring MozTabbrowserTabGroupMenu.COLORS. Each name
// resolves to the themed --tab-group-<name> custom property (defined on :root),
// so both created groups and the per-tab tiles reuse the real tab-strip palette
// rather than hardcoded values. Assigned to suggestions in order; tiles pick a
// name by hashing the host so a given site always renders the same color.
const TAB_GROUP_COLORS = [
  "blue",
  "purple",
  "cyan",
  "orange",
  "yellow",
  "pink",
  "green",
  "gray",
  "red",
];

/**
 * The suggestion engine for the Smart Window "Group my tabs" feature: the only
 * code that talks to the on-device clustering model. Given a window it picks
 * candidate tabs, clusters and labels them, and turns each cluster into the
 * display data the panel shows: a name, a color, and one tile per tab. Kept
 * free of any DOM so the pure parts stay unit-testable and every model call is
 * guarded against throwing.
 */
export const AutoTabGroupingSuggestions = {
  _manager: null,

  get manager() {
    if (!this._manager) {
      this._manager = new lazy.SmartTabGroupingManager();
    }
    return this._manager;
  },

  /**
   * Ungrouped, non-pinned, web-content tabs eligible for clustering. Tabs that
   * are already in a group are excluded so we never re-suggest an existing
   * group.
   *
   * @param {ChromeWindow} win
   * @returns {MozTabbrowserTab[]}
   */
  getCandidateTabs(win) {
    return win.gBrowser.tabs.filter(tab => {
      if (tab.pinned || tab.closing || tab.group || tab.hidden) {
        return false;
      }
      const uri = tab.linkedBrowser?.currentURI;
      // Only cluster real web content; skip about:, chrome:, the Smart Window
      // new tab / chat pages, etc.
      return uri && (uri.schemeIs("http") || uri.schemeIs("https"));
    });
  },

  /**
   * Run clustering + labeling and return the top proposals.
   *
   * @param {MozTabbrowserTab[]} candidates
   * @returns {Promise<Array<{label: string, tabs: MozTabbrowserTab[]}>>}
   */
  async buildProposals(candidates) {
    const result = await this.manager.generateClusters(candidates, null, 0);
    const clusters = this.selectClusters(result?.clusterRepresentations);
    if (!clusters.length) {
      return [];
    }

    const groupedTabs = new Set(clusters.flatMap(c => c.tabs));
    const otherTabs = candidates.filter(t => !groupedTabs.has(t));

    const proposals = [];
    for (const cluster of clusters) {
      let label = "";
      try {
        label = await this.manager.getPredictedLabelForGroup(
          cluster.tabs,
          otherTabs
        );
      } catch (e) {
        lazy.console.warn("Label generation failed", e);
      }
      proposals.push({ label: label || "", tabs: cluster.tabs });
    }
    return proposals;
  },

  /**
   * Keep clusters big enough to be worth grouping, largest first, capped at
   * maxGroups. Pure so it can be unit tested without the ML model.
   *
   * @param {Array<{tabs: object[]}>} [clusterRepresentations]
   * @returns {Array<{tabs: object[]}>}
   */
  selectClusters(clusterRepresentations) {
    if (!clusterRepresentations?.length) {
      return [];
    }
    return clusterRepresentations
      .filter(c => c.tabs && c.tabs.length >= lazy.minTabsPerGroup)
      .sort((a, b) => b.tabs.length - a.tabs.length)
      .slice(0, lazy.maxGroups);
  },

  /**
   * Turn a proposal into the display data the panel shows. The caller assigns a
   * stable id so it can track which suggestions have been consumed.
   *
   * @param {{label: string, tabs: MozTabbrowserTab[]}} proposal
   * @param {number} index - Position used to pick a distinct group color.
   * @returns {{label: string, color: string, tabs: MozTabbrowserTab[],
   *   tabInfos: object[]}}
   */
  toSuggestionData(proposal, index) {
    return {
      label: proposal.label || "Group",
      color: TAB_GROUP_COLORS[index % TAB_GROUP_COLORS.length],
      tabs: proposal.tabs,
      tabInfos: proposal.tabs.map(tab => this._tabInfo(tab)),
    };
  },

  _tabInfo(tab) {
    let host = "";
    try {
      host = tab.linkedBrowser?.currentURI?.host || "";
    } catch (e) {
      host = "";
    }
    host = host.replace(/^www\./, "");
    const title = tab.label || host || "Tab";
    const brandSource = host || title;
    const brand = brandSource
      ? brandSource.split(".")[0].replace(/^./, c => c.toUpperCase())
      : "";
    const letter = (brand || title || "•").trim()[0] || "•";
    const colorName =
      TAB_GROUP_COLORS[this._hash(brandSource) % TAB_GROUP_COLORS.length];
    const tileColor = `var(--tab-group-${colorName})`;
    return { letter, tileColor, host, title, brand: host ? brand : "" };
  },

  _hash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  },
};
