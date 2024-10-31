/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env mozilla/remote-page */

import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { html } from "chrome://global/content/vendor/lit.all.mjs";

// eslint-disable-next-line import/no-unassigned-import
import "chrome://global/content/elements/moz-card.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://global/content/elements/moz-button.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://global/content/elements/moz-button-group.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/profiles/avatar.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/profiles/profiles-theme-card.mjs";

const SAVE_NAME_TIMEOUT = 2000;
const SAVED_MESSAGE_TIMEOUT = 5000;

/**
 * Element used for updating a profile's name, theme, and avatar.
 */
export class EditProfileCard extends MozLitElement {
  static properties = {
    profile: { type: Object },
    profiles: { type: Array },
    themes: { type: Array },
  };

  static queries = {
    mozCard: "moz-card",
    nameInput: "#profile-name",
    errorMessage: "#error-message",
    savedMessage: "#saved-message",
    avatars: { all: "profiles-avatar" },
    headerAvatar: "#header-avatar",
    themeCards: { all: "profiles-theme-card" },
  };

  connectedCallback() {
    super.connectedCallback();

    window.addEventListener("beforeunload", this);

    this.init();
  }

  async init() {
    if (this.initialized) {
      return;
    }

    let { currentProfile, profiles, themes } = await RPMSendQuery(
      "Profiles:GetEditProfileContent"
    );
    this.profile = currentProfile;
    this.profiles = profiles;
    this.themes = themes;

    this.initialized = true;
  }

  handleEvent(event) {
    switch (event.type) {
      case "beforeunload": {
        let newName = this.nameInput.value.trim();
        if (newName === "") {
          this.showErrorMessage("edit-profile-page-no-name");
          event.preventDefault();
        } else if (!this.isDuplicateName(newName)) {
          this.updateName();
        }
        break;
      }
    }
  }

  debounce(callback) {
    return () => {
      clearTimeout(this.timeoutID);
      this.timeoutID = setTimeout(() => {
        callback();
      }, SAVE_NAME_TIMEOUT);
    };
  }

  updated() {
    super.updated();

    if (!this.profile) {
      return;
    }

    let { themeFg, themeBg } = this.profile;
    this.headerAvatar.style.fill = themeBg;
    this.headerAvatar.style.stroke = themeFg;
  }

  updateName() {
    this.showSavedMessage();
    if (this.saveMessageTimeoutId) {
      clearTimeout(this.saveMessageTimeoutId);
    }
    this.saveMessageTimeoutId = setTimeout(() => {
      this.hideSavedMessage();
    }, SAVED_MESSAGE_TIMEOUT);

    let newName = this.nameInput.value.trim();
    if (!newName) {
      return;
    }

    this.profile.name = newName;
    RPMSendAsyncMessage("Profiles:UpdateProfileName", this.profile);
  }

  async updateTheme(newThemeId) {
    if (newThemeId === this.profile.themeL10nId) {
      return;
    }

    let theme = await RPMSendQuery("Profiles:UpdateProfileTheme", newThemeId);
    this.profile.themeL10nId = theme.themeL10nId;
    this.profile.themeFg = theme.themeFg;
    this.profile.themeBg = theme.themeBg;

    this.requestUpdate();
  }

  async updateAvatar(newAvatar) {
    if (newAvatar === this.profile.avatar) {
      return;
    }

    this.profile.avatar = newAvatar;
    RPMSendAsyncMessage("Profiles:UpdateProfileAvatar", this.profile);
    this.requestUpdate();
  }

  isDuplicateName(newName) {
    return !!this.profiles.find(
      p => p.id !== this.profile.id && p.name === newName
    );
  }

  async handleInputEvent() {
    this.hideSavedMessage();
    let newName = this.nameInput.value.trim();
    if (newName === "") {
      this.showErrorMessage("edit-profile-page-no-name");
    } else if (this.isDuplicateName(newName)) {
      this.showErrorMessage("edit-profile-page-duplicate-name");
    } else {
      this.hideErrorMessage();
      this.debounce(() => {
        this.updateName();
      })();
    }
  }

