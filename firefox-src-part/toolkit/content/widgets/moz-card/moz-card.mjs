/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  html,
  ifDefined,
  when,
} from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";

/**
 * Cards contain content and actions about a single subject.
 * There are two card types:
 * The default type where no type attribute is required and the card
 * will have no extra functionality.
 *
 * The "accordion" type will initially not show any content. The card
 * will contain an arrow to expand the card so that all of the content
 * is visible. You can use the "expanded" attribute to force the accordion
 * card to show its content on initial render.
 *
 *
 * @property {string} heading - The heading text that will be used for the card.
 * @property {string} icon - (optional) A flag to indicate the header should include an icon
 * @property {string} type - (optional) The type of card. No type specified
 *   will be the default card. The other available type is "accordion"
 * @property {boolean} expanded - A flag to indicate whether the card is
 *  expanded or not. Can be used to expand the content section of the
 *  accordion card on initial render.
 * @slot content - The content to show inside of the card.
 */
export default class MozCard extends MozLitElement {
  static queries = {
    detailsEl: "#moz-card-details",
    headingEl: "#heading",
    contentSlotEl: "#content",
  };

  static properties = {
    heading: { type: String },
    icon: { type: Boolean },
    type: { type: String, reflect: true },
    expanded: { type: Boolean },
  };

  constructor() {
    super();
    this.type = "default";
    this.expanded = false;
  }

  headingTemplate() {
    if (!this.heading) {
      return "";
    }
    return html`
      <div id="heading-wrapper">
        ${when(
          this.type == "accordion",
          () => html`<div class="chevron-icon"></div>`
        )}
        ${when(
          this.icon,
          () =>
            html`<div part="icon" id="heading-icon" role="presentation"></div>`
        )}
        <span id="heading" title=${ifDefined(this.heading)} part="heading"
          >${this.heading}</span
        >
      </div>
    `;
  }

  cardTemplate() {
    if (this.type === "accordion") {
      return html`
        <details
          id="moz-card-details"
          @toggle="${this.onToggle}"
          ?open=${this.expanded}
        >
          <summary part="summary">${this.headingTemplate()}</summary>
          <div id="content"><slot></slot></div>
        </details>
      `;
    }

    return html`
      <div id="moz-card-details">
        ${this.headingTemplate()}
        <div id="content" aria-describedby="content">
          <slot></slot>
        </div>
      </div>
    `;
  }
  /**
   * Handles the click event on the chevron icon.
   *
   * Without this, the click event would be passed to
   * toggleDetails which would force the details element
   * to stay open.
   *
   * @memberof MozCard
   */
  onDetailsClick() {
    this.toggleDetails();
  }

  /**
   * @param {boolean} force - Used to force open or force close the
   * details element.
   * @memberof MozCard
   */
  toggleDetails(force) {
    this.expanded = force ?? !this.detailsEl.open;
  }

  onToggle() {
    this.expanded = this.detailsEl.open;
    this.dispatchEvent(
      new ToggleEvent("toggle", {
        newState: this.detailsEl.open ? "open" : "closed",
        oldState: this.detailsEl.open ? "closed" : "open",
      })
    );
  }

  render() {
    return html`
      <link
        rel="stylesheet"
        href="chrome://global/content/elements/moz-card.css"
      />
      <article
        class="moz-card"
        aria-labelledby=${ifDefined(this.heading ? "heading" : undefined)}
      >
        ${this.cardTemplate()}
      </article>
    `;
  }
}
customElements.define("moz-card", MozCard);
