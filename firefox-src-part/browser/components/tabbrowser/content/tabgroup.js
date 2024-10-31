/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// This is loaded into chrome windows with the subscript loader. Wrap in
// a block to prevent accidentally leaking globals onto `window`.
{
  class MozTabbrowserTabGroup extends MozXULElement {
    static markup = `
      <vbox class="tab-group-label-container" pack="center">
        <label class="tab-group-label"/>
      </vbox>
      <html:slot/>
      `;

    #labelElement;
    #colorCode;

    constructor() {
      super();
    }

    static get inheritedAttributes() {
      return {
        ".tab-group-label": "text=label,tooltiptext=label",
      };
    }

    connectedCallback() {
      if (this._initialized) {
        return;
      }

      this.textContent = "";
      this.appendChild(this.constructor.fragment);
      this.initializeAttributeInheritance();

      this._initialized = true;

      this.#labelElement = this.querySelector(".tab-group-label");
      this.#labelElement.addEventListener("click", this);

      this.createdDate = Date.now();

      this.addEventListener("TabSelect", this);

      this._tabsChangedObserver = new window.MutationObserver(mutationList => {
        for (let mutation of mutationList) {
          mutation.addedNodes.forEach(node => {
            node.tagName === "tab" &&
              node.dispatchEvent(
                new CustomEvent("TabGrouped", {
                  bubbles: true,
                  detail: this,
                })
              );
          });
          mutation.removedNodes.forEach(node => {
            node.tagName === "tab" &&
              node.dispatchEvent(
                new CustomEvent("TabUngrouped", {
                  bubbles: true,
                  detail: this,
                })
              );
          });
        }
        if (!this.tabs.length) {
          this.dispatchEvent(
            new CustomEvent("TabGroupRemove", { bubbles: true })
          );
          this.remove();
        }
      });
      this._tabsChangedObserver.observe(this, { childList: true });

      this.#labelElement.addEventListener("contextmenu", e => {
        e.preventDefault();
        gBrowser.tabGroupMenu.openEditModal(this);
        return false;
      });
    }

    disconnectedCallback() {
      this._tabsChangedObserver.disconnect();
    }

    get color() {
      return this.#colorCode;
    }

    set color(code) {
      this.#colorCode = code;
      this.style.setProperty(
        "--tab-group-color",
        `var(--tab-group-color-${code})`
      );
      this.style.setProperty(
        "--tab-group-color-invert",
        `var(--tab-group-color-${code}-invert)`
      );
      this.style.setProperty(
        "--tab-group-color-pale",
        `var(--tab-group-color-${code}-pale)`
      );
    }

    get id() {
      return this.getAttribute("id");
    }

    set id(val) {
      this.setAttribute("id", val);
    }

    get label() {
      return this.getAttribute("label");
    }

    set label(val) {
      this.setAttribute("label", val);
    }

    get collapsed() {
      return this.hasAttribute("collapsed");
    }

    set collapsed(val) {
      if (!!val == this.collapsed) {
        return;
      }
      this.toggleAttribute("collapsed", val);
      const eventName = val ? "TabGroupCollapse" : "TabGroupExpand";
      this.dispatchEvent(new CustomEvent(eventName, { bubbles: true }));
    }

    get tabs() {
      return Array.from(this.children).filter(node => node.matches("tab"));
    }

    /**
     * add tabs to the group
     *
     * @param tabs array of tabs to add
     */
    addTabs(tabs) {
      for (let tab of tabs) {
        gBrowser.moveTabToGroup(tab, this);
      }
    }

    /**
     * remove all tabs from the group and delete the group
     *
     */
    ungroupTabs() {
      for (let tab of this.tabs) {
        gBrowser.ungroupTab(tab);
      }
    }

    on_click(event) {
      if (event.target === this.#labelElement && event.button === 0) {
        event.preventDefault();
        this.collapsed = !this.collapsed;
      }
    }

    on_TabSelect() {
      this.collapsed = false;
    }
  }

  customElements.define("tab-group", MozTabbrowserTabGroup);
}
