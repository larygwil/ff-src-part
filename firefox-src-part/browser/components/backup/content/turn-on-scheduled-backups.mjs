/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";

// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/backup/password-validation-inputs.mjs";

/**
 * The widget for showing available options when users want to turn on
 * scheduled backups.
 */
export default class TurnOnScheduledBackups extends MozLitElement {
  #placeholderIconURL = "chrome://global/skin/icons/page-portrait.svg";

  static properties = {
    defaultIconURL: { type: String, reflect: true },
    defaultLabel: { type: String, reflect: true },
    defaultPath: { type: String, reflect: true },
    _newIconURL: { type: String },
    _newLabel: { type: String },
    _newPath: { type: String },
    _showPasswordOptions: { type: Boolean, reflect: true, state: true },
    _passwordsMatch: { type: Boolean, state: true },
    _inputPassValue: { type: String, state: true },
    supportBaseLink: { type: String },
  };

  static get queries() {
    return {
      cancelButtonEl: "#backup-turn-on-scheduled-cancel-button",
      confirmButtonEl: "#backup-turn-on-scheduled-confirm-button",
      filePathButtonEl: "#backup-location-filepicker-button",
      filePathInputCustomEl: "#backup-location-filepicker-input-custom",
      filePathInputDefaultEl: "#backup-location-filepicker-input-default",
      passwordOptionsCheckboxEl: "#sensitive-data-checkbox-input",
      passwordOptionsExpandedEl: "#passwords",
    };
  }

  constructor() {
    super();
    this.defaultIconURL = "";
    this.defaultLabel = "";
    this.defaultPath = "";
    this._newIconURL = "";
    this._newLabel = "";
    this._newPath = "";
    this._showPasswordOptions = false;
    this._passwordsMatch = false;
  }

  /**
   * Dispatches the BackupUI:InitWidget custom event upon being attached to the
   * DOM, which registers with BackupUIChild for BackupService state updates.
   */
  connectedCallback() {
    super.connectedCallback();
    this.dispatchEvent(
      new CustomEvent("BackupUI:InitWidget", { bubbles: true })
    );

    this.addEventListener("BackupUI:SelectNewFilepickerPath", this);
    this.addEventListener("ValidPasswordsDetected", this);
    this.addEventListener("InvalidPasswordsDetected", this);
  }

  handleEvent(event) {
    if (event.type == "BackupUI:SelectNewFilepickerPath") {
      let { path, filename, iconURL } = event.detail;
      this._newPath = path;
      this._newLabel = filename;
      this._newIconURL = iconURL;
    } else if (event.type == "ValidPasswordsDetected") {
      let { password } = event.detail;
      this._passwordsMatch = true;
      this._inputPassValue = password;
    } else if (event.type == "InvalidPasswordsDetected") {
      this._passwordsMatch = false;
      this._inputPassValue = "";
    }
  }

  async handleChooseLocation() {
    this.dispatchEvent(
      new CustomEvent("BackupUI:ShowFilepicker", {
        bubbles: true,
        detail: {
          win: window.browsingContext,
        },
      })
    );
  }

  handleCancel() {
    this.dispatchEvent(
      new CustomEvent("dialogCancel", {
        bubbles: true,
        composed: true,
      })
    );
    this.resetChanges();
  }

  handleConfirm() {
    let detail = {
      parentDirPath: this._newPath || this.defaultPath,
    };

    if (this._showPasswordOptions && this._passwordsMatch) {
      detail.password = this._inputPassValue;
    }

    this.dispatchEvent(
      new CustomEvent("turnOnScheduledBackups", {
        bubbles: true,
        composed: true,
        detail,
      })
    );
    this.resetChanges();
  }

  handleTogglePasswordOptions() {
    this._showPasswordOptions = this.passwordOptionsCheckboxEl?.checked;
    this._passwordsMatch = false;
  }

  resetChanges() {
    this._newPath = "";
    this._newIconURL = "";
    this._newLabel = "";
    this._showPasswordOptions = false;
    this.passwordOptionsCheckboxEl.checked = false;
    this._passwordsMatch = false;
    this._inputPassValue = "";

    if (this.passwordOptionsExpandedEl) {
      this.passwordOptionsExpandedEl.dispatchEvent(
        new CustomEvent("resetInputs", { bubbles: true, composed: true })
      );
    }
  }

