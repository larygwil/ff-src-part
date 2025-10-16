/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  TranslationsParent: "resource://gre/actors/TranslationsParent.sys.mjs",
});

/**
 * This parent is blank because the Translations actor handles most of the features
 * needed in AboutTranslations.
 */
export class AboutTranslationsParent extends JSWindowActorParent {
  #isDestroyed = false;

  /**
   * A dedicated handle to this.#observe.bind(this), which we need to register non-static
   * per-instance observers when the actor is created as well as remove when it is destroyed.
   *
   * @type {Function | null}
   *
   * @see {AboutTranslationsParent.actorCreated}
   * @see {AboutTranslationsParent.didDestroy}
   */
  #boundObserve = null;

  /**
   * Retrieves the display name for a language.
   *
   * @returns {Intl.DisplayNames}
   */
  #languageDisplayNames = null;

  actorCreated() {
    this.#boundObserve = this.#observe.bind(this);
    Services.obs.addObserver(
      this.#boundObserve,
      "translations:model-records-changed"
    );
  }

  didDestroy() {
    if (this.#boundObserve) {
      Services.obs.removeObserver(
        this.#boundObserve,
        "translations:model-records-changed"
      );
      this.#boundObserve = null;
    }
    this.#isDestroyed = true;
  }

  #observe(subject, topic) {
    switch (topic) {
      case "translations:model-records-changed": {
        this.sendAsyncMessage("AboutTranslations:RebuildTranslator");
      }
    }
  }

  async receiveMessage({ name, data }) {
    switch (name) {
      case "AboutTranslations:GetTranslationsPort": {
        if (this.#isDestroyed) {
          return undefined;
        }

        const { languagePair } = data;
        try {
          const port =
            await lazy.TranslationsParent.requestTranslationsPort(languagePair);

          // At the time of writing, you can't return a port via the `sendQuery` API,
          // so results can't just be returned. The `sendAsyncMessage` method must be
          // invoked. Additionally, in the AboutTranslationsChild, the port must
          // be transferred to the content page with `postMessage`.
          this.sendAsyncMessage(
            "AboutTranslations:SendTranslationsPort",
            {
              languagePair,
              port,
            },
            [port] // Mark the port as transferable.
          );
        } catch (error) {
          console.error(error);
        }

        return undefined;
      }
      case "AboutTranslations:GetDisplayName": {
        const { language } = data;

        if (!this.#languageDisplayNames) {
          this.#languageDisplayNames =
            lazy.TranslationsParent.createLanguageDisplayNames();
        }

        try {
          return this.#languageDisplayNames.of(language);
        } catch {
          // No display name could be retrieved.
          return "";
        }
      }
      case "AboutTranslations:GetSupportedLanguages": {
        return lazy.TranslationsParent.getSupportedLanguages();
      }
      case "AboutTranslations:IsTranslationsEngineSupported": {
        return lazy.TranslationsParent.getIsTranslationsEngineSupported();
      }
      case "AboutTranslations:OpenSupportPage": {
        const browser = this.browsingContext.top.embedderElement;
        browser.ownerGlobal.openTrustedLinkIn(
          "https://support.mozilla.org/kb/website-translation",
          "tab",
          {
            forceForeground: true,
            triggeringPrincipal:
              Services.scriptSecurityManager.getSystemPrincipal(),
          }
        );

        return undefined;
      }
      case "AboutTranslations:Telemetry": {
        const { telemetryFunctionName, telemetryData } = data;
        const aboutTranslationsTelemetry =
          lazy.TranslationsParent.telemetry().aboutTranslationsPage();
        const telemetryFunction =
          aboutTranslationsTelemetry[telemetryFunctionName];

        if (typeof telemetryFunction !== "function") {
          throw new Error(
            `Unknown AboutTranslationsTelemetry function name '${telemetryFunctionName}'`
          );
        }

        aboutTranslationsTelemetry[telemetryFunctionName](telemetryData);

        return undefined;
      }
      default: {
        throw new Error("Unknown AboutTranslations message: " + name);
      }
    }
  }
}
