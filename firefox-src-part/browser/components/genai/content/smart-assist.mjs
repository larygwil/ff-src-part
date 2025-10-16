/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";

// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/sidebar/sidebar-panel-header.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  SmartAssistEngine:
    "moz-src:///browser/components/genai/SmartAssistEngine.sys.mjs",
});

const FULL_PAGE_URL = "chrome://browser/content/genai/smartAssistPage.html";

/**
 * A custom element for managing the smart assistant sidebar.
 */
export class SmartAssist extends MozLitElement {
  static properties = {
    userPrompt: { type: String },
    aiResponse: { type: String },
    conversationState: { type: Array },
    logState: { type: Array },
    mode: { type: String }, // "tab" | "sidebar"
    overrideNewTab: { type: Boolean },
    showLog: { type: Boolean },
    actionKey: { type: String }, // "chat" | "search"
  };

  constructor() {
    super();
    this.userPrompt = "";
    // TODO the conversation state will evenually need to be stored in a "higher" location
    // then just the state of this lit component. This is a Stub to get the convo started for now
    this.conversationState = [
      { role: "system", content: "You are a helpful assistant" },
    ];
    this.logState = [];
    this.showLog = false;
    this.mode = "sidebar";
    this.overrideNewTab = Services.prefs.getBoolPref(
      "browser.ml.smartAssist.overrideNewTab"
    );
    this.actionKey = "chat";

    this._actions = {
      chat: {
        label: "Submit",
        icon: "chrome://global/skin/icons/arrow-right.svg",
        run: this._actionChat,
      },
      search: {
        label: "Search",
        icon: "chrome://global/skin/icons/search-glass.svg",
        run: this._actionSearch,
      },
    };
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.mode === "sidebar" && this.overrideNewTab) {
      this._applyNewTabOverride(true);
    }
  }

  /**
   * Adds a new message to the conversation history.
   *
   * @param {object} chatEntry - A message object to add to the conversation
   * @param {("system"|"user"|"assistant")} chatEntry.role - The role of the message sender
   * @param {string} chatEntry.content - The text content of the message
   */
  _updateConversationState = chatEntry => {
    this.conversationState = [...this.conversationState, chatEntry];
  };

  _updatelogState = chatEntry => {
    const entryWithDate = { ...chatEntry, date: new Date().toLocaleString() };
    this.logState = [...this.logState, entryWithDate];
  };

  _handlePromptInput = async e => {
    const value = e.target.value;
    this.userPrompt = value;

    // Determine intent based on keywords in the prompt
    this.actionKey = await lazy.SmartAssistEngine.getPromptIntent(value);
  };

  /**
   * Returns the current action object based on the actionKey
   */

  get inputAction() {
    return this._actions[this.actionKey];
  }

  _actionSearch = () => {
    // TODO: Implement search functionality
  };

  _actionChat = async () => {
    const formattedPrompt = (this.userPrompt || "").trim();
    if (!formattedPrompt) {
      return;
    }

    // Push user prompt
    this._updateConversationState({ role: "user", content: formattedPrompt });
    this.userPrompt = "";

    // Create an empty assistant placeholder.
    this._updateConversationState({ role: "assistant", content: "" });
    const latestAssistantMessageIndex = this.conversationState.length - 1;

    let acc = "";
    try {
      const stream = lazy.SmartAssistEngine.fetchWithHistory(
        this.conversationState
      );

      for await (const chunk of stream) {
        // Check to see if chunk is special tool calling log and add to logState
        if (chunk.type === "tool_call_log") {
          this._updatelogState({
            content: chunk.content,
            result: chunk.result || "No result",
          });
          continue;
        }
        acc += chunk;
        // append to the latest assistant message

        this.conversationState[latestAssistantMessageIndex] = {
          ...this.conversationState[latestAssistantMessageIndex],
          content: acc,
        };
        this.requestUpdate?.();
      }
    } catch (e) {
      this.conversationState[latestAssistantMessageIndex] = {
        role: "assistant",
        content: `There was an error`,
      };
      this.requestUpdate?.();
    }
  };

  /**
   * Mock Functionality to open full page UX
   *
   * @param {boolean} enable
   * Whether or not to override the new tab page.
   */
  _applyNewTabOverride(enable) {
    try {
      enable
        ? (lazy.AboutNewTab.newTabURL = FULL_PAGE_URL)
        : lazy.AboutNewTab.resetNewTabURL();
    } catch (e) {
      console.error("Failed to toggle new tab override:", e);
    }
  }

  _onToggleFullPage(e) {
    const isChecked = e.target.checked;
    Services.prefs.setBoolPref(
      "browser.ml.smartAssist.overrideNewTab",
      isChecked
    );
    this.overrideNewTab = isChecked;
    this._applyNewTabOverride(isChecked);
  }

  render() {
    const iconSrc = this.showLog
      ? "chrome://global/skin/icons/arrow-down.svg"
      : "chrome://global/skin/icons/arrow-up.svg";

    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/genai/content/smart-assist.css"
      />
      <div class="wrapper">
        ${
          this.mode === "sidebar"
            ? html` <sidebar-panel-header
                data-l10n-id="genai-smart-assist-sidebar-title"
                data-l10n-attrs="heading"
                view="viewGenaiSmartAssistSidebar"
              ></sidebar-panel-header>`
            : ""
        }

        <div>

          <!-- Conversation Panel -->
          <div>
            ${this.conversationState
              .filter(msg => msg.role !== "system")
              .map(
                msg =>
                  html`<div class="message ${msg.role}">
                    <strong>${msg.role}:</strong> ${msg.content}
                    ${msg.role === "assistant" && msg.content.length === 0
                      ? html`<span>Thinking</span>`
                      : ""}
                  </div>`
              )}
          </div>

          <!-- Log Panel -->
          ${
            this.logState.length !== 0
              ? html` <div class="log-panel">
                  <div class="log-header">
                    <span class="log-title">Log</span>
                    <moz-button
                      type="ghost"
                      iconSrc=${iconSrc}
                      @click=${() => {
                        this.showLog = !this.showLog;
                      }}
                    >
                    </moz-button>
                  </div>
                  ${this.showLog
                    ? html` <div class="log-entries">
                        ${this.logState.map(
                          data =>
                            html`<div class="log-entry">
                              <div><b>Message</b> : ${data.content}</div>
                              <div><b>Date</b> : ${data.date}</div>
                              <div>
                                <b>Tool Response</b> :
                                ${JSON.stringify(data.result)}
                              </div>
                            </div>`
                        )}
                      </div>`
                    : html``}
                </div>`
              : html``
          }
          </div>

          <!-- User Input -->
          <textarea
            .value=${this.userPrompt}
            class="prompt-textarea"
            @input=${e => this._handlePromptInput(e)}
          ></textarea>
          <moz-button
            iconSrc=${this.inputAction.icon}
            id="submit-user-prompt-btn"
            type="primary"
            size="small"
            @click=${this.inputAction.run}
            iconPosition="end"
          >
            ${this.inputAction.label}
          </moz-button>

          <!-- Footer - New Tab Override -->
          ${
            this.mode === "sidebar"
              ? html`<div class="footer">
                  <moz-checkbox
                    type="checkbox"
                    label="Mock Full Page Experience"
                    @change=${e => this._onToggleFullPage(e)}
                    ?checked=${this.overrideNewTab}
                  ></moz-checkbox>
                </div>`
              : ""
          }
        </div>
      </div>
    `;
  }
}

customElements.define("smart-assist", SmartAssist);
