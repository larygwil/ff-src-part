/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import React, { useState, useEffect, useRef } from "react";
import { Localized } from "./MSLocalized";
import { AboutWelcomeUtils } from "../../lib/aboutwelcome-utils";
import { MultiStageProtonScreen } from "./MultiStageProtonScreen";
import { useLanguageSwitcher } from "./LanguageSwitcher";
import {
  BASE_PARAMS,
  addUtmParams,
} from "../../asrouter/templates/FirstRun/addUtmParams";

// Amount of milliseconds for all transitions to complete (including delays).
const TRANSITION_OUT_TIME = 1000;
const LANGUAGE_MISMATCH_SCREEN_ID = "AW_LANGUAGE_MISMATCH";

export const MultiStageAboutWelcome = props => {
  let { defaultScreens } = props;
  const didFilter = useRef(false);
  const [didMount, setDidMount] = useState(false);
  const [screens, setScreens] = useState(defaultScreens);

  const [index, setScreenIndex] = useState(props.startScreen);
  const [previousOrder, setPreviousOrder] = useState(props.startScreen - 1);

  useEffect(() => {
    (async () => {
      // If we want to load index from history state, we don't want to send impression yet
      if (!didMount) {
        return;
      }
      // On about:welcome first load, screensVisited should be empty
      let screensVisited = didFilter.current ? screens.slice(0, index) : [];
      let upcomingScreens = defaultScreens
        .filter(s => !screensVisited.find(v => v.id === s.id))
        // Filter out Language Mismatch screen from upcoming
        // screens if screens set from useLanguageSwitcher hook
        // has filtered language screen
        .filter(
          upcomingScreen =>
            !(
              !screens.find(s => s.id === LANGUAGE_MISMATCH_SCREEN_ID) &&
              upcomingScreen.id === LANGUAGE_MISMATCH_SCREEN_ID
            )
        );

      let filteredScreens = screensVisited.concat(
        (await window.AWEvaluateScreenTargeting(upcomingScreens)) ??
          upcomingScreens
      );

      // Use existing screen for the filtered screen to carry over any modification
      // e.g. if AW_LANGUAGE_MISMATCH exists, use it from existing screens
      setScreens(
        filteredScreens.map(
          filtered => screens.find(s => s.id === filtered.id) ?? filtered
        )
      );

      didFilter.current = true;

      const screenInitials = filteredScreens
        .map(({ id }) => id?.split("_")[1]?.[0])
        .join("");
      // Send impression ping when respective screen first renders
      filteredScreens.forEach((screen, order) => {
        if (index === order) {
          AboutWelcomeUtils.sendImpressionTelemetry(
            `${props.message_id}_${order}_${screen.id}_${screenInitials}`
          );
          window.AWAddScreenImpression?.(screen);
        }
      });

      // Remember that a new screen has loaded for browser navigation
      if (props.updateHistory && index > window.history.state) {
        window.history.pushState(index, "");
      }

      // Remember the previous screen index so we can animate the transition
      setPreviousOrder(index);
    })();
  }, [index, didMount]); // eslint-disable-line react-hooks/exhaustive-deps

  const [flowParams, setFlowParams] = useState(null);
  const { metricsFlowUri } = props;
  useEffect(() => {
    (async () => {
      if (metricsFlowUri) {
        setFlowParams(await AboutWelcomeUtils.fetchFlowParams(metricsFlowUri));
      }
    })();
  }, [metricsFlowUri]);

  // Allow "in" style to render to actually transition towards regular state,
  // which also makes using browser back/forward navigation skip transitions.
  const [transition, setTransition] = useState(props.transitions ? "in" : "");
  useEffect(() => {
    if (transition === "in") {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTransition(""))
      );
    }
  }, [transition]);

  // Transition to next screen, opening about:home on last screen button CTA
  const handleTransition = () => {
    // Only handle transitioning out from a screen once.
    if (transition === "out") {
      return;
    }

    // Start transitioning things "out" immediately when moving forwards.
    setTransition(props.transitions ? "out" : "");

    // Actually move forwards after all transitions finish.
    setTimeout(
      () => {
        if (index < screens.length - 1) {
          setTransition(props.transitions ? "in" : "");
          setScreenIndex(prevState => prevState + 1);
        } else {
          window.AWFinish();
        }
      },
      props.transitions ? TRANSITION_OUT_TIME : 0
    );
  };

  useEffect(() => {
    // When about:welcome loads (on refresh or pressing back button
    // from about:home), ensure history state usEffect runs before
    // useEffect hook that send impression telemetry
    setDidMount(true);

    if (props.updateHistory) {
      // Switch to the screen tracked in state (null for initial state)
      // or last screen index if a user navigates by pressing back
      // button from about:home
      const handler = ({ state }) => {
        if (transition === "out") {
          return;
        }
        setTransition(props.transitions ? "out" : "");
        setTimeout(
          () => {
            setTransition(props.transitions ? "in" : "");
            setScreenIndex(Math.min(state, screens.length - 1));
          },
          props.transitions ? TRANSITION_OUT_TIME : 0
        );
      };

      // Handle page load, e.g., going back to about:welcome from about:home
      const { state } = window.history;
      if (state) {
        setScreenIndex(Math.min(state, screens.length - 1));
        setPreviousOrder(Math.min(state, screens.length - 1));
      }

      // Watch for browser back/forward button navigation events
      window.addEventListener("popstate", handler);
      return () => window.removeEventListener("popstate", handler);
    }
    return false;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save the active multi select state containing array of checkbox ids
  // used in handleAction to update MULTI_ACTION data
  const [activeMultiSelect, setActiveMultiSelect] = useState(null);

  // Get the active theme so the rendering code can make it selected
  // by default.
  const [activeTheme, setActiveTheme] = useState(null);
  const [initialTheme, setInitialTheme] = useState(null);
  useEffect(() => {
    (async () => {
      let theme = await window.AWGetSelectedTheme();
      setInitialTheme(theme);
      setActiveTheme(theme);
    })();
  }, []);

  const { negotiatedLanguage, langPackInstallPhase, languageFilteredScreens } =
    useLanguageSwitcher(
      props.appAndSystemLocaleInfo,
      screens,
      index,
      setScreenIndex
    );

  useEffect(() => {
    setScreens(languageFilteredScreens);
  }, [languageFilteredScreens]);

  return (
    <React.Fragment>
      <div
        className={`outer-wrapper onboardingContainer proton transition-${transition}`}
        style={props.backdrop ? { background: props.backdrop } : {}}
      >
        {screens.map((screen, order) => {
          const isFirstScreen = screen === screens[0];
          const isLastScreen = screen === screens[screens.length - 1];
          const totalNumberOfScreens = screens.length;
          const isSingleScreen = totalNumberOfScreens === 1;

          return index === order ? (
            <WelcomeScreen
              key={screen.id + order}
              id={screen.id}
              totalNumberOfScreens={totalNumberOfScreens}
              isFirstScreen={isFirstScreen}
              isLastScreen={isLastScreen}
              isSingleScreen={isSingleScreen}
              order={order}
              previousOrder={previousOrder}
              content={screen.content}
              navigate={handleTransition}
              messageId={`${props.message_id}_${order}_${screen.id}`}
              UTMTerm={props.utm_term}
              flowParams={flowParams}
              activeTheme={activeTheme}
              initialTheme={initialTheme}
              setActiveTheme={setActiveTheme}
              setInitialTheme={setInitialTheme}
              activeMultiSelect={activeMultiSelect}
              setActiveMultiSelect={setActiveMultiSelect}
              autoAdvance={screen.auto_advance}
              negotiatedLanguage={negotiatedLanguage}
              langPackInstallPhase={langPackInstallPhase}
            />
          ) : null;
        })}
      </div>
    </React.Fragment>
  );
};

export const SecondaryCTA = props => {
  let targetElement = props.position
    ? `secondary_button_${props.position}`
    : `secondary_button`;
  const buttonStyling = props.content.secondary_button?.has_arrow_icon
    ? `secondary text-link arrow-icon`
    : `secondary text-link`;

  return (
    <div
      className={
        props.position ? `secondary-cta ${props.position}` : "secondary-cta"
      }
    >
      <Localized text={props.content[targetElement].text}>
        <span />
      </Localized>
      <Localized text={props.content[targetElement].label}>
        <button
          className={buttonStyling}
          value={targetElement}
          onClick={props.handleAction}
        />
      </Localized>
    </div>
  );
};

export const StepsIndicator = props => {
  let steps = [];
  for (let i = 0; i < props.totalNumberOfScreens; i++) {
    let className = `${i === props.order ? "current" : ""} ${
      i < props.order ? "complete" : ""
    }`;
    steps.push(
      <div key={i} className={`indicator ${className}`} role="presentation" />
    );
  }
  return steps;
};

export const ProgressBar = ({ step, previousStep, totalNumberOfScreens }) => {
  const [progress, setProgress] = React.useState(
    previousStep / totalNumberOfScreens
  );
  useEffect(() => {
    // We don't need to hook any dependencies because any time the step changes,
    // the screen's entire DOM tree will be re-rendered.
    setProgress(step / totalNumberOfScreens);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      className="indicator"
      role="presentation"
      style={{ "--progress-bar-progress": `${progress * 100}%` }}
    />
  );
};

export class WelcomeScreen extends React.PureComponent {
  constructor(props) {
    super(props);
    this.handleAction = this.handleAction.bind(this);
  }

  handleOpenURL(action, flowParams, UTMTerm) {
    let { type, data } = action;
    if (type === "SHOW_FIREFOX_ACCOUNTS") {
      let params = {
        ...BASE_PARAMS,
        utm_term: `${UTMTerm}-screen`,
      };
      if (action.addFlowParams && flowParams) {
        params = {
          ...params,
          ...flowParams,
        };
      }
      data = { ...data, extraParams: params };
    } else if (type === "OPEN_URL") {
      let url = new URL(data.args);
      addUtmParams(url, `${UTMTerm}-screen`);
      if (action.addFlowParams && flowParams) {
        url.searchParams.append("device_id", flowParams.deviceId);
        url.searchParams.append("flow_id", flowParams.flowId);
        url.searchParams.append("flow_begin_time", flowParams.flowBeginTime);
      }
      data = { ...data, args: url.toString() };
    }
    return AboutWelcomeUtils.handleUserAction({ type, data });
  }

  async handleAction(event) {
    let { props } = this;
    const value =
      event.currentTarget.value ?? event.currentTarget.getAttribute("value");
    const source = event.source || value;
    let targetContent =
      props.content[value] ||
      props.content.tiles ||
      props.content.languageSwitcher;

    if (!(targetContent && targetContent.action)) {
      return;
    }
    // Send telemetry before waiting on actions
    AboutWelcomeUtils.sendActionTelemetry(props.messageId, source, event.name);

    // Send additional telemetry if a messaging surface like feature callout is
    // dismissed via the dismiss button. Other causes of dismissal will be
    // handled separately by the messaging surface's own code.
    if (value === "dismiss_button" && !event.name) {
      AboutWelcomeUtils.sendDismissTelemetry(props.messageId, source);
    }

    let { action } = targetContent;

    if (action.collectSelect) {
      // Populate MULTI_ACTION data actions property with selected checkbox actions from tiles data
      action.data = {
        actions: [],
      };

      for (const checkbox of props.content?.tiles?.data ?? []) {
        let checkboxAction;
        if (this.props.activeMultiSelect.includes(checkbox.id)) {
          checkboxAction = checkbox.checkedAction ?? checkbox.action;
        } else {
          checkboxAction = checkbox.uncheckedAction;
        }

        if (checkboxAction) {
          action.data.actions.push(checkboxAction);
        }
      }

      // Send telemetry with selected checkbox ids
      AboutWelcomeUtils.sendActionTelemetry(
        props.messageId,
        props.activeMultiSelect,
        "SELECT_CHECKBOX"
      );
    }

    let actionResult;
    if (["OPEN_URL", "SHOW_FIREFOX_ACCOUNTS"].includes(action.type)) {
      actionResult = await this.handleOpenURL(
        action,
        props.flowParams,
        props.UTMTerm
      );
    } else if (action.type) {
      actionResult = await AboutWelcomeUtils.handleUserAction(action);
      if (action.type === "FXA_SIGNIN_FLOW") {
        AboutWelcomeUtils.sendActionTelemetry(
          props.messageId,
          actionResult ? "sign_in" : "sign_in_cancel",
          "FXA_SIGNIN_FLOW"
        );
      }
      // Wait until migration closes to complete the action
      const hasMigrate = a =>
        a.type === "SHOW_MIGRATION_WIZARD" ||
        (a.type === "MULTI_ACTION" && a.data?.actions?.some(hasMigrate));
      if (hasMigrate(action)) {
        await window.AWWaitForMigrationClose();
        AboutWelcomeUtils.sendActionTelemetry(props.messageId, "migrate_close");
      }
    }

    // A special tiles.action.theme value indicates we should use the event's value vs provided value.
    if (action.theme) {
      let themeToUse =
        action.theme === "<event>"
          ? event.currentTarget.value
          : this.props.initialTheme || action.theme;

      this.props.setActiveTheme(themeToUse);
      window.AWSelectTheme(themeToUse);
    }

    // If the action has persistActiveTheme: true, we set the initial theme to the currently active theme
    // so that it can be reverted to in the event that the user navigates away from the screen
    if (action.persistActiveTheme) {
      this.props.setInitialTheme(this.props.activeTheme);
    }

    // `navigate` and `dismiss` can be true/false/undefined, or they can be a
    // string "actionResult" in which case we should use the actionResult
    // (boolean resolved by handleUserAction)
    const shouldDoBehavior = behavior =>
      behavior === "actionResult" ? actionResult : behavior;

    if (shouldDoBehavior(action.navigate)) {
      props.navigate();
    }

    if (shouldDoBehavior(action.dismiss)) {
      window.AWFinish();
    }
  }

  render() {
    return (
      <MultiStageProtonScreen
        content={this.props.content}
        id={this.props.id}
        order={this.props.order}
        previousOrder={this.props.previousOrder}
        activeTheme={this.props.activeTheme}
        activeMultiSelect={this.props.activeMultiSelect}
        setActiveMultiSelect={this.props.setActiveMultiSelect}
        totalNumberOfScreens={this.props.totalNumberOfScreens}
        appAndSystemLocaleInfo={this.props.appAndSystemLocaleInfo}
        negotiatedLanguage={this.props.negotiatedLanguage}
        langPackInstallPhase={this.props.langPackInstallPhase}
        handleAction={this.handleAction}
        messageId={this.props.messageId}
        isFirstScreen={this.props.isFirstScreen}
        isLastScreen={this.props.isLastScreen}
        isSingleScreen={this.props.isSingleScreen}
        startsWithCorner={this.props.startsWithCorner}
        autoAdvance={this.props.autoAdvance}
      />
    );
  }
}