  defaultFilePathInputTemplate() {
    let filename = this.defaultLabel;
    let iconURL = this.defaultIconURL || this.#placeholderIconURL;

    return html`
      <input
        id="backup-location-filepicker-input-default"
        class="backup-location-filepicker-input"
        type="text"
        readonly
        data-l10n-id="turn-on-scheduled-backups-location-default-folder"
        data-l10n-args=${JSON.stringify({
          recommendedFolder: filename,
        })}
        data-l10n-attrs="value"
        style=${`background-image: url(${iconURL})`}
      />
    `;
  }

  customFilePathInputTemplate() {
    let filename = this._newLabel;
    let iconURL = this._newIconURL || this.#placeholderIconURL;

    return html`
      <input
        id="backup-location-filepicker-input-custom"
        class="backup-location-filepicker-input"
        type="text"
        readonly
        value=${filename}
        style=${`background-image: url(${iconURL})`}
      />
    `;
  }

  allOptionsTemplate() {
    return html`
      <fieldset id="all-controls">
        <div id="backup-location-controls">
          <label
            id="backup-location-label"
            for="backup-location-filepicker-input"
            data-l10n-id="turn-on-scheduled-backups-location-label"
          ></label>
          <div id="backup-location-filepicker">
            ${!this._newPath
              ? this.defaultFilePathInputTemplate()
              : this.customFilePathInputTemplate()}
            <moz-button
              id="backup-location-filepicker-button"
              @click=${this.handleChooseLocation}
              data-l10n-id="turn-on-scheduled-backups-location-choose-button"
              aria-controls="backup-location-filepicker-input"
            ></moz-button>
          </div>
        </div>

        <fieldset id="sensitive-data-controls">
          <div id="sensitive-data-checkbox">
            <label
              id="sensitive-data-checkbox-label"
              for="sensitive-data-checkbox-input"
              aria-controls="passwords"
              aria-expanded=${this._showPasswordOptions}
            >
              <input
                id="sensitive-data-checkbox-input"
                value=${this._showPasswordOptions}
                @click=${this.handleTogglePasswordOptions}
                type="checkbox"
              />
              <span
                id="sensitive-data-checkbox-span"
                data-l10n-id="turn-on-scheduled-backups-encryption-label"
              ></span>
            </label>
            <span
              class="text-deemphasized"
              data-l10n-id="turn-on-scheduled-backups-encryption-description"
            ></span>
          </div>

          ${this._showPasswordOptions ? this.passwordsTemplate() : null}
        </fieldset>
      </fieldset>
    `;
  }

  passwordsTemplate() {
    return html`
      <password-validation-inputs
        id="passwords"
        .supportBaseLink=${this.supportBaseLink}
      ></password-validation-inputs>
    `;
  }

  contentTemplate() {
    return html`
      <form
        id="backup-turn-on-scheduled-wrapper"
        aria-labelledby="backup-turn-on-scheduled-header"
        aria-describedby="backup-turn-on-scheduled-description"
      >
        <h1
          id="backup-turn-on-scheduled-header"
          class="heading-medium"
          data-l10n-id="turn-on-scheduled-backups-header"
        ></h1>
        <main id="backup-turn-on-scheduled-content">
          <div id="backup-turn-on-scheduled-description">
            <span
              id="backup-turn-on-scheduled-description-span"
              data-l10n-id="turn-on-scheduled-backups-description"
            ></span>
            <!--TODO: finalize support page links (bug 1900467)-->
            <a
              id="backup-turn-on-scheduled-learn-more-link"
              is="moz-support-link"
              support-page="todo-backup"
              data-l10n-id="turn-on-scheduled-backups-support-link"
            ></a>
          </div>
          ${this.allOptionsTemplate()}
        </main>

        <moz-button-group id="backup-turn-on-scheduled-button-group">
          <moz-button
            id="backup-turn-on-scheduled-cancel-button"
            @click=${this.handleCancel}
            data-l10n-id="turn-on-scheduled-backups-cancel-button"
          ></moz-button>
          <moz-button
            id="backup-turn-on-scheduled-confirm-button"
            form="backup-turn-on-scheduled-wrapper"
            @click=${this.handleConfirm}
            type="primary"
            data-l10n-id="turn-on-scheduled-backups-confirm-button"
            ?disabled=${this._showPasswordOptions && !this._passwordsMatch}
          ></moz-button>
        </moz-button-group>
      </form>
    `;
  }

  render() {
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/backup/turn-on-scheduled-backups.css"
      />
      ${this.contentTemplate()}
    `;
  }
}

customElements.define("turn-on-scheduled-backups", TurnOnScheduledBackups);
