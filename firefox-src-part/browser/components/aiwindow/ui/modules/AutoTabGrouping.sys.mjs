/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AutoTabGroupingSuggestions:
    "moz-src:///browser/components/aiwindow/ui/modules/AutoTabGroupingSuggestions.sys.mjs",
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

const BUTTON_ITEM_ID = "smartwindow-group-tabs-button";
const PANEL_ID = "smartwindow-group-tabs-panel";
const FLYOUT_ID = "smartwindow-group-tabs-flyout";
const CARD_TAG = "smartwindow-group-tabs-card";
const FLYOUT_HIDE_DELAY_MS = 160;

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
   * Per-window state that must survive the panel being closed and rebuilt.
   * suggestions holds the not-yet-created proposals; consumed proposals are
   * dropped and are not recomputed, so a suggestion the user acts on does not
   * resurface.
   *
   * computePromise memoizes the in-flight clustering run so a panel reopened
   * while it is still running awaits the same computation instead of getting
   * stuck on the loading state.
   *
   * @type {WeakMap<ChromeWindow, {computed: boolean, computing: boolean,
   *   computePromise: ?Promise, suggestions: object[]}>}
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
        suggestions: [],
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
    const popupSet = doc.getElementById("mainPopupSet");
    if (!anchor || !popupSet) {
      return;
    }
    const button = doc.getElementById("smartwindow-group-tabs-button-inner");

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
    if (!state.computed) {
      // _computeSuggestions flips state.computing synchronously (when there are
      // enough tabs), so syncing right after shows the loading state. If a
      // previous open is still clustering, this awaits that same run.
      const done = this._computeSuggestions(win);
      this._syncCard(win, panel);
      await done;
      // The panel may have been closed (or replaced) while the models ran.
      if (this._panels.get(win) !== panel) {
        return;
      }
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
   * after clustering finishes and whenever a suggestion is consumed. A new array
   * is passed so the element sees a change.
   *
   * @param {ChromeWindow} win
   * @param {XULElement} panel
   */
  _syncCard(win, panel) {
    const state = this._getState(win);
    this._hideFlyout(panel);

    const card = panel._card;
    card.computing = state.computing;
    card.suggestions = [...state.suggestions];
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
        win.gBrowser.addTabGroup(tabs, {
          label: suggestion.label,
          color: suggestion.color,
        });
      } catch (e) {
        lazy.console.warn("addTabGroup failed", e);
      }
    }

    const consumed = new Set(suggestions.map(s => s.id));
    state.suggestions = state.suggestions.filter(s => !consumed.has(s.id));
    panel._restoreFocus = true;
    panel.hidePopup();
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
        const proposals =
          await lazy.AutoTabGroupingSuggestions.buildProposals(candidates);
        state.suggestions = proposals.map((proposal, index) => ({
          id: this._nextId++,
          ...lazy.AutoTabGroupingSuggestions.toSuggestionData(proposal, index),
        }));
        state.computed = true;
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
