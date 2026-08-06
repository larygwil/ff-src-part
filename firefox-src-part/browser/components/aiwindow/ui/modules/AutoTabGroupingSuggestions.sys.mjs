/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
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

// Drop clusters whose cohesion (average pairwise cosine similarity of the tabs'
// embeddings, 0..1, set by SmartTabGrouping) is below this, so weakly-related
// tabs are not offered as a group. See SmartTabGroupingResult.getCohesion.
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "minCohesion",
  "browser.smartwindow.autoTabGrouping.minCohesion",
  "0.1",
  null,
  value => parseFloat(value)
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
const MAX_LABEL_CACHE_ENTRIES = 50;

export const AutoTabGroupingSuggestions = {
  _manager: null,

  // Reopening the panel over an unchanged set of tabs reuses the title
  // instead of re-running the labeling model.
  _labelCache: new Map(),

  get isAvailable() {
    return (
      Services.prefs.getBoolPref("browser.ml.enable", false) &&
      lazy.SmartTabGroupingManager.isAllowed
    );
  },

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
      if (tab.hasAttribute("busy") || !tab.label) {
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
        label = await this._labelForGroup(cluster.tabs, otherTabs);
      } catch (e) {
        lazy.console.warn("Label generation failed", e);
      }
      // Drop groups the model left unlabeled: an empty title usually flags
      // content it declined to label (often a Trust & Safety case).
      const trimmed = label?.trim();
      if (trimmed) {
        proposals.push({ label: trimmed, tabs: cluster.tabs });
      }
    }
    return proposals;
  },

  /**
   * Predicted label for a group, cached by its source tabs' URLs.
   *
   * @param {MozTabbrowserTab[]} tabs
   * @param {MozTabbrowserTab[]} otherTabs
   * @returns {Promise<string>}
   */
  async _labelForGroup(tabs, otherTabs) {
    const key = tabs
      .map(t => t.linkedBrowser?.currentURI?.spec ?? "")
      .sort()
      .join("\n");
    if (this._labelCache.has(key)) {
      return this._labelCache.get(key);
    }
    const label = await this.manager.getPredictedLabelForGroup(tabs, otherTabs);
    if (this._labelCache.size >= MAX_LABEL_CACHE_ENTRIES) {
      this._labelCache.delete(this._labelCache.keys().next().value);
    }
    this._labelCache.set(key, label);
    return label;
  },

  /**
   * Keep clusters big enough and cohesive enough to be worth grouping, largest
   * first, capped at maxGroups. Pure so it can be unit tested without the ML
   * model.
   *
   * @param {Array<{tabs: object[], cohesion: number}>} [clusterRepresentations]
   * @returns {Array<{tabs: object[], cohesion: number}>}
   */
  selectClusters(clusterRepresentations) {
    if (!clusterRepresentations?.length) {
      return [];
    }
    return clusterRepresentations
      .filter(
        c =>
          c.tabs &&
          c.tabs.length >= lazy.minTabsPerGroup &&
          c.cohesion >= lazy.minCohesion
      )
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
    // Derive a user-visible site label from the tab's URI.
    const uri = tab.linkedBrowser?.currentURI;
    let site = "";
    if (uri) {
      try {
        site = lazy.BrowserUtils.formatURIForDisplay(uri, {
          onlyBaseDomain: true,
        });
      } catch (e) {
        site = "";
      }
    }
    const title = tab.label || site;
    // Only show the site next to the title when it adds information.
    const siteName = site && site !== title ? site : "";
    const identifier = site || title;
    const letter = identifier.trim()[0]?.toUpperCase() || "•";
    const colorName =
      TAB_GROUP_COLORS[this._hash(identifier) % TAB_GROUP_COLORS.length];
    const tileColor = `var(--tab-group-${colorName})`;
    return { letter, tileColor, title, siteName };
  },

  _hash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  },
};
