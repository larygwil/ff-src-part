/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AutoTabGroupingSuggestions:
    "moz-src:///browser/components/aiwindow/ui/modules/AutoTabGroupingSuggestions.sys.mjs",
  TabMetrics: "moz-src:///browser/components/tabbrowser/TabMetrics.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "console", () =>
  console.createInstance({
    prefix: "AutoTabGrouping",
    maxLogLevelPref: "browser.smartwindow.autoTabGrouping.loglevel",
  })
);

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "minTabsPerGroup",
  "browser.smartwindow.autoTabGrouping.minTabsPerGroup",
  2
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "minCandidateTabs",
  "browser.smartwindow.autoTabGrouping.minCandidateTabs",
  4
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "timeoutMs",
  "browser.smartwindow.autoTabGrouping.timeoutMs",
  8000
);

const BUTTON_ITEM_ID = "smartwindow-group-tabs-button";
const BUTTON_ID = "smartwindow-group-tabs-button-inner";
const PANEL_ID = "smartwindow-group-tabs-panel";
const FLYOUT_ID = "smartwindow-group-tabs-flyout";
const CARD_TAG = "smartwindow-group-tabs-card";
const FLYOUT_HIDE_DELAY_MS = 160;

/**
 * Median and mean of a list of group sizes (tabs per group), rounded to
 * integers for the telemetry events.
 *
 * @param {number[]} sizes
 * @returns {{median: number, mean: number}}
 */