  showErrorMessage(l10nId) {
    clearTimeout(this.timeoutID);
    document.l10n.setAttributes(this.errorMessage, l10nId);
    this.errorMessage.parentElement.hidden = false;
  }

  hideErrorMessage() {
    this.errorMessage.parentElement.hidden = true;
  }

  showSavedMessage() {
    this.savedMessage.parentElement.hidden = false;
  }

  hideSavedMessage() {
    this.savedMessage.parentElement.hidden = true;
  }

  headerTemplate() {
    return html`<h1 data-l10n-id="edit-profile-page-header"></h1>`;
  }

  nameInputTemplate() {
    return html`<input
      type="text"
      id="profile-name"
      size="64"
      aria-errormessage="error-message"
      value=${this.profile.name}
      @input=${this.handleInputEvent}
    />`;
  }

  profilesNameTemplate() {
    return html`<div id="profile-name-area">
      <label
        data-l10n-id="edit-profile-page-profile-name-label"
        for="profile-name"
      ></label>
      ${this.nameInputTemplate()}
      <div class="message-parent">
        <span class="message" hidden
          ><img
            class="message-icon"
            id="error-icon"
            src="chrome://global/skin/icons/info.svg"
          />
          <span id="error-message"></span>
        </span>
        <span class="message" hidden
          ><img
            class="message-icon"
            id="saved-icon"
            src="chrome://global/skin/icons/check-filled.svg"
          />
          <span
            id="saved-message"
            data-l10n-id="edit-profile-page-profile-saved"
          ></span>
        </span>
      </div>
    </div>`;
  }

  themesTemplate() {
    if (!this.themes) {
      return null;
    }

    return this.themes.map(
      t =>
        html`<profiles-theme-card
          @click=${this.handleThemeClick}
          .theme=${t}
          ?selected=${t.isActive}
        ></profiles-theme-card>`
    );
  }

  handleThemeClick(event) {
    for (let t of this.themeCards) {
      t.selected = false;
    }

    let selectedTheme = event.target;
    selectedTheme.selected = true;

    this.updateTheme(selectedTheme.theme.id);
  }

  avatarsTemplate() {
    let avatars = ["book", "briefcase", "flower", "heart", "shopping", "star"];

    return avatars.map(
      avatar =>
        html`<profiles-avatar
          @click=${this.handleAvatarClick}
          value=${avatar}
          ?selected=${avatar === this.profile.avatar}
        ></profiles-avatar>`
    );
  }

  handleAvatarClick(event) {
    for (let a of this.avatars) {
      a.selected = false;
    }

    let selectedAvatar = event.target;
    selectedAvatar.selected = true;

    this.updateAvatar(selectedAvatar.value);
  }

  onDeleteClick() {
    RPMSendAsyncMessage("Profiles:OpenDeletePage");
  }

  buttonsTemplate() {
    return html`<moz-button
      data-l10n-id="edit-profile-page-delete-button"
      @click=${this.onDeleteClick}
      type="destructive"
    ></moz-button>`;
  }

  render() {
    if (!this.profile) {
      return null;
    }

    return html`<link
        rel="stylesheet"
        href="chrome://browser/content/profiles/edit-profile-card.css"
      />
      <link
        rel="stylesheet"
        href="chrome://global/skin/in-content/common.css"
      />
      <moz-card
        ><div id="edit-profile-card">
          <img
            id="header-avatar"
            src="chrome://browser/content/profiles/assets/80_${this.profile
              .avatar}.svg"
          />
          <div id="profile-content">
            ${this.headerTemplate()}${this.profilesNameTemplate()}

            <h3 data-l10n-id="edit-profile-page-theme-header"></h3>
            <div id="themes">${this.themesTemplate()}</div>
            <a
              href="about:addons"
              target="_blank"
              data-l10n-id="edit-profile-page-explore-themes"
            ></a>

            <h3 data-l10n-id="edit-profile-page-avatar-header"></h3>
            <div id="avatars">${this.avatarsTemplate()}</div>

            <moz-button-group>${this.buttonsTemplate()}</moz-button-group>
          </div>
        </div></moz-card
      >`;
  }
}

customElements.define("edit-profile-card", EditProfileCard);
