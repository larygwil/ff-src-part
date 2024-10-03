/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { topChromeWindow } = window.browsingContext;

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  GenAI: "resource:///modules/GenAI.sys.mjs",
  SpecialMessageActions:
    "resource://messaging-system/lib/SpecialMessageActions.sys.mjs",
});
const { XPCOMUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/XPCOMUtils.sys.mjs"
);

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "providerPref",
  "browser.ml.chat.provider",
  null,
  renderProviders
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "shortcutsPref",
  "browser.ml.chat.shortcuts"
);

ChromeUtils.defineLazyGetter(
  lazy,
  "supportLink",
  () =>
    Services.urlFormatter.formatURLPref("app.support.baseURL") + "ai-chatbot"
);

const node = {};

function closeSidebar() {
  topChromeWindow.SidebarController.hide();
}

function openLink(url) {
  topChromeWindow.openLinkIn(url, "tabshifted", {
    triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
  });
}

function request(url = lazy.providerPref) {
  try {
    node.chat.fixupAndLoadURIString(url, {
      triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal(
        {}
      ),
    });
  } catch (ex) {
    console.error("Failed to request chat provider", ex);
  }
}

function renderChat() {
  const browser = document.createXULElement("browser");
  browser.setAttribute("disableglobalhistory", "true");
  browser.setAttribute("type", "content");
  browser.setAttribute("remote", "true");
  return document.body.appendChild(browser);
}

async function renderProviders() {
  // Skip potential pref change callback when unloading
  if ((await document.visibilityState) == "hidden") {
    return null;
  }

  const select = document.getElementById("provider");
  select.innerHTML = "";
  let selected = false;

  const addOption = (text = "", val = "") => {
    const option = select.appendChild(document.createElement("option"));
    option.textContent = text;
    option.value = val;
    return option;
  };

  // Add the known providers in order while looking for current selection
  lazy.GenAI.chatProviders.forEach((data, url) => {
    const option = addOption(data.name, url);
    if (lazy.providerPref == url) {
      option.selected = true;
      selected = true;
    } else if (data.hidden) {
      option.hidden = true;
    }
  });

  // Must be a custom preference if provider wasn't found
  if (!selected) {
    const option = addOption(lazy.providerPref, lazy.providerPref);
    option.selected = true;
    if (!lazy.providerPref) {
      showOnboarding();
    }
  }

  // Add extra controls after the providers
  addOption("---").disabled = true;
  document.l10n.setAttributes(addOption(), "genai-provider-view-details");

  // Update provider telemetry
  const providerId = lazy.GenAI.getProviderId(lazy.providerPref);
  Glean.genaiChatbot.provider.set(providerId);
  if (renderProviders.lastId && document.hasFocus()) {
    Glean.genaiChatbot.providerChange.record({
      current: providerId,
      previous: renderProviders.lastId,
      surface: "panel",
    });
  }
  renderProviders.lastId = providerId;

  // Load the requested provider
  request();
  return select;
}

function renderMore() {
  const button = document.getElementById("header-more");
  button.addEventListener("click", () => {
    const topDoc = topChromeWindow.document;
    let menu = topDoc.getElementById("chatbot-menupopup");
    if (!menu) {
      menu = topDoc
        .getElementById("mainPopupSet")
        .appendChild(topDoc.createXULElement("menupopup"));
      menu.id = "chatbot-menupopup";
      node.menu = menu;
    }
    menu.innerHTML = "";

    const provider = lazy.GenAI.chatProviders.get(lazy.providerPref)?.name;
    [
      [
        "menuitem",
        [
          provider
            ? "genai-options-reload-provider"
            : "genai-options-reload-generic",
          { provider },
        ],
        () => request(),
      ],
      ["menuseparator"],
      [
        "menuitem",
        ["genai-options-show-shortcut"],
        () => Services.prefs.setBoolPref("browser.ml.chat.shortcuts", true),
        lazy.shortcutsPref,
      ],
      [
        "menuitem",
        ["genai-options-hide-shortcut"],
        () => Services.prefs.setBoolPref("browser.ml.chat.shortcuts", false),
        !lazy.shortcutsPref,
      ],
      ["menuseparator"],
      [
        "menuitem",
        ["genai-options-about-chatbot"],
        () => openLink(lazy.supportLink),
      ],
    ].forEach(([type, l10n, command, checked]) => {
      const item = menu.appendChild(topDoc.createXULElement(type));
      if (type == "menuitem") {
        document.l10n.setAttributes(item, ...l10n);
        item.addEventListener("command", command);
        if (checked) {
          item.setAttribute("checked", true);
        }
      }
    });
    menu.openPopup(button, "after_start");
  });
}

