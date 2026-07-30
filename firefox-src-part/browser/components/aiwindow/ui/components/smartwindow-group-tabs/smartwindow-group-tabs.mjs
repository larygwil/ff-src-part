/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, nothing } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";

const HEADING_ID = "smartwindow-group-tabs-heading";

function colorVar(colorName) {
  return `var(--tab-group-${colorName})`;
}

/**
 * Card shown in the "Group my tabs" panel: the suggested groups the user can
 * create.
 */
export class SmartwindowGroupTabsCard extends MozLitElement {
  static properties = {
    computing: { type: Boolean },
    suggestions: { attribute: false },
  };

  constructor() {
    super();
    this.computing = false;
    this.suggestions = [];
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("swgt-card");
    this.setAttribute("role", "dialog");
    this.setAttribute("aria-labelledby", HEADING_ID);
    this.setAttribute("tabindex", "-1");
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #tiles(tabInfos) {
    return html`<div class="swgt-tiles" aria-hidden="true">
      ${tabInfos
        .slice(0, 3)
        .map(
          info =>
            html`<span class="swgt-tile" style="background:${info.tileColor}"
              >${info.letter}</span
            >`
        )}
    </div>`;
  }

  #suggestionRow(suggestion) {
    return html`<button
      type="button"
      class="swgt-row"
      data-l10n-id="smartwindow-group-tabs-suggestion"
      data-l10n-args=${JSON.stringify({
        groupLabel: suggestion.label,
        tabCount: suggestion.tabInfos.length,
      })}
      @mouseenter=${e =>
        this.#emit("preview", { id: suggestion.id, anchor: e.currentTarget })}
      @focus=${e =>
        this.#emit("preview", { id: suggestion.id, anchor: e.currentTarget })}
      @mouseleave=${() => this.#emit("preview-end")}
      @blur=${() => this.#emit("preview-end")}
      @click=${() => this.#emit("create-one", { id: suggestion.id })}
    >
      ${this.#tiles(suggestion.tabInfos)}
      <span class="swgt-row-label">${suggestion.label}</span>
      <span class="swgt-chevron" aria-hidden="true">›</span>
    </button>`;
  }

  render() {
    const hasSuggestions = !this.computing && !!this.suggestions.length;
    let message = null;
    if (this.computing) {
      message = "smartwindow-group-tabs-loading";
    } else if (!hasSuggestions) {
      message = "smartwindow-group-tabs-empty";
    }

    return [
      html`<h1
        class="swgt-header"
        id=${HEADING_ID}
        data-l10n-id="smartwindow-group-tabs-panel-heading"
      ></h1>`,
      message
        ? html`<div class="swgt-message" data-l10n-id=${message}></div>`
        : nothing,
      hasSuggestions
        ? html`<button
              type="button"
              class="swgt-row swgt-create-all"
              data-l10n-id="smartwindow-group-tabs-create-all"
              @click=${() => this.#emit("create-all")}
            ></button>
            <div
              class="swgt-section"
              data-l10n-id="smartwindow-group-tabs-suggested-heading"
            ></div>
            ${this.suggestions.map(s => this.#suggestionRow(s))}`
        : nothing,
    ];
  }
}
customElements.define("smartwindow-group-tabs-card", SmartwindowGroupTabsCard);

/**
 * Flyout that previews a single suggested group to the side of its row.
 */
export class SmartwindowGroupTabsFlyout extends MozLitElement {
  static properties = {
    suggestion: { attribute: false },
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("swgt-flyout");
  }

  render() {
    const suggestion = this.suggestion;
    if (!suggestion) {
      return nothing;
    }
    return html`<button
        type="button"
        class="swgt-flyout-header"
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent("create-one", { detail: { id: suggestion.id } })
          )}
      >
        <span class="swgt-flyout-title">
          <span
            class="swgt-dot"
            aria-hidden="true"
            style="background:${colorVar(suggestion.color)}"
          ></span>
          <span data-l10n-id="smartwindow-group-tabs-flyout-create"></span>
        </span>
        <span
          class="swgt-flyout-subtitle"
          data-l10n-id="smartwindow-group-tabs-flyout-subtitle"
          data-l10n-args=${JSON.stringify({
            groupLabel: suggestion.label,
            tabCount: suggestion.tabInfos.length,
          })}
        ></span>
      </button>
      <div class="swgt-flyout-list" role="list">
        ${suggestion.tabInfos.map(
          info =>
            html`<div class="swgt-flyout-tab" role="listitem">
              <span
                class="swgt-tile"
                aria-hidden="true"
                style="background:${info.tileColor}"
                >${info.letter}</span
              >
              ${info.siteName
                ? html`<span
                    class="swgt-flyout-tab-label"
                    data-l10n-id="smartwindow-group-tabs-flyout-tab"
                    data-l10n-args=${JSON.stringify({
                      siteName: info.siteName,
                      title: info.title,
                    })}
                  ></span>`
                : html`<span class="swgt-flyout-tab-label"
                    >${info.title}</span
                  >`}
            </div>`
        )}
      </div>`;
  }
}
customElements.define(
  "smartwindow-group-tabs-flyout",
  SmartwindowGroupTabsFlyout
);
