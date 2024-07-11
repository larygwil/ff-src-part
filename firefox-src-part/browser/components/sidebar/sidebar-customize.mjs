/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, when } from "chrome://global/content/vendor/lit.all.mjs";

import { SidebarPage } from "./sidebar-page.mjs";

// eslint-disable-next-line import/no-unassigned-import
import "chrome://global/content/elements/moz-radio-group.mjs";

const l10nMap = new Map([
  ["viewGenaiChatSidebar", "sidebar-menu-genai-chat-label"],
  ["viewHistorySidebar", "sidebar-menu-history-label"],
  ["viewTabsSidebar", "sidebar-menu-synced-tabs-label"],
  ["viewBookmarksSidebar", "sidebar-menu-bookmarks-label"],
]);
const VISIBILITY_SETTING_PREF = "sidebar.visibility";

export class SidebarCustomize extends SidebarPage {
  constructor() {
    super();
    this.activeExtIndex = 0;
    this.visibility = Services.prefs.getStringPref(
      VISIBILITY_SETTING_PREF,
      "always-show"
    );
  }

  static properties = {
    activeExtIndex: { type: Number },
    visibility: { type: String },
  };

  static queries = {
    toolInputs: { all: ".customize-firefox-tools moz-checkbox" },
    extensionLinks: { all: ".extension-link" },
    positionInputs: { all: ".position-setting" },
    visibilityInputs: { all: ".visibility-setting" },
  };