function handleChange({ target }) {
  const { value } = target;
  switch (target) {
    case node.provider:
      // Special behavior to show first screen of onboarding
      if (value == "") {
        target.value = lazy.providerPref;
        showOnboarding(1);
      } else {
        Services.prefs.setStringPref("browser.ml.chat.provider", value);
      }
      break;
  }
}
addEventListener("change", handleChange);

// Expose a promise for loading and rendering the chat browser element
var browserPromise = new Promise((resolve, reject) => {
  addEventListener("load", async () => {
    try {
      node.chat = renderChat();
      node.provider = await renderProviders();
      renderMore();
      resolve(node.chat);
      document
        .getElementById("header-close")
        .addEventListener("click", closeSidebar);
    } catch (ex) {
      console.error("Failed to render on load", ex);
      reject(ex);
    }

    Glean.genaiChatbot.sidebarToggle.record({
      opened: true,
      provider: lazy.GenAI.getProviderId(),
      reason: "load",
    });
  });
});

addEventListener("unload", () => {
  node.menu?.remove();
  Glean.genaiChatbot.sidebarToggle.record({
    opened: false,
    provider: lazy.GenAI.getProviderId(),
    reason: "unload",
  });
});

/**
 * Show onboarding screens
 *
 * @param {number} length optional show fewer screens
 */
