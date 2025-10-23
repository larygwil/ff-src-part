/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// This is loaded into all browser windows. Wrap in a block to prevent
// leaking to window scope.
{
  const DIRECTION_BACKWARD = -1;
  const DIRECTION_FORWARD = 1;

  const isTab = element => gBrowser.isTab(element);
  const isTabGroup = element => gBrowser.isTabGroup(element);
  const isTabGroupLabel = element => gBrowser.isTabGroupLabel(element);

  class MozTabbrowserTabs extends MozElements.TabsBase {
    static observedAttributes = ["orient"];

    #mustUpdateTabMinHeight = false;
    #tabMinHeight = 36;

    constructor() {
      super();

      this.addEventListener("TabSelect", this);
      this.addEventListener("TabClose", this);
      this.addEventListener("TabAttrModified", this);
      this.addEventListener("TabHide", this);
      this.addEventListener("TabShow", this);
      this.addEventListener("TabHoverStart", this);
      this.addEventListener("TabHoverEnd", this);
      this.addEventListener("TabGroupLabelHoverStart", this);
      this.addEventListener("TabGroupLabelHoverEnd", this);
      this.addEventListener("TabGroupExpand", this);
      this.addEventListener("TabGroupCollapse", this);
      this.addEventListener("TabGroupCreate", this);
      this.addEventListener("TabGroupRemoved", this);
      this.addEventListener("transitionend", this);
      this.addEventListener("dblclick", this);
      this.addEventListener("click", this);
      this.addEventListener("click", this, true);
      this.addEventListener("keydown", this, { mozSystemGroup: true });
      this.addEventListener("mouseleave", this);
      this.addEventListener("focusin", this);
      this.addEventListener("focusout", this);
      this.addEventListener("contextmenu", this);
      this.addEventListener("dragstart", this);
      this.addEventListener("dragover", this);
      this.addEventListener("drop", this);
      this.addEventListener("dragend", this);
      this.addEventListener("dragleave", this);
    }

    init() {
      this.startupTime = Services.startup.getStartupInfo().start.getTime();

      this.arrowScrollbox = document.getElementById(
        "tabbrowser-arrowscrollbox"
      );
      this.arrowScrollbox.addEventListener("wheel", this, true);
      this.arrowScrollbox.addEventListener("underflow", this);
      this.arrowScrollbox.addEventListener("overflow", this);
      this.pinnedTabsContainer = document.getElementById(
        "pinned-tabs-container"
      );

      // Override arrowscrollbox.js method, since our scrollbox's children are
      // inherited from the scrollbox binding parent (this).
      this.arrowScrollbox._getScrollableElements = () => {
        return this.ariaFocusableItems.reduce((elements, item) => {
          if (this.arrowScrollbox._canScrollToElement(item)) {
            elements.push(item);
            if (
              isTab(item) &&
              item.group &&
              item.group.collapsed &&
              item.selected
            ) {
              // overflow container is scrollable, but not in focus order
              elements.push(item.group.overflowContainer);
            }
          }
          return elements;
        }, []);
      };
      this.arrowScrollbox._canScrollToElement = element => {
        if (isTab(element)) {
          return !element.pinned;
        }
        return true;
      };

      // Override for performance reasons. This is the size of a single element
      // that can be scrolled when using mouse wheel scrolling. If we don't do
      // this then arrowscrollbox computes this value by calling
      // _getScrollableElements and dividing the box size by that number.
      // However in the tabstrip case we already know the answer to this as,
      // when we're overflowing, it is always the same as the tab min width or
      // height. For tab group labels, the number won't exactly match, but
      // that shouldn't be a problem in practice since the arrowscrollbox
      // stops at element bounds when finishing scrolling.
      Object.defineProperty(this.arrowScrollbox, "lineScrollAmount", {
        get: () =>
          this.verticalMode ? this.#tabMinHeight : this._tabMinWidthPref,
      });

      this.baseConnect();

      this._blockDblClick = false;
      this._closeButtonsUpdatePending = false;
      this._closingTabsSpacer = this.querySelector(".closing-tabs-spacer");
      this._tabDefaultMaxWidth = NaN;
      this._lastTabClosedByMouse = false;
      this._hasTabTempMaxWidth = false;
      this._scrollButtonWidth = 0;
      this._animateElement = this.arrowScrollbox;
      this._tabClipWidth = Services.prefs.getIntPref(
        "browser.tabs.tabClipWidth"
      );
      this._hiddenSoundPlayingTabs = new Set();
      this.previewPanel = null;

      this.allTabs[0].label = this.emptyTabTitle;

      // Hide the secondary text for locales where it is unsupported due to size constraints.
      const language = Services.locale.appLocaleAsBCP47;
      const unsupportedLocales = Services.prefs.getCharPref(
        "browser.tabs.secondaryTextUnsupportedLocales"
      );
      this.toggleAttribute(
        "secondarytext-unsupported",
        unsupportedLocales.split(",").includes(language.split("-")[0])
      );

      this.newTabButton.setAttribute(
        "aria-label",
        DynamicShortcutTooltip.getText("tabs-newtab-button")
      );

      let handleResize = () => {
        this._updateCloseButtons();
        this._handleTabSelect(true);
      };
      window.addEventListener("resize", handleResize);
      this._fullscreenMutationObserver = new MutationObserver(handleResize);
      this._fullscreenMutationObserver.observe(document.documentElement, {
        attributeFilter: ["inFullscreen", "inDOMFullscreen"],
      });

      this.boundObserve = (...args) => this.observe(...args);
      Services.prefs.addObserver("privacy.userContext", this.boundObserve);
      this.observe(null, "nsPref:changed", "privacy.userContext.enabled");

      document
        .getElementById("vertical-tabs-newtab-button")
        .addEventListener("keypress", this);
      document
        .getElementById("tabs-newtab-button")
        .addEventListener("keypress", this);

      XPCOMUtils.defineLazyPreferenceGetter(
        this,
        "_tabMinWidthPref",
        "browser.tabs.tabMinWidth",
        null,
        (pref, prevValue, newValue) => this.#updateTabMinWidth(newValue),
        newValue => {
          const LIMIT = 50;
          return Math.max(newValue, LIMIT);
        }
      );
      this.#updateTabMinWidth(this._tabMinWidthPref);
      this.#updateTabMinHeight();

      CustomizableUI.addListener(this);
      this._updateNewTabVisibility();

      XPCOMUtils.defineLazyPreferenceGetter(
        this,
        "_closeTabByDblclick",
        "browser.tabs.closeTabByDblclick",
        false
      );

      XPCOMUtils.defineLazyPreferenceGetter(
        this,
        "_sidebarVisibility",
        "sidebar.visibility",
        "always-show"
      );

      XPCOMUtils.defineLazyPreferenceGetter(
        this,
        "_sidebarPositionStart",
        "sidebar.position_start",
        true
      );

      if (gMultiProcessBrowser) {
        this.tabbox.tabpanels.setAttribute("async", "true");
      }

      XPCOMUtils.defineLazyPreferenceGetter(
        this,
        "_showTabHoverPreview",
        "browser.tabs.hoverPreview.enabled",
        false
      );
      XPCOMUtils.defineLazyPreferenceGetter(
        this,
        "_showTabGroupHoverPreview",
        "browser.tabs.groups.hoverPreview.enabled",
        false
      );

      this.tooltip = "tabbrowser-tab-tooltip";

      this.tabDragAndDrop = new window.TabDragAndDrop(this);
      this.tabDragAndDrop.init();
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (name != "orient") {
        return;
      }

      if (this.overflowing) {
        // reset this value so we don't have incorrect styling for vertical tabs
        this.removeAttribute("overflow");
      }

      this.#updateTabMinWidth();
      this.#updateTabMinHeight();

      this.pinnedTabsContainer.setAttribute("orient", newValue);

      super.attributeChangedCallback(name, oldValue, newValue);
    }

    // Event handlers

    handleEvent(aEvent) {
      switch (aEvent.type) {
        case "mouseout": {
          // If the "related target" (the node to which the pointer went) is not
          // a child of the current document, the mouse just left the window.
          let relatedTarget = aEvent.relatedTarget;
          if (relatedTarget && relatedTarget.ownerDocument == document) {
            break;
          }
        }
        // fall through
        case "mousemove":
          if (
            document.getElementById("tabContextMenu").state != "open" &&
            !this.#isMovingTab()
          ) {
            this._unlockTabSizing();
          }
          break;
        case "mouseleave":
          this.previewPanel?.deactivate();
          break;
        default: {
          let methodName = `on_${aEvent.type}`;
          if (methodName in this) {
            this[methodName](aEvent);
          } else {
            throw new Error(`Unexpected event ${aEvent.type}`);
          }
        }
      }
    }

    /**
     * @param {CustomEvent} event
     */
    on_TabSelect(event) {
      const {
        target: newTab,
        detail: { previousTab },
      } = event;

      // In some cases (e.g. by selecting a tab in a collapsed tab group),
      // changing the selected tab may cause a tab to appear/disappear.
      if (previousTab.group?.collapsed || newTab.group?.collapsed) {
        this._invalidateCachedVisibleTabs();
      }
      this._handleTabSelect();
    }

    on_TabClose(event) {
      this._hiddenSoundPlayingStatusChanged(event.target, { closed: true });
    }

    on_TabAttrModified(event) {
      if (
        event.detail.changed.includes("soundplaying") &&
        !event.target.visible
      ) {
        this._hiddenSoundPlayingStatusChanged(event.target);
      }
      if (
        event.detail.changed.includes("soundplaying") ||
        event.detail.changed.includes("muted") ||
        event.detail.changed.includes("activemedia-blocked")
      ) {
        this.updateTabSoundLabel(event.target);
      }
    }

    on_TabHide(event) {
      if (event.target.soundPlaying) {
        this._hiddenSoundPlayingStatusChanged(event.target);
      }
    }

    on_TabShow(event) {
      if (event.target.soundPlaying) {
        this._hiddenSoundPlayingStatusChanged(event.target);
      }
    }

    on_TabHoverStart(event) {
      if (!this._showTabHoverPreview) {
        return;
      }
      this.ensureTabPreviewPanelLoaded();
      this.previewPanel.activate(event.target);
    }

    on_TabHoverEnd(event) {
      this.previewPanel?.deactivate(event.target);
    }

    cancelTabGroupPreview() {
      this.previewPanel?.panelOpener.clear();
    }

    showTabGroupPreview(group) {
      if (!this._showTabGroupHoverPreview) {
        return;
      }
      this.ensureTabPreviewPanelLoaded();
      this.previewPanel.activate(group);
    }

    on_TabGroupLabelHoverStart(event) {
      this.showTabGroupPreview(event.target.group);
    }

    on_TabGroupLabelHoverEnd(event) {
      this.previewPanel?.deactivate(event.target.group);
    }

    on_TabGroupExpand() {
      this._invalidateCachedVisibleTabs();
    }

    on_TabGroupCollapse() {
      this._invalidateCachedVisibleTabs();
      this._unlockTabSizing();
    }

    on_TabGroupCreate() {
      this._invalidateCachedTabs();
    }

    on_TabGroupRemoved() {
      this._invalidateCachedTabs();
    }

    /**
     * @param {TransitionEvent} event
     */
    on_transitionend(event) {
      if (event.propertyName != "max-width") {
        return;
      }

      let tab = event.target?.closest("tab");

      if (!tab) {
        return;
      }

      if (tab.hasAttribute("fadein")) {
        if (tab._fullyOpen) {
          this._updateCloseButtons();
        } else {
          this._handleNewTab(tab);
        }
      } else if (tab.closing) {
        gBrowser._endRemoveTab(tab);
      }

      let evt = new CustomEvent("TabAnimationEnd", { bubbles: true });
      tab.dispatchEvent(evt);
    }

    on_dblclick(event) {
      // When the tabbar has an unified appearance with the titlebar
      // and menubar, a double-click in it should have the same behavior
      // as double-clicking the titlebar
      if (CustomTitlebar.enabled && !this.verticalMode) {
        return;
      }

      // Make sure it is the primary button, we are hitting our arrowscrollbox,
      // and we're not hitting the scroll buttons.
      if (
        event.button != 0 ||
        event.target != this.arrowScrollbox ||
        event.composedTarget.localName == "toolbarbutton"
      ) {
        return;
      }

      if (!this._blockDblClick) {
        BrowserCommands.openTab();
      }

      event.preventDefault();
    }

    on_click(event) {
      if (event.eventPhase == Event.CAPTURING_PHASE && event.button == 0) {
        /* Catches extra clicks meant for the in-tab close button.
         * Placed here to avoid leaking (a temporary handler added from the
         * in-tab close button binding would close over the tab and leak it
         * until the handler itself was removed). (bug 897751)
         *
         * The only sequence in which a second click event (i.e. dblclik)
         * can be dispatched on an in-tab close button is when it is shown
         * after the first click (i.e. the first click event was dispatched
         * on the tab). This happens when we show the close button only on
         * the active tab. (bug 352021)
         * The only sequence in which a third click event can be dispatched
         * on an in-tab close button is when the tab was opened with a
         * double click on the tabbar. (bug 378344)
         * In both cases, it is most likely that the close button area has
         * been accidentally clicked, therefore we do not close the tab.
         *
         * We don't want to ignore processing of more than one click event,
         * though, since the user might actually be repeatedly clicking to
         * close many tabs at once.
         */
        let target = event.originalTarget;
        if (target.classList.contains("tab-close-button")) {
          // We preemptively set this to allow the closing-multiple-tabs-
          // in-a-row case.
          if (this._blockDblClick) {
            target._ignoredCloseButtonClicks = true;
          } else if (event.detail > 1 && !target._ignoredCloseButtonClicks) {
            target._ignoredCloseButtonClicks = true;
            event.stopPropagation();
            return;
          } else {
            // Reset the "ignored click" flag
            target._ignoredCloseButtonClicks = false;
          }
        }

        /* Protects from close-tab-button errant doubleclick:
         * Since we're removing the event target, if the user
         * double-clicks the button, the dblclick event will be dispatched
         * with the tabbar as its event target (and explicit/originalTarget),
         * which treats that as a mouse gesture for opening a new tab.
         * In this context, we're manually blocking the dblclick event.
         */
        if (this._blockDblClick) {
          if (!("_clickedTabBarOnce" in this)) {
            this._clickedTabBarOnce = true;
            return;
          }
          delete this._clickedTabBarOnce;
          this._blockDblClick = false;
        }
      } else if (
        event.eventPhase == Event.BUBBLING_PHASE &&
        event.button == 1
      ) {
        let tab = event.target?.closest("tab");
        if (tab) {
          if (tab.multiselected) {
            gBrowser.removeMultiSelectedTabs();
          } else {
            gBrowser.removeTab(tab, {
              animate: true,
              triggeringEvent: event,
            });
          }
        } else if (isTabGroupLabel(event.target)) {
          event.target.group.saveAndClose();
        } else if (
          event.originalTarget.closest("scrollbox") &&
          !Services.prefs.getBoolPref(
            "widget.gtk.titlebar-action-middle-click-enabled"
          )
        ) {
          // Check whether the click
          // was dispatched on the open space of it.
          let visibleTabs = this.visibleTabs;
          let lastTab = visibleTabs.at(-1);
          let winUtils = window.windowUtils;
          let endOfTab =
            winUtils.getBoundsWithoutFlushing(lastTab)[
              (this.verticalMode && "bottom") ||
                (this.#rtlMode ? "left" : "right")
            ];
          if (
            (this.verticalMode && event.clientY > endOfTab) ||
            (!this.verticalMode &&
              (this.#rtlMode
                ? event.clientX < endOfTab
                : event.clientX > endOfTab))
          ) {
            BrowserCommands.openTab();
          }
        } else {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
      }
    }

    on_keydown(event) {
      let { altKey, shiftKey } = event;
      let [accel, nonAccel] =
        AppConstants.platform == "macosx"
          ? [event.metaKey, event.ctrlKey]
          : [event.ctrlKey, event.metaKey];

      let keyComboForFocusedElement =
        !accel && !shiftKey && !altKey && !nonAccel;
      let keyComboForMove = accel && shiftKey && !altKey && !nonAccel;
      let keyComboForFocus = accel && !shiftKey && !altKey && !nonAccel;

      if (!keyComboForFocusedElement && !keyComboForMove && !keyComboForFocus) {
        return;
      }

      if (keyComboForFocusedElement) {
        let ariaFocusedItem = this.ariaFocusedItem;
        if (isTabGroupLabel(ariaFocusedItem)) {
          switch (event.keyCode) {
            case KeyEvent.DOM_VK_SPACE:
            case KeyEvent.DOM_VK_RETURN: {
              ariaFocusedItem.click();
              event.preventDefault();
            }
          }
        }
      } else if (keyComboForMove) {
        switch (event.keyCode) {
          case KeyEvent.DOM_VK_UP:
            gBrowser.moveTabBackward();
            break;
          case KeyEvent.DOM_VK_DOWN:
            gBrowser.moveTabForward();
            break;
          case KeyEvent.DOM_VK_RIGHT:
            if (RTL_UI) {
              gBrowser.moveTabBackward();
            } else {
              gBrowser.moveTabForward();
            }
            break;
          case KeyEvent.DOM_VK_LEFT:
            if (RTL_UI) {
              gBrowser.moveTabForward();
            } else {
              gBrowser.moveTabBackward();
            }
            break;
          case KeyEvent.DOM_VK_HOME:
            gBrowser.moveTabToStart();
            break;
          case KeyEvent.DOM_VK_END:
            gBrowser.moveTabToEnd();
            break;
          default:
            // Consume the keydown event for the above keyboard
            // shortcuts only.
            return;
        }

        event.preventDefault();
      } else if (keyComboForFocus) {
        switch (event.keyCode) {
          case KeyEvent.DOM_VK_UP:
            this.#advanceFocus(DIRECTION_BACKWARD);
            break;
          case KeyEvent.DOM_VK_DOWN:
            this.#advanceFocus(DIRECTION_FORWARD);
            break;
          case KeyEvent.DOM_VK_RIGHT:
            if (RTL_UI) {
              this.#advanceFocus(DIRECTION_BACKWARD);
            } else {
              this.#advanceFocus(DIRECTION_FORWARD);
            }
            break;
          case KeyEvent.DOM_VK_LEFT:
            if (RTL_UI) {
              this.#advanceFocus(DIRECTION_FORWARD);
            } else {
              this.#advanceFocus(DIRECTION_BACKWARD);
            }
            break;
          case KeyEvent.DOM_VK_HOME:
            this.ariaFocusedItem = this.ariaFocusableItems.at(0);
            break;
          case KeyEvent.DOM_VK_END:
            this.ariaFocusedItem = this.ariaFocusableItems.at(-1);
            break;
          case KeyEvent.DOM_VK_SPACE: {
            let ariaFocusedItem = this.ariaFocusedItem;
            if (isTab(ariaFocusedItem)) {
              if (ariaFocusedItem.multiselected) {
                gBrowser.removeFromMultiSelectedTabs(ariaFocusedItem);
              } else {
                gBrowser.addToMultiSelectedTabs(ariaFocusedItem);
              }
            }
            break;
          }
          default:
            // Consume the keydown event for the above keyboard
            // shortcuts only.
            return;
        }

        event.preventDefault();
      }
    }

    /**
     * @param {FocusEvent} event
     */
    on_focusin(event) {
      if (event.target == this.selectedItem) {
        this.tablistHasFocus = true;
        if (!this.ariaFocusedItem) {
          // If the active tab is receiving focus and there isn't a keyboard
          // focus target yet, set the keyboard focus target to the active
          // tab. Do not override the keyboard-focused item if the user
          // already set a keyboard focus.
          this.ariaFocusedItem = this.selectedItem;
        }
      }
      let focusReturnedFromGroupPanel = event.relatedTarget?.classList.contains(
        "group-preview-button"
      );
      if (
        !focusReturnedFromGroupPanel &&
        this.tablistHasFocus &&
        isTabGroupLabel(this.ariaFocusedItem)
      ) {
        this.showTabGroupPreview(this.ariaFocusedItem.group);
      }
    }

    /**
     * @param {FocusEvent} event
     */
    on_focusout(event) {
      this.cancelTabGroupPreview();
      if (event.target == this.selectedItem) {
        this.tablistHasFocus = false;
      }
    }

    on_keypress(event) {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key == " " || event.key == "Enter") {
        event.preventDefault();
        event.target.click();
      }
    }

    on_dragstart(event) {
      this.tabDragAndDrop.handle_dragstart(event);
    }

    on_dragover(event) {
      this.tabDragAndDrop.handle_dragover(event);
    }

    on_drop(event) {
      this.tabDragAndDrop.handle_drop(event);
    }

    on_dragend(event) {
      this.tabDragAndDrop.handle_dragend(event);
    }

    on_dragleave(event) {
      this.tabDragAndDrop.handle_dragleave(event);
    }

    on_wheel(event) {
      if (
        Services.prefs.getBoolPref("toolkit.tabbox.switchByScrolling", false)
      ) {
        event.stopImmediatePropagation();
      }
    }

    on_overflow(event) {
      // Ignore overflow events from nested scrollable elements
      if (event.target != this.arrowScrollbox) {
        return;
      }

      this.toggleAttribute("overflow", true);
      this._updateCloseButtons();
      this._handleTabSelect(true);

      document
        .getElementById("tab-preview-panel")
        ?.setAttribute("rolluponmousewheel", true);
    }

    on_underflow(event) {
      // Ignore underflow events:
      // - from nested scrollable elements
      // - corresponding to an overflow event that we ignored
      if (event.target != this.arrowScrollbox || !this.overflowing) {
        return;
      }

      this.removeAttribute("overflow");

      if (this._lastTabClosedByMouse) {
        this._expandSpacerBy(this._scrollButtonWidth);
      }

      for (let tab of gBrowser._removingTabs) {
        gBrowser.removeTab(tab);
      }

      this._updateCloseButtons();

      document
        .getElementById("tab-preview-panel")
        ?.removeAttribute("rolluponmousewheel");
    }

    on_contextmenu(event) {
      // When pressing the context menu key (as opposed to right-clicking)
      // while a tab group label has aria focus (as opposed to DOM focus),
      // open the tab group context menu as if the label had DOM focus.
      // The button property is used to differentiate between key and mouse.
      if (event.button == 0 && isTabGroupLabel(this.ariaFocusedItem)) {
        gBrowser.tabGroupMenu.openEditModal(this.ariaFocusedItem.group);
        event.preventDefault();
      }
    }

    // Utilities

    get emptyTabTitle() {
      // Normal tab title is used also in the permanent private browsing mode.
      const l10nId =
        PrivateBrowsingUtils.isWindowPrivate(window) &&
        !Services.prefs.getBoolPref("browser.privatebrowsing.autostart")
          ? "tabbrowser-empty-private-tab-title"
          : "tabbrowser-empty-tab-title";
      return gBrowser.tabLocalization.formatValueSync(l10nId);
    }

    get tabbox() {
      return document.getElementById("tabbrowser-tabbox");
    }

    get newTabButton() {
      return this.querySelector("#tabs-newtab-button");
    }

    get verticalMode() {
      return this.getAttribute("orient") == "vertical";
    }

    get expandOnHover() {
      return this._sidebarVisibility == "expand-on-hover";
    }

    get #rtlMode() {
      return !this.verticalMode && RTL_UI;
    }

    get overflowing() {
      return this.hasAttribute("overflow");
    }

    #allTabs;
    get allTabs() {
      if (this.#allTabs) {
        return this.#allTabs;
      }
      // Remove temporary periphery element added at drag start.
      let pinnedChildren = Array.from(this.pinnedTabsContainer.children);
      if (pinnedChildren?.at(-1)?.id == "pinned-tabs-container-periphery") {
        pinnedChildren.pop();
      }
      let unpinnedChildren = Array.from(this.arrowScrollbox.children);
      // remove arrowScrollbox periphery element.
      unpinnedChildren.pop();

      // explode tab groups and split view wrappers
      // Iterate backwards over the array to preserve indices while we modify
      // things in place
      for (let i = unpinnedChildren.length - 1; i >= 0; i--) {
        if (
          unpinnedChildren[i].tagName == "tab-group" ||
          unpinnedChildren[i].tagName == "tab-split-view-wrapper"
        ) {
          unpinnedChildren.splice(i, 1, ...unpinnedChildren[i].tabs);
        }
      }

      this.#allTabs = [...pinnedChildren, ...unpinnedChildren];
      return this.#allTabs;
    }

    get allGroups() {
      let children = Array.from(this.arrowScrollbox.children);
      return children.filter(node => node.tagName == "tab-group");
    }

    /**
     * Returns all tabs in the current window, including hidden tabs and tabs
     * in collapsed groups, but excluding closing tabs and the Firefox View tab.
     */
    get openTabs() {
      if (!this.#openTabs) {
        this.#openTabs = this.allTabs.filter(tab => tab.isOpen);
      }
      return this.#openTabs;
    }
    #openTabs;

    /**
     * Same as `openTabs` but excluding hidden tabs.
     */
    get nonHiddenTabs() {
      if (!this.#nonHiddenTabs) {
        this.#nonHiddenTabs = this.openTabs.filter(tab => !tab.hidden);
      }
      return this.#nonHiddenTabs;
    }
    #nonHiddenTabs;

    /**
     * Same as `openTabs` but excluding hidden tabs and tabs in collapsed groups.
     */
    get visibleTabs() {
      if (!this.#visibleTabs) {
        this.#visibleTabs = this.openTabs.filter(tab => tab.visible);
      }
      return this.#visibleTabs;
    }
    #visibleTabs;

    /**
     * @returns {boolean} true if the keyboard focus is on the active tab
     */
    get tablistHasFocus() {
      return this.hasAttribute("tablist-has-focus");
    }

    /**
     * @param {boolean} hasFocus true if the keyboard focus is on the active tab
     */
    set tablistHasFocus(hasFocus) {
      this.toggleAttribute("tablist-has-focus", hasFocus);
    }

    /** @typedef {MozTabbrowserTab|MozTextLabel} FocusableItem */

    /** @type {FocusableItem[]} */
    #focusableItems;

    /**
     * @returns {FocusableItem[]}
     * @override tabbox.js:TabsBase
     */
    get ariaFocusableItems() {
      if (this.#focusableItems) {
        return this.#focusableItems;
      }

      let elementIndex = 0;

      let unpinnedChildren = Array.from(this.arrowScrollbox.children);
      let pinnedChildren = Array.from(this.pinnedTabsContainer.children);

      let focusableItems = [];
      for (let child of pinnedChildren) {
        if (isTab(child)) {
          child.elementIndex = elementIndex++;
          focusableItems.push(child);
        }
      }
      for (let child of unpinnedChildren) {
        if (isTab(child) && child.visible) {
          child.elementIndex = elementIndex++;
          focusableItems.push(child);
        } else if (isTabGroup(child)) {
          child.labelElement.elementIndex = elementIndex++;
          focusableItems.push(child.labelElement);

          let visibleTabsInGroup = child.tabs.filter(tab => tab.visible);
          visibleTabsInGroup.forEach(tab => {
            tab.elementIndex = elementIndex++;
          });
          focusableItems.push(...visibleTabsInGroup);
        } else if (child.tagName == "tab-split-view-wrapper") {
          let visibleTabsInSplitView = child.tabs.filter(tab => tab.visible);
          visibleTabsInSplitView.forEach(tab => {
            tab.elementIndex = elementIndex++;
          });
          focusableItems.push(...visibleTabsInSplitView);
        }
      }

      this.#focusableItems = focusableItems;

      return this.#focusableItems;
    }

    /**
     * Moves the ARIA focus in the tab strip left or right, as appropriate, to
     * the next tab or tab group label.
     *
     * @param {-1|1} direction
     */
    #advanceFocus(direction) {
      let currentIndex = this.ariaFocusableItems.indexOf(this.ariaFocusedItem);
      let newIndex = currentIndex + direction;

      // Clamp the index so that the focus stops at the edges of the tab strip
      newIndex = Math.min(
        this.ariaFocusableItems.length - 1,
        Math.max(0, newIndex)
      );

      let itemToFocus = this.ariaFocusableItems[newIndex];
      this.ariaFocusedItem = itemToFocus;

      // If the newly-focused item is a tab group label and the group is collapsed,
      // proactively show the tab group preview
      if (isTabGroupLabel(this.ariaFocusedItem)) {
        this.showTabGroupPreview(this.ariaFocusedItem.group);
      }
    }

    _invalidateCachedTabs() {
      this.#allTabs = null;
      this._invalidateCachedVisibleTabs();
    }

    _invalidateCachedVisibleTabs() {
      this.#openTabs = null;
      this.#nonHiddenTabs = null;
      this.#visibleTabs = null;
      // Focusable items must also be visible, but they do not depend on
      // this.#visibleTabs, so changes to visible tabs need to also invalidate
      // the focusable items cache
      this.#focusableItems = null;
    }

    #isMovingTab() {
      return this.hasAttribute("movingtab");
    }

    /**
     * Changes the selected tab or tab group label on the tab strip
     * relative to the ARIA-focused tab strip element or the active tab. This
     * is intended for traversing the tab strip visually, e.g by using keyboard
     * arrows. For cases where keyboard shortcuts or other logic should only
     * select tabs (and never tab group labels), see `advanceSelectedTab`.
     *
     * @override
     * @param {-1|1} direction
     * @param {boolean} shouldWrap
     */
    advanceSelectedItem(aDir, aWrap) {
      let groupPanel = this.previewPanel?.tabGroupPanel;
      if (groupPanel && groupPanel.isActive) {
        // if the group panel is open, it should receive keyboard focus here
        // instead of moving to the next item in the tabstrip.
        groupPanel.focusPanel(aDir);
        return;
      }

      // cancel any pending group popup since we expect to deselect the label
      this.cancelTabGroupPreview();

      let { ariaFocusableItems, ariaFocusedIndex } = this;

      // Advance relative to the ARIA-focused item if set, otherwise advance
      // relative to the active tab.
      let currentItemIndex =
        ariaFocusedIndex >= 0
          ? ariaFocusedIndex
          : ariaFocusableItems.indexOf(this.selectedItem);

      let newItemIndex = currentItemIndex + aDir;

      if (aWrap) {
        if (newItemIndex >= ariaFocusableItems.length) {
          newItemIndex = 0;
        } else if (newItemIndex < 0) {
          newItemIndex = ariaFocusableItems.length - 1;
        }
      } else {
        newItemIndex = Math.min(
          ariaFocusableItems.length - 1,
          Math.max(0, newItemIndex)
        );
      }

      if (currentItemIndex == newItemIndex) {
        return;
      }

      // If the next item is a tab, select it. If the next item is a tab group
      // label, keep the active tab selected and just set ARIA focus on the tab
      // group label.
      let newItem = ariaFocusableItems[newItemIndex];
      if (isTab(newItem)) {
        this._selectNewTab(newItem, aDir, aWrap);
      }
      this.ariaFocusedItem = newItem;

      // If the newly-focused item is a tab group label and the group is collapsed,
      // proactively show the tab group preview
      if (isTabGroupLabel(this.ariaFocusedItem)) {
        this.showTabGroupPreview(this.ariaFocusedItem.group);
      }
    }

    ensureTabPreviewPanelLoaded() {
      if (!this.previewPanel) {
        const TabHoverPanelSet = ChromeUtils.importESModule(
          "chrome://browser/content/tabbrowser/tab-hover-preview.mjs"
        ).default;
        this.previewPanel = new TabHoverPanelSet(window);
      }
    }

    appendChild(tab) {
      return this.insertBefore(tab, null);
    }

    insertBefore(tab, node) {
      if (!this.arrowScrollbox) {
        throw new Error("Shouldn't call this without arrowscrollbox");
      }

      if (node == null) {
        // We have a container for non-tab elements at the end of the scrollbox.
        node = this.arrowScrollbox.lastChild;
      }

      node.before(tab);

      if (this.#mustUpdateTabMinHeight) {
        this.#updateTabMinHeight();
      }
    }

    #updateTabMinWidth(val) {
      this.style.setProperty(
        "--tab-min-width-pref",
        (val ?? this._tabMinWidthPref) + "px"
      );
    }

    #updateTabMinHeight() {
      if (!this.verticalMode || !window.toolbar.visible) {
        this.#mustUpdateTabMinHeight = false;
        return;
      }

      // Find at least one tab we can scroll to.
      let firstScrollableTab = this.visibleTabs.find(
        this.arrowScrollbox._canScrollToElement
      );

      if (!firstScrollableTab) {
        // If not, we're in a pickle. We should never get here except if we
        // also don't use the outcome of this work (because there's nothing to
        // scroll so we don't care about the scrollbox size).
        // So just set a flag so we re-run once we do have a new tab.
        this.#mustUpdateTabMinHeight = true;
        return;
      }

      let { height } =
        window.windowUtils.getBoundsWithoutFlushing(firstScrollableTab);

      // Use the current known height or a sane default.
      this.#tabMinHeight = height || 36;

      // The height we got may be incorrect if a flush is pending so re-check it after
      // a flush completes.
      window
        .promiseDocumentFlushed(() => {})
        .then(
          () => {
            height =
              window.windowUtils.getBoundsWithoutFlushing(
                firstScrollableTab
              ).height;

            if (height) {
              this.#tabMinHeight = height;
            }
          },
          () => {
            /* ignore errors */
          }
        );
    }

    get _isCustomizing() {
      return document.documentElement.hasAttribute("customizing");
    }

    // This overrides the TabsBase _selectNewTab method so that we can
    // potentially interrupt keyboard tab switching when sharing the
    // window or screen.
    _selectNewTab(aNewTab, aFallbackDir, aWrap) {
      if (!gSharedTabWarning.willShowSharedTabWarning(aNewTab)) {
        super._selectNewTab(aNewTab, aFallbackDir, aWrap);
      }
    }

    observe(aSubject, aTopic) {
      switch (aTopic) {
        case "nsPref:changed": {
          // This is has to deal with changes in
          // privacy.userContext.enabled and
          // privacy.userContext.newTabContainerOnLeftClick.enabled.
          let containersEnabled =
            Services.prefs.getBoolPref("privacy.userContext.enabled") &&
            !PrivateBrowsingUtils.isWindowPrivate(window);

          // This pref won't change so often, so just recreate the menu.
          const newTabLeftClickOpensContainersMenu = Services.prefs.getBoolPref(
            "privacy.userContext.newTabContainerOnLeftClick.enabled"
          );

          // There are separate "new tab" buttons for horizontal tabs toolbar, vertical tabs and
          // for when the tab strip is overflowed (which is shared by vertical and horizontal tabs);
          // Attach the long click popup to all of them.
          const newTab = document.getElementById("new-tab-button");
          const newTab2 = this.newTabButton;
          const newTabVertical = document.getElementById(
            "vertical-tabs-newtab-button"
          );

          for (let parent of [newTab, newTab2, newTabVertical]) {
            if (!parent) {
              continue;
            }

            parent.removeAttribute("type");
            if (parent.menupopup) {
              parent.menupopup.remove();
            }

            if (containersEnabled) {
              parent.setAttribute("context", "new-tab-button-popup");

              let popup = document
                .getElementById("new-tab-button-popup")
                .cloneNode(true);
              popup.removeAttribute("id");
              popup.className = "new-tab-popup";
              popup.setAttribute("position", "after_end");
              popup.addEventListener("popupshowing", CreateContainerTabMenu);
              parent.prepend(popup);
              parent.setAttribute("type", "menu");
              // Update tooltip text
              DynamicShortcutTooltip.nodeToTooltipMap[parent.id] =
                newTabLeftClickOpensContainersMenu
                  ? "newTabAlwaysContainer.tooltip"
                  : "newTabContainer.tooltip";
            } else {
              DynamicShortcutTooltip.nodeToTooltipMap[parent.id] =
                "newTabButton.tooltip";
              parent.removeAttribute("context", "new-tab-button-popup");
            }
            // evict from tooltip cache
            DynamicShortcutTooltip.cache.delete(parent.id);

            // If containers and press-hold container menu are both used,
            // add to gClickAndHoldListenersOnElement; otherwise, remove.
            if (containersEnabled && !newTabLeftClickOpensContainersMenu) {
              gClickAndHoldListenersOnElement.add(parent);
            } else {
              gClickAndHoldListenersOnElement.remove(parent);
            }
          }

          break;
        }
      }
    }

    _updateCloseButtons() {
      if (this.overflowing) {
        // Tabs are at their minimum widths.
        this.setAttribute("closebuttons", "activetab");
        return;
      }

      if (this._closeButtonsUpdatePending) {
        return;
      }
      this._closeButtonsUpdatePending = true;

      // Wait until after the next paint to get current layout data from
      // getBoundsWithoutFlushing.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          this._closeButtonsUpdatePending = false;

          // The scrollbox may have started overflowing since we checked
          // overflow earlier, so check again.
          if (this.overflowing) {
            this.setAttribute("closebuttons", "activetab");
            return;
          }

          // Check if tab widths are below the threshold where we want to
          // remove close buttons from background tabs so that people don't
          // accidentally close tabs by selecting them.
          let rect = ele => {
            return window.windowUtils.getBoundsWithoutFlushing(ele);
          };
          let tab = this.visibleTabs[gBrowser.pinnedTabCount];
          if (tab && rect(tab).width <= this._tabClipWidth) {
            this.setAttribute("closebuttons", "activetab");
          } else {
            this.removeAttribute("closebuttons");
          }
        });
      });
    }

    /**
     * @param {boolean} [aInstant]
     */
    _handleTabSelect(aInstant) {
      let selectedTab = this.selectedItem;
      this.#ensureTabIsVisible(selectedTab, aInstant);

      selectedTab._notselectedsinceload = false;
    }

    /**
     * @param {MozTabbrowserTab} tab
     * @param {boolean} [shouldScrollInstantly=false]
     */
    #ensureTabIsVisible(tab, shouldScrollInstantly = false) {
      let arrowScrollbox = tab.closest("arrowscrollbox");
      if (arrowScrollbox?.overflowing) {
        arrowScrollbox.ensureElementIsVisible(tab, shouldScrollInstantly);
      }
    }

    /**
     * Try to keep the active tab's close button under the mouse cursor
     */
    _lockTabSizing(aClosingTab, aTabWidth) {
      if (this.verticalMode) {
        return;
      }

      let tabs = this.visibleTabs;
      let numPinned = gBrowser.pinnedTabCount;

      if (tabs.length <= numPinned) {
        // There are no unpinned tabs left.
        return;
      }

      let isEndTab = aClosingTab && aClosingTab._tPos > tabs.at(-1)._tPos;

      if (!this._tabDefaultMaxWidth) {
        this._tabDefaultMaxWidth = parseFloat(
          window.getComputedStyle(tabs[numPinned]).maxWidth
        );
      }
      this._lastTabClosedByMouse = true;
      this._scrollButtonWidth = window.windowUtils.getBoundsWithoutFlushing(
        this.arrowScrollbox._scrollButtonDown
      ).width;
      if (aTabWidth === undefined) {
        aTabWidth = window.windowUtils.getBoundsWithoutFlushing(
          tabs[numPinned]
        ).width;
      }

      if (this.overflowing) {
        // Don't need to do anything if we're in overflow mode and aren't scrolled
        // all the way to the right, or if we're closing the last tab.
        if (isEndTab || !this.arrowScrollbox.hasAttribute("scrolledtoend")) {
          return;
        }
        // If the tab has an owner that will become the active tab, the owner will
        // be to the left of it, so we actually want the left tab to slide over.
        // This can't be done as easily in non-overflow mode, so we don't bother.
        if (aClosingTab?.owner) {
          return;
        }
        this._expandSpacerBy(aTabWidth);
      } /* non-overflow mode */ else {
        if (isEndTab && !this._hasTabTempMaxWidth) {
          // Locking is neither in effect nor needed, so let tabs expand normally.
          return;
        }
        // Force tabs to stay the same width, unless we're closing the last tab,
        // which case we need to let them expand just enough so that the overall
        // tabbar width is the same.
        if (isEndTab) {
          let numNormalTabs = tabs.length - numPinned;
          aTabWidth = (aTabWidth * (numNormalTabs + 1)) / numNormalTabs;
          if (aTabWidth > this._tabDefaultMaxWidth) {
            aTabWidth = this._tabDefaultMaxWidth;
          }
        }
        aTabWidth += "px";
        let tabsToReset = [];
        for (let i = numPinned; i < tabs.length; i++) {
          let tab = tabs[i];
          tab.style.setProperty("max-width", aTabWidth, "important");
          if (!isEndTab) {
            // keep tabs the same width
            tab.style.transition = "none";
            tabsToReset.push(tab);
          }
        }

        if (tabsToReset.length) {
          window
            .promiseDocumentFlushed(() => {})
            .then(() => {
              window.requestAnimationFrame(() => {
                for (let tab of tabsToReset) {
                  tab.style.transition = "";
                }
              });
            });
        }

        this._hasTabTempMaxWidth = true;
        gBrowser.addEventListener("mousemove", this);
        window.addEventListener("mouseout", this);
      }
    }

    _expandSpacerBy(pixels) {
      let spacer = this._closingTabsSpacer;
      spacer.style.width = parseFloat(spacer.style.width) + pixels + "px";
      this.toggleAttribute("using-closing-tabs-spacer", true);
      gBrowser.addEventListener("mousemove", this);
      window.addEventListener("mouseout", this);
    }

    _unlockTabSizing() {
      gBrowser.removeEventListener("mousemove", this);
      window.removeEventListener("mouseout", this);

      if (this._hasTabTempMaxWidth) {
        this._hasTabTempMaxWidth = false;
        // Only visible tabs have their sizes locked, but those visible tabs
        // could become invisible before being unlocked (e.g. by being inside
        // of a collapsing tab group), so it's better to reset all tabs.
        let tabs = this.allTabs;
        for (let i = 0; i < tabs.length; i++) {
          tabs[i].style.maxWidth = "";
        }
      }

      if (this.hasAttribute("using-closing-tabs-spacer")) {
        this.removeAttribute("using-closing-tabs-spacer");
        this._closingTabsSpacer.style.width = 0;
      }
    }

    uiDensityChanged() {
      this._updateCloseButtons();
      this.#updateTabMinHeight();
      this._handleTabSelect(true);
    }

    _notifyBackgroundTab(aTab) {
      if (aTab.pinned || !aTab.visible || !this.overflowing) {
        return;
      }

      this._lastTabToScrollIntoView = aTab;
      if (!this._backgroundTabScrollPromise) {
        this._backgroundTabScrollPromise = window
          .promiseDocumentFlushed(() => {
            let lastTabRect =
              this._lastTabToScrollIntoView.getBoundingClientRect();
            let selectedTab = this.selectedItem;
            if (selectedTab.pinned) {
              selectedTab = null;
            } else {
              selectedTab = selectedTab.getBoundingClientRect();
              selectedTab = {
                left: selectedTab.left,
                right: selectedTab.right,
                top: selectedTab.top,
                bottom: selectedTab.bottom,
              };
            }
            return [
              this._lastTabToScrollIntoView,
              this.arrowScrollbox.scrollClientRect,
              lastTabRect,
              selectedTab,
            ];
          })
          .then(([tabToScrollIntoView, scrollRect, tabRect, selectedRect]) => {
            // First off, remove the promise so we can re-enter if necessary.
            delete this._backgroundTabScrollPromise;
            // Then, if the layout info isn't for the last-scrolled-to-tab, re-run
            // the code above to get layout info for *that* tab, and don't do
            // anything here, as we really just want to run this for the last-opened tab.
            if (this._lastTabToScrollIntoView != tabToScrollIntoView) {
              this._notifyBackgroundTab(this._lastTabToScrollIntoView);
              return;
            }
            delete this._lastTabToScrollIntoView;
            // Is the new tab already completely visible?
            if (
              this.verticalMode
                ? scrollRect.top <= tabRect.top &&
                  tabRect.bottom <= scrollRect.bottom
                : scrollRect.left <= tabRect.left &&
                  tabRect.right <= scrollRect.right
            ) {
              return;
            }

            if (this.arrowScrollbox.smoothScroll) {
              // Can we make both the new tab and the selected tab completely visible?
              if (
                !selectedRect ||
                (this.verticalMode
                  ? Math.max(
                      tabRect.bottom - selectedRect.top,
                      selectedRect.bottom - tabRect.top
                    ) <= scrollRect.height
                  : Math.max(
                      tabRect.right - selectedRect.left,
                      selectedRect.right - tabRect.left
                    ) <= scrollRect.width)
              ) {
                this.#ensureTabIsVisible(tabToScrollIntoView);
                return;
              }

              let scrollPixels;
              if (this.verticalMode) {
                scrollPixels = tabRect.top - selectedRect.top;
              } else if (this.#rtlMode) {
                scrollPixels = selectedRect.right - scrollRect.right;
              } else {
                scrollPixels = selectedRect.left - scrollRect.left;
              }
              this.arrowScrollbox.scrollByPixels(scrollPixels);
            }

            if (!this._animateElement.hasAttribute("highlight")) {
              this._animateElement.toggleAttribute("highlight", true);
              setTimeout(
                function (ele) {
                  ele.removeAttribute("highlight");
                },
                150,
                this._animateElement
              );
            }
          });
      }
    }

    _handleNewTab(tab) {
      if (tab.container != this) {
        return;
      }
      tab._fullyOpen = true;
      gBrowser.tabAnimationsInProgress--;

      this._updateCloseButtons();

      if (tab.hasAttribute("selected")) {
        this._handleTabSelect();
      } else if (!tab.hasAttribute("skipbackgroundnotify")) {
        this._notifyBackgroundTab(tab);
      }

      // If this browser isn't lazy (indicating it's probably created by
      // session restore), preload the next about:newtab if we don't
      // already have a preloaded browser.
      if (tab.linkedPanel) {
        NewTabPagePreloading.maybeCreatePreloadedBrowser(window);
      }

      if (UserInteraction.running("browser.tabs.opening", window)) {
        UserInteraction.finish("browser.tabs.opening", window);
      }
    }

    _canAdvanceToTab(aTab) {
      return !aTab.closing;
    }

    /**
     * Returns the panel associated with a tab if it has a connected browser
     * and/or it is the selected tab.
     * For background lazy browsers, this will return null.
     */
    getRelatedElement(aTab) {
      if (!aTab) {
        return null;
      }

      // Cannot access gBrowser before it's initialized.
      if (!gBrowser._initialized) {
        return this.tabbox.tabpanels.firstElementChild;
      }

      // If the tab's browser is lazy, we need to `_insertBrowser` in order
      // to have a linkedPanel.  This will also serve to bind the browser
      // and make it ready to use. We only do this if the tab is selected
      // because otherwise, callers might end up unintentionally binding the
      // browser for lazy background tabs.
      if (!aTab.linkedPanel) {
        if (!aTab.selected) {
          return null;
        }
        gBrowser._insertBrowser(aTab);
      }
      return document.getElementById(aTab.linkedPanel);
    }

    _updateNewTabVisibility() {
      // Helper functions to help deal with customize mode wrapping some items
      let wrap = n =>
        n.parentNode.localName == "toolbarpaletteitem" ? n.parentNode : n;
      let unwrap = n =>
        n && n.localName == "toolbarpaletteitem" ? n.firstElementChild : n;

      // Starting from the tabs element, find the next sibling that:
      // - isn't hidden; and
      // - isn't the all-tabs button.
      // If it's the new tab button, consider the new tab button adjacent to the tabs.
      // If the new tab button is marked as adjacent and the tabstrip doesn't
      // overflow, we'll display the 'new tab' button inline in the tabstrip.
      // In all other cases, the separate new tab button is displayed in its
      // customized location.
      let sib = this;
      do {
        sib = unwrap(wrap(sib).nextElementSibling);
      } while (sib && (sib.hidden || sib.id == "alltabs-button"));

      this.toggleAttribute(
        "hasadjacentnewtabbutton",
        sib && sib.id == "new-tab-button"
      );
    }

    onWidgetAfterDOMChange(aNode, aNextNode, aContainer) {
      if (
        aContainer.ownerDocument == document &&
        aContainer.id == "TabsToolbar-customization-target"
      ) {
        this._updateNewTabVisibility();
      }
    }

    onAreaNodeRegistered(aArea, aContainer) {
      if (aContainer.ownerDocument == document && aArea == "TabsToolbar") {
        this._updateNewTabVisibility();
      }
    }

    onAreaReset(aArea, aContainer) {
      this.onAreaNodeRegistered(aArea, aContainer);
    }

    _hiddenSoundPlayingStatusChanged(tab, opts) {
      let closed = opts && opts.closed;
      if (!closed && tab.soundPlaying && !tab.visible) {
        this._hiddenSoundPlayingTabs.add(tab);
        this.toggleAttribute("hiddensoundplaying", true);
      } else {
        this._hiddenSoundPlayingTabs.delete(tab);
        if (this._hiddenSoundPlayingTabs.size == 0) {
          this.removeAttribute("hiddensoundplaying");
        }
      }
    }

    destroy() {
      if (this.boundObserve) {
        Services.prefs.removeObserver("privacy.userContext", this.boundObserve);
      }
      CustomizableUI.removeListener(this);
    }

    updateTabSoundLabel(tab) {
      // Add aria-label for inline audio button
      const [unmute, mute, unblock] =
        gBrowser.tabLocalization.formatMessagesSync([
          "tabbrowser-unmute-tab-audio-aria-label",
          "tabbrowser-mute-tab-audio-aria-label",
          "tabbrowser-unblock-tab-audio-aria-label",
        ]);
      if (tab.audioButton) {
        if (tab.hasAttribute("muted") || tab.hasAttribute("soundplaying")) {
          let ariaLabel;
          tab.linkedBrowser.audioMuted
            ? (ariaLabel = unmute.attributes[0].value)
            : (ariaLabel = mute.attributes[0].value);
          tab.audioButton.setAttribute("aria-label", ariaLabel);
        } else if (tab.hasAttribute("activemedia-blocked")) {
          tab.audioButton.setAttribute(
            "aria-label",
            unblock.attributes[0].value
          );
        }
      }
    }
  }

  customElements.define("tabbrowser-tabs", MozTabbrowserTabs, {
    extends: "tabs",
  });
}