  connectedCallback() {
    super.connectedCallback();
    this.getWindow().addEventListener("SidebarItemAdded", this);
    this.getWindow().addEventListener("SidebarItemChanged", this);
    this.getWindow().addEventListener("SidebarItemRemoved", this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.getWindow().removeEventListener("SidebarItemAdded", this);
    this.getWindow().removeEventListener("SidebarItemChanged", this);
    this.getWindow().removeEventListener("SidebarItemRemoved", this);
  }

  get sidebarLauncher() {
    return this.getWindow().document.querySelector("sidebar-launcher");
  }

  getWindow() {
    return window.browsingContext.embedderWindowGlobal.browsingContext.window;
  }

  handleEvent(e) {
    switch (e.type) {
      case "SidebarItemAdded":
      case "SidebarItemChanged":
      case "SidebarItemRemoved":
        this.requestUpdate();
        break;
    }
  }

  async onToggleInput(e) {
    e.preventDefault();
    this.getWindow().SidebarController.toggleTool(e.target.id);
  }

  getInputL10nId(view) {
    return l10nMap.get(view);
  }

  openFirefoxSettings(e) {
    e.preventDefault();
    if (e.type == "click" || (e.type == "keydown" && e.code == "Enter")) {
      this.getWindow().openPreferences();
    }
  }

  inputTemplate(tool) {
    if (tool.hidden) {
      return null;
    }
    return html`
      <moz-checkbox
        type="checkbox"
        id=${tool.view}
        name=${tool.view}
        iconsrc=${tool.iconUrl}
        data-l10n-id=${this.getInputL10nId(tool.view)}
        @change=${this.onToggleInput}
        ?checked=${!tool.disabled}
      />
    `;
  }

  async manageAddon(extensionId) {
    await this.getWindow().BrowserAddonUI.manageAddon(
      extensionId,
      "unifiedExtensions"
    );
  }

  handleKeydown(e) {
    if (e.code == "ArrowUp") {
      if (this.activeExtIndex >= 0) {
        this.focusIndex(this.activeExtIndex - 1);
      }
    } else if (e.code == "ArrowDown") {
      if (this.activeExtIndex < this.extensionLinks.length) {
        this.focusIndex(this.activeExtIndex + 1);
      }
    } else if (
      (e.type == "keydown" && e.code == "Enter") ||
      (e.type == "keydown" && e.code == "Space")
    ) {
      this.manageAddon(e.target.getAttribute("extensionId"));
    }
  }

  focusIndex(index) {
    let extLinkList = Array.from(
      this.shadowRoot.querySelectorAll(".extension-link")
    );
    extLinkList[index].focus();
    this.activeExtIndex = index;
  }

  reversePosition() {
    const SidebarController = this.getWindow().SidebarController;
    SidebarController.reversePosition.apply(SidebarController);
  }

  extensionTemplate(extension, index) {
    return html` <div class="extension-item">
      <img src=${extension.iconUrl} class="icon" role="presentation" />
      <div
        class="extension-link"
        extensionId=${extension.extensionId}
        tabindex=${index === this.activeExtIndex ? 0 : -1}
        role="list-item"
        @click=${() => this.manageAddon(extension.extensionId)}
        @keydown=${this.handleKeydown}
      >
        <a
          href="about:addons"
          tabindex="-1"
          target="_blank"
          @click=${e => e.preventDefault()}
          >${extension.tooltiptext}
        </a>
      </div>
    </div>`;
  }

  render() {
    let extensions = this.getWindow().SidebarController.getExtensions();
    return html`
      ${this.stylesheet()}
      <link rel="stylesheet" href="chrome://browser/content/sidebar/sidebar-customize.css"></link>
      <div class="container">
        <sidebar-panel-header data-l10n-id="sidebar-menu-customize-header" data-l10n-attrs="heading" view="viewCustomizeSidebar">
        </sidebar-panel-header>
        <moz-fieldset class="customize-firefox-tools" data-l10n-id="sidebar-customize-firefox-tools">
          ${this.getWindow()
            .SidebarController.getTools()
            .map(tool => this.inputTemplate(tool))}
        </moz-fieldset>
        ${when(
          extensions.length,
          () => html`<div class="customize-extensions">
            <h5
              class="heading-medium customize-extensions-heading"
              data-l10n-id="sidebar-customize-extensions"
            ></h5>
            <div role="list" class="extensions">
              ${extensions.map((extension, index) =>
                this.extensionTemplate(extension, index)
              )}
            </div>
          </div>`
        )}
        <moz-radio-group
          @change=${this.#handleVisibilityChange}
          name="visibility"
          data-l10n-id="sidebar-customize-settings"
        >
          <moz-radio
            class="visibility-setting"
            value="always-show"
            ?checked=${this.visibility === "always-show"}
            iconsrc="chrome://browser/content/sidebar/sidebar-expanded.svg"
            data-l10n-id="sidebar-visibility-always-show"
          ></moz-radio>
          <moz-radio
            class="visibility-setting"
            value="hide-sidebar"
            ?checked=${this.visibility === "hide-sidebar"}
            iconsrc="chrome://browser/content/sidebar/sidebar-hidden.svg"
            data-l10n-id="sidebar-visibility-hide-sidebar"
          ></moz-radio>
        </moz-radio-group>
        <hr>
        <moz-radio-group
            @change=${this.reversePosition}
            name="position">
          <moz-radio
            class="position-setting"
            id="position-left"
            value=${true}
            ?checked=${
              this.getWindow().SidebarController._positionStart === true
            }
            iconsrc="chrome://browser/skin/sidebars.svg"
            data-l10n-id="sidebar-position-left"
          ></moz-radio>
          <moz-radio
            class="position-setting"
            id="position-right"
            value=${false}
            ?checked=${
              this.getWindow().SidebarController._positionStart === false
            }
            iconsrc="chrome://browser/skin/sidebars.svg"
            data-l10n-id="sidebar-position-right"
          ></moz-radio>
        </moz-radio-group>
        <div id="manage-settings">
          <img src="chrome://browser/skin/preferences/category-general.svg" class="icon" role="presentation" />
          <a
            href="about:preferences"
            @click=${this.openFirefoxSettings}
            @keydown=${this.openFirefoxSettings}
            data-l10n-id="sidebar-customize-firefox-settings"
          >
          </a>
        </div>
      </div>
    `;
  }

  #handleVisibilityChange({ target: { value } }) {
    this.visibility = value;
    Services.prefs.setStringPref(VISIBILITY_SETTING_PREF, value);
  }
}

customElements.define("sidebar-customize", SidebarCustomize);