function showOnboarding(length) {
  // Insert onboarding container and render with script
  const root = document.createElement("div");
  root.id = "multi-stage-message-root";
  document.getElementById(root.id)?.remove();
  document.body.prepend(root);
  history.replaceState("", "");
  const script = document.head.appendChild(document.createElement("script"));
  script.src = "chrome://browser/content/aboutwelcome/aboutwelcome.bundle.js";

  // Convert provider data for lookup by id
  const providerConfigs = new Map();
  lazy.GenAI.chatProviders.forEach((data, url) => {
    if (!data.hidden) {
      providerConfigs.set(data.id, { ...data, url });
    }
  });

  // Define various AW* functions to control aboutwelcome bundle behavior
  Object.assign(window, {
    AWEvaluateScreenTargeting(screens) {
      return screens;
    },
    AWFinish() {
      if (lazy.providerPref == "") {
        closeSidebar();
      }
      root.remove();
    },
    AWGetFeatureConfig() {
      return {
        id: "chatbot",
        template: "multistage",
        transitions: true,
        screens: [
          {
            id: "chat_pick",
            content: {
              fullscreen: true,
              hide_secondary_section: "responsive",
              narrow: true,
              position: "split",

              title: {
                fontWeight: 400,
                string_id: "genai-onboarding-header",
              },
              cta_paragraph: {
                text: {
                  string_id: "genai-onboarding-description",
                  string_name: "learn-more",
                },
                action: {
                  data: {
                    args: lazy.supportLink,
                    where: "tabshifted",
                  },
                  type: "OPEN_URL",
                },
              },
              tiles: {
                action: { picker: "<event>" },
                data: [...providerConfigs.values()].map(config => ({
                  action: config.id,
                  id: config.id,
                  label: config.name,
                  tooltip: { string_id: config.tooltipId },
                })),
                // Default to nothing selected
                selected: " ",
                type: "single-select",
              },
              above_button_content: [
                // Placeholder to inject on provider change
                {
                  text: " ",
                  type: "text",
                },
              ],
              primary_button: {
                action: {
                  navigate: true,
                  // Handle with AWSelectTheme
                  theme: true,
                },
                label: { string_id: "genai-onboarding-primary" },
              },
              additional_button: {
                action: { dismiss: true },
                label: { string_id: "genai-onboarding-secondary" },
                style: "link",
              },
              progress_bar: true,
            },
          },
          {
            id: "chat_suggest",
            content: {
              fullscreen: true,
              hide_secondary_section: "responsive",
              narrow: true,
              position: "split",

              title: {
                fontWeight: 400,
                string_id: "genai-onboarding-select-header",
              },
              subtitle: { string_id: "genai-onboarding-select-description" },
              above_button_content: [
                {
                  height: "172px",
                  type: "image",
                  width: "307px",
                },
                {
                  text: " ",
                  type: "text",
                },
              ],
              primary_button: {
                action: { navigate: true },
                label: { string_id: "genai-onboarding-select-primary" },
              },
              progress_bar: true,
            },
          },
        ].slice(0, length),
      };
    },
    AWGetInstalledAddons() {},
    AWGetSelectedTheme() {
      document.querySelector(".primary").disabled = true;

      // Specially handle links to open out of the sidebar
      const handleLink = ev => {
        const { href } = ev.target;
        if (href) {
          ev.preventDefault();
          openLink(href);
        }
      };
      const links = document.querySelector(".link-paragraph");
      links.addEventListener("click", handleLink);

      [...document.querySelectorAll("fieldset label")].forEach(label => {
        // Add content that is hidden with 0 height until selected
        const div = label
          .querySelector(".text")
          .appendChild(document.createElement("div"));
        div.style.maxHeight = 0;
        div.tabIndex = -1;
        const ul = div.appendChild(document.createElement("ul"));
        const config = providerConfigs.get(label.querySelector("input").value);
        config.choiceIds?.forEach(id => {
          const li = ul.appendChild(document.createElement("li"));
          document.l10n.setAttributes(li, id);
        });
        if (config.learnLink && config.learnId) {
          const a = div.appendChild(document.createElement("a"));
          a.href = config.learnLink;
          a.tabIndex = -1;
          a.addEventListener("click", handleLink);
          document.l10n.setAttributes(a, config.learnId);
        }
      });
    },
    AWSelectTheme() {
      const { value } = document.querySelector("label:has(.selected) input");
      Services.prefs.setStringPref(
        "browser.ml.chat.provider",
        providerConfigs.get(value).url
      );
    },
    AWSendEventTelemetry() {},
    AWSendToParent(message, action) {
      switch (action.type) {
        case "OPEN_URL":
          lazy.SpecialMessageActions.handleAction(action, topChromeWindow);
          return;
      }

      // Handle single select provider choice
      const config = providerConfigs.get(action);
      if (config) {
        document.querySelector(".primary").disabled = false;

        // Set max-height to trigger transition
        document.querySelectorAll("label .text div").forEach(div => {
          const selected =
            div.closest("label").querySelector("input").value == action;
          div.style.maxHeight = selected ? div.scrollHeight + "px" : 0;
          const a = div.querySelector("a");
          if (a) {
            a.tabIndex = selected ? 0 : -1;
          }
        });

        // Update potentially multiple links for the provider
        const links = document.querySelector(".link-paragraph");
        if (links.dataset.l10nId != config.linksId) {
          links.innerHTML = "";
          for (let i = 1; i <= 3; i++) {
            const link = links.appendChild(document.createElement("a"));
            const name = (link.dataset.l10nName = `link${i}`);
            link.href = config[name];
          }
          document.l10n.setAttributes(links, config.linksId);
        }
      }
    },
  });
}