function sizeStats(sizes) {
  if (!sizes.length) {
    return { median: 0, mean: 0 };
  }
  const sorted = [...sizes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const mean = Math.round(sizes.reduce((sum, n) => sum + n, 0) / sizes.length);
  return { median, mean };
}

/**
 * Front-end orchestrator for the Smart Window "Group my tabs" feature. Opens a
 * toolbar-anchored panel that suggests tab groups (clustered on-device by
 * AutoTabGroupingSuggestions) and creates the ones the user picks.
 *
 * The whole feature is gated behind browser.smartwindow.autoTabGrouping.enabled
 * (default false). This module owns the XUL panels, their lifecycle, and all ML
 * and tab-group work; the panel and flyout markup are rendered by the
 * smartwindow-group-tabs-card / -flyout custom elements, which report user
 * intent back through events.
 */
export const AutoTabGrouping = {
  _nextId: 1,

  /**
   * A suggested group the panel offers (not yet created).
   *
   * @typedef {object} GroupSuggestion
   * @property {number} id - Stable id used to find the row across re-renders.
   * @property {string} label - Suggested group name.
   * @property {string} color - Tab-group color name (a --tab-group-<name>).
   * @property {MozTabbrowserTab[]} tabs - Tabs the group would contain.
   * @property {object[]} tabInfos - Per-tab display data (tile color, letter,
   *   site name, title) for the rows and flyout.
   */

  /**
   * A group the feature created and can still ungroup.
   *
   * @typedef {object} RecentGroup
   * @property {number} id - Stable id used to find the row across re-renders.
   * @property {MozTabGroup} group - The created tab group, used to ungroup it.
   * @property {string} label - The created group's name.
   * @property {string} color - The created group's color name.
   */

  /**
   * Per-window state that must survive the panel being closed and rebuilt.
   * suggestions holds the not-yet-created proposals; consumed proposals are
   * dropped and are not recomputed, so a suggestion the user acts on does not
   * resurface.
   *
   * computePromise memoizes the in-flight clustering run (it resolves to
   * undefined once suggestions are stored) so a panel reopened while it is
   * still running awaits the same computation instead of getting stuck on the
   * loading state. computeCount counts finished runs, used to flag reopened
   * offers as recomputes in telemetry.
   *
   * recent holds the groups created from suggestions (newest first); the panel
   * lists them under "Just created" and the "Ungroup" button reverses all of
   * them at once.
   *
   * @type {WeakMap<ChromeWindow, {computed: boolean, computing: boolean,
   *   computeCount: number, computePromise: ?Promise<void>,
   *   suggestions: GroupSuggestion[], recent: RecentGroup[]}>}
   */
  _state: new WeakMap(),

  /**
   * The main panel currently in the DOM for a window, if any.
   *
   * @type {WeakMap<ChromeWindow, XULElement>}
   */
  _panels: new WeakMap(),

  _getState(win) {
    let state = this._state.get(win);
    if (!state) {
      state = {
        computed: false,
        computing: false,
        computePromise: null,
        computeCount: 0,
        suggestions: [],
        recent: [],
      };
      this._state.set(win, state);
    }
    return state;
  },

  /**
   * Toggle the "Group my tabs" panel from the toolbar button.
   *
   * @param {ChromeWindow} win - The Smart Window.
   */
  toggleGroupTabsPanel(win) {
    const existing = this._panels.get(win);
    if (existing) {
      existing.hidePopup();
      return;
    }
    this.showGroupTabsPanel(win).catch(e =>
      lazy.console.warn("showGroupTabsPanel failed", e)
    );
  },

  /**
   * Build the panel, show it, then populate it once the clustering models have
   * run (or immediately if suggestions were already computed).
   *
   * @param {ChromeWindow} win
   */
  async showGroupTabsPanel(win) {
    if (!win?.gBrowser || win.closed) {
      return;
    }
    const doc = win.document;
    const anchor = doc.getElementById(BUTTON_ITEM_ID);
    const button = doc.getElementById(BUTTON_ID);
    const popupSet = doc.getElementById("mainPopupSet");
    if (!anchor || !popupSet) {
      return;
    }

    const panel = this._buildPanelSkeleton(win);
    popupSet.appendChild(panel);
    this._panels.set(win, panel);

    // Both panels are noautohide so hovering the flyout (a second popup) cannot
    // roll up the main panel; dismiss it ourselves on Escape or a click outside
    // both popups and the toolbar button.
    const onMouseDown = event => {
      const target = event.target;
      if (
        panel.contains(target) ||
        panel._flyoutPanel?.contains(target) ||
        anchor.contains(target)
      ) {
        return;
      }
      panel.hidePopup();
    };
    const onKeyDown = event => {
      if (event.key === "Escape") {
        panel._restoreFocus = true;
        panel.hidePopup();
      }
    };

    panel.addEventListener(
      "popupshown",
      () => {
        button?.setAttribute("aria-expanded", "true");
        panel._card.focus();
        win.addEventListener("mousedown", onMouseDown, true);
        win.addEventListener("keydown", onKeyDown, true);
      },
      { once: true }
    );
    panel.addEventListener(
      "popuphidden",
      () => {
        button?.setAttribute("aria-expanded", "false");
        win.removeEventListener("mousedown", onMouseDown, true);
        win.removeEventListener("keydown", onKeyDown, true);
        this._cancelHideFlyout(panel);
        panel._flyoutPanel?.remove();
        if (this._panels.get(win) === panel) {
          this._panels.delete(win);
        }
        panel.remove();
        if (panel._restoreFocus) {
          button?.focus();
        }
      },
      { once: true }
    );

    panel.openPopup(anchor, "after_end", 0, 6, false, false);

    const state = this._getState(win);
    if (!state.computing) {
      state.computed = false;
      state.suggestions = [];
    }
    const done = this._computeSuggestions(win);
    this._syncCard(win, panel);
    await done;
    if (this._panels.get(win) !== panel) {
      return;
    }
    this._syncCard(win, panel);
  },

  /**
   * @param {ChromeWindow} win
   * @returns {XULElement} A detached main panel hosting the card element, with
   *   its events wired to the model actions.
   */
  _buildPanelSkeleton(win) {
    const doc = win.document;

    const panel = this._createBarePanel(win, PANEL_ID);

    const card = doc.createElement(CARD_TAG);
    card.addEventListener("create-all", () =>
      this._createSuggestions(
        win,
        panel,
        this._getState(win).suggestions.slice()
      )
    );
    card.addEventListener("create-one", e =>
      this._createById(win, panel, e.detail.id)
    );
    card.addEventListener("ungroup", () => this._ungroupRecent(win, panel));
    card.addEventListener("preview", e =>
      this._showFlyoutById(win, panel, e.detail.id, e.detail.anchor)
    );
    card.addEventListener("preview-end", () => this._scheduleHideFlyout(panel));
    panel.appendChild(card);

    panel._card = card;
    panel._flyoutPanel = null;
    panel._activeRow = null;
    panel._hideTimer = 0;
    panel._restoreFocus = false;
    return panel;
  },

  /**
   * Create a chrome-less, transparent, non-auto-hiding panel that hosts one of
   * our white cards. Shared by the main panel and the hover flyout. Styling
   * lives in the smartwindowGroupTabs.css theme sheet, scoped to the panel ids
   * and swgt- classes.
   *
   * @param {ChromeWindow} win
   * @param {string} id
   * @returns {XULElement}
   */
  _createBarePanel(win, id) {
    const panel = win.document.createXULElement("panel");
    panel.id = id;
    panel.setAttribute("noautofocus", "true");
    panel.setAttribute("noautohide", "true");
    panel.setAttribute("class", "panel-no-padding");
    return panel;
  },

  /**
   * Lazily create the flyout sub-panel that floats to the left of a hovered
   * suggestion row.
   *
   * @param {ChromeWindow} win
   * @param {XULElement} panel - The main panel.
   * @returns {XULElement}
   */
  _ensureFlyoutPanel(win, panel) {
    if (panel._flyoutPanel?.parentNode) {
      return panel._flyoutPanel;
    }
    const flyoutPanel = this._createBarePanel(win, FLYOUT_ID);
    const flyoutEl = win.document.createElement(FLYOUT_ID);
    flyoutEl.addEventListener("create-one", e =>
      this._createById(win, panel, e.detail.id)
    );
    flyoutPanel.appendChild(flyoutEl);
    flyoutPanel.addEventListener("mouseenter", () =>
      this._cancelHideFlyout(panel)
    );
    flyoutPanel.addEventListener("mouseleave", () =>
      this._scheduleHideFlyout(panel)
    );
    flyoutPanel._flyoutEl = flyoutEl;

    win.document.getElementById("mainPopupSet").appendChild(flyoutPanel);
    panel._flyoutPanel = flyoutPanel;
    return flyoutPanel;
  },

  /**
   * Push the window's state onto the card element, which re-renders. Called
   * after clustering finishes and whenever a suggestion or recent group is
   * consumed. New arrays are passed so the element sees a change.
   *
   * @param {ChromeWindow} win
   * @param {XULElement} panel
   */
  _syncCard(win, panel) {
    const state = this._getState(win);
    this._pruneRecent(win);
    this._hideFlyout(panel);

    const card = panel._card;
    card.computing = state.computing;
    card.suggestions = [...state.suggestions];
    card.recent = [...state.recent];
  },

  _createById(win, panel, id) {
    const suggestion = this._getState(win).suggestions.find(s => s.id === id);
    if (suggestion) {
      this._createSuggestions(win, panel, [suggestion]);
    }
  },

  _showFlyoutById(win, panel, id, anchorRow) {
    const suggestion = this._getState(win).suggestions.find(s => s.id === id);
    if (suggestion) {
      this._cancelHideFlyout(panel);
      this._showFlyout(win, panel, anchorRow, suggestion);
    }
  },

  _showFlyout(win, panel, anchorRow, suggestion) {
    const flyoutPanel = this._ensureFlyoutPanel(win, panel);
    flyoutPanel._flyoutEl.suggestion = suggestion;

    if (panel._activeRow && panel._activeRow !== anchorRow) {
      panel._activeRow.classList.remove("is-active");
    }
    anchorRow.classList.add("is-active");
    panel._activeRow = anchorRow;

    // Float the flyout to the left of the hovered row, top-aligned with it.
    // moveToAnchor repositions without a hide/show flicker when the pointer
    // slides between rows.
    const flyoutState = flyoutPanel.state;
    if (flyoutState === "open" || flyoutState === "showing") {
      flyoutPanel.moveToAnchor(anchorRow, "start_before", 0, 0);
    } else {
      flyoutPanel.openPopup(anchorRow, "start_before", 0, 0, false, false);
    }
  },

  _hideFlyout(panel) {
    this._cancelHideFlyout(panel);
    panel._flyoutPanel?.hidePopup();
    if (panel._activeRow) {
      panel._activeRow.classList.remove("is-active");
      panel._activeRow = null;
    }
  },

  _scheduleHideFlyout(panel) {
    this._cancelHideFlyout(panel);
    const win = panel.ownerGlobal;
    if (!win) {
      return;
    }
    panel._hideTimer = win.setTimeout(() => {
      panel._hideTimer = 0;
      this._hideFlyout(panel);
    }, FLYOUT_HIDE_DELAY_MS);
  },

  _cancelHideFlyout(panel) {
    if (panel._hideTimer) {
      panel.ownerGlobal.clearTimeout(panel._hideTimer);
      panel._hideTimer = 0;
    }
  },

  /**
   * Create the given suggestions as tab groups, drop them from the suggestion
   * list, and close the panel.
   *
   * @param {ChromeWindow} win
   * @param {XULElement} panel
   * @param {object[]} suggestions
   */
  _createSuggestions(win, panel, suggestions) {
    const state = this._getState(win);
    const windowTabs = new Set(win.gBrowser.tabs);
    // Our groups arrive fully formed (label and color chosen by the
    // suggestion), so create them non-user-triggered: a user-triggered
    // addTabGroup dispatches TabGroupCreateByUser, which pops the built-in
    // "name your group" editor. We track creation with our own Glean event.
    // (bug 2024819 tracks decoupling that editor trigger from the standard
    // tab-group metrics; if it lands we may need to revisit this call.)
    const metricsContext = {
      isUserTriggered: false,
      telemetrySource:
        lazy.TabMetrics.METRIC_SOURCE.SMART_WINDOW_GROUP_SUGGESTIONS,
    };
    const created = [];
    const sizes = [];
    for (const suggestion of suggestions) {
      // Tabs may have been closed/moved/grouped since clustering, so only keep
      // ungrouped tabs that still live in this window.
      const tabs = suggestion.tabs.filter(
        t => !t.closing && !t.group && windowTabs.has(t)
      );
      if (tabs.length < lazy.minTabsPerGroup) {
        continue;
      }
      try {
        const group = win.gBrowser.addTabGroup(tabs, {
          label: suggestion.label,
          color: suggestion.color,
          metricsContext,
        });
        if (group) {
          const entry = {
            id: this._nextId++,
            group,
            label: suggestion.label,
            color: suggestion.color,
          };
          state.recent.unshift(entry);
          created.push(entry);
          sizes.push(tabs.length);
        }
      } catch (e) {
        lazy.console.warn("addTabGroup failed", e);
      }
    }

    if (created.length) {
      const { median, mean } = sizeStats(sizes);
      Glean.smartWindow.autoTabGroupCreated.record({
        type: suggestions.length > 1 ? "all" : "individual",
        count: created.length,
        median_tabs: median,
        mean_tabs: mean,
      });
    }

    const consumed = new Set(suggestions.map(s => s.id));
    state.suggestions = state.suggestions.filter(s => !consumed.has(s.id));
    panel._restoreFocus = true;
    panel.hidePopup();
  },

  _metricsContext() {
    return lazy.TabMetrics.userTriggeredContext(
      lazy.TabMetrics.METRIC_SOURCE.SMART_WINDOW_GROUP_SUGGESTIONS
    );
  },

  _isGroupLive(win, group) {
    return win.gBrowser.tabGroups.includes(group);
  },

  /**
   * Ungroup every recent group at once: dissolve each group (its tabs stay
   * open) and clear the "Just created" list. Reverses everything the feature
   * created since the panel was last cleared.
   *
   * @param {ChromeWindow} win
   * @param {XULElement} panel
   */
  _ungroupRecent(win, panel) {
    const state = this._getState(win);
    const entries = state.recent.slice();
    let count = 0;
    for (const entry of entries) {
      if (this._ungroup(win, entry)) {
        count++;
      }
    }
    this._forgetEntries(win, entries);
    if (count) {
      Glean.smartWindow.autoTabGroupUndone.record({ count });
    }
    this._syncCard(win, panel);
  },

  _ungroup(win, entry) {
    if (!this._isGroupLive(win, entry.group)) {
      return false;
    }
    try {
      entry.group.ungroupTabs(this._metricsContext());
      return true;
    } catch (e) {
      lazy.console.warn("ungroupTabs failed", e);
      return false;
    }
  },

  _forgetEntries(win, entries) {
    const state = this._getState(win);
    const ids = new Set(entries.map(e => e.id));
    state.recent = state.recent.filter(e => !ids.has(e.id));
  },

  _pruneRecent(win) {
    const state = this._getState(win);
    const dead = state.recent.filter(e => !this._isGroupLive(win, e.group));
    if (dead.length) {
      this._forgetEntries(win, dead);
    }
  },

  _withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = lazy.setTimeout(
        () => reject(new Error("Auto Tab Grouping timed out")),
        ms
      );
    });
    return Promise.race([promise, timeout]).finally(() =>
      lazy.clearTimeout(timer)
    );
  },

  /**
   * Run clustering + labeling once and cache the resulting suggestions on the
   * window state. Stays uncomputed when there are too few tabs so a later open
   * retries once more tabs exist.
   *
   * @param {ChromeWindow} win
   */
  _computeSuggestions(win) {
    const state = this._getState(win);
    if (state.computed) {
      return Promise.resolve();
    }
    if (state.computePromise) {
      return state.computePromise;
    }
    if (!lazy.AutoTabGroupingSuggestions.isAvailable) {
      return Promise.resolve();
    }
    const candidates = lazy.AutoTabGroupingSuggestions.getCandidateTabs(win);
    if (candidates.length < lazy.minCandidateTabs) {
      return Promise.resolve();
    }
    state.computing = true;
    state.computePromise = (async () => {
      try {
        const proposals = await this._withTimeout(
          lazy.AutoTabGroupingSuggestions.buildProposals(candidates),
          lazy.timeoutMs
        );
        state.suggestions = proposals.map((proposal, index) => ({
          id: this._nextId++,
          ...lazy.AutoTabGroupingSuggestions.toSuggestionData(proposal, index),
        }));
        state.computed = true;
        state.computeCount++;
        if (state.suggestions.length) {
          const { median, mean } = sizeStats(
            state.suggestions.map(s => s.tabs.length)
          );
          Glean.smartWindow.autoTabGroupOffered.record({
            count: state.suggestions.length,
            median_tabs: median,
            mean_tabs: mean,
            recomputed: state.computeCount > 1,
          });
        }
      } catch (e) {
        lazy.console.warn("Building group proposals failed", e);
      } finally {
        state.computing = false;
        state.computePromise = null;
      }
    })();
    return state.computePromise;
  },
};
