/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { actionCreators as ac, actionTypes as at } from "common/Actions.mjs";
import { connect } from "react-redux";
import React from "react";
import { SimpleHashRouter } from "./SimpleHashRouter";

const Row = props => (
  <tr className="message-item" {...props}>
    {props.children}
  </tr>
);

function relativeTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (seconds < 2) {
    return "just now";
  } else if (seconds < 60) {
    return `${seconds} seconds ago`;
  } else if (minutes === 1) {
    return "1 minute ago";
  } else if (minutes < 600) {
    return `${minutes} minutes ago`;
  }
  return new Date(timestamp).toLocaleString();
}

export class ToggleStoryButton extends React.PureComponent {
  constructor(props) {
    super(props);
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick() {
    this.props.onClick(this.props.story);
  }

  render() {
    return <button onClick={this.handleClick}>collapse/open</button>;
  }
}

export class TogglePrefCheckbox extends React.PureComponent {
  constructor(props) {
    super(props);
    this.onChange = this.onChange.bind(this);
  }

  onChange(event) {
    this.props.onChange(this.props.pref, event.target.checked);
  }

  render() {
    return (
      <>
        <input
          type="checkbox"
          checked={this.props.checked}
          onChange={this.onChange}
          disabled={this.props.disabled}
        />{" "}
        {this.props.pref}{" "}
      </>
    );
  }
}

export class Personalization extends React.PureComponent {
  constructor(props) {
    super(props);
    this.togglePersonalization = this.togglePersonalization.bind(this);
  }

  togglePersonalization() {
    this.props.dispatch(
      ac.OnlyToMain({
        type: at.DISCOVERY_STREAM_PERSONALIZATION_TOGGLE,
      })
    );
  }

  render() {
    const { lastUpdated, initialized } = this.props.state.Personalization;
    return (
      <React.Fragment>
        <table>
          <tbody>
            <Row>
              <td colSpan="2">
                <TogglePrefCheckbox
                  checked={this.props.personalized}
                  pref="personalized"
                  onChange={this.togglePersonalization}
                />
              </td>
            </Row>
            <Row>
              <td className="min">Personalization Last Updated</td>
              <td>{relativeTime(lastUpdated) || "(no data)"}</td>
            </Row>
            <Row>
              <td className="min">Personalization Initialized</td>
              <td>{initialized ? "true" : "false"}</td>
            </Row>
          </tbody>
        </table>
      </React.Fragment>
    );
  }
}

export class DiscoveryStreamAdminUI extends React.PureComponent {
  constructor(props) {
    super(props);
    this.restorePrefDefaults = this.restorePrefDefaults.bind(this);
    this.setConfigValue = this.setConfigValue.bind(this);
    this.expireCache = this.expireCache.bind(this);
    this.refreshCache = this.refreshCache.bind(this);
    this.showPlaceholder = this.showPlaceholder.bind(this);
    this.idleDaily = this.idleDaily.bind(this);
    this.systemTick = this.systemTick.bind(this);
    this.syncRemoteSettings = this.syncRemoteSettings.bind(this);
    this.onStoryToggle = this.onStoryToggle.bind(this);
    this.handleWeatherSubmit = this.handleWeatherSubmit.bind(this);
    this.handleWeatherUpdate = this.handleWeatherUpdate.bind(this);
    this.resetBlocks = this.resetBlocks.bind(this);
    this.refreshTopicSelectionCache =
      this.refreshTopicSelectionCache.bind(this);
    this.toggleTBRFeed = this.toggleTBRFeed.bind(this);
    this.handleSectionsToggle = this.handleSectionsToggle.bind(this);
    this.toggleIABBanners = this.toggleIABBanners.bind(this);
    this.state = {
      toggledStories: {},
      weatherQuery: "",
    };
  }

  setConfigValue(configName, configValue) {
    this.props.dispatch(
      ac.OnlyToMain({
        type: at.DISCOVERY_STREAM_CONFIG_SET_VALUE,
        data: { name: configName, value: configValue },
      })
    );
  }

  restorePrefDefaults() {
    this.props.dispatch(
      ac.OnlyToMain({
        type: at.DISCOVERY_STREAM_CONFIG_RESET_DEFAULTS,
      })
    );
  }

  refreshCache() {
    const { config } = this.props.state.DiscoveryStream;
    this.props.dispatch(
      ac.OnlyToMain({
        type: at.DISCOVERY_STREAM_CONFIG_CHANGE,
        data: config,
      })
    );
  }

  refreshTopicSelectionCache() {
    this.props.dispatch(
      ac.SetPref("discoverystream.topicSelection.onboarding.displayCount", 0)
    );
    this.props.dispatch(
      ac.SetPref("discoverystream.topicSelection.onboarding.maybeDisplay", true)
    );
  }

  dispatchSimpleAction(type) {
    this.props.dispatch(
      ac.OnlyToMain({
        type,
      })
    );
  }

  resetBlocks() {
    this.props.dispatch(
      ac.OnlyToMain({
        type: at.DISCOVERY_STREAM_DEV_BLOCKS_RESET,
      })
    );
  }

  systemTick() {
    this.dispatchSimpleAction(at.DISCOVERY_STREAM_DEV_SYSTEM_TICK);
  }

  expireCache() {
    this.dispatchSimpleAction(at.DISCOVERY_STREAM_DEV_EXPIRE_CACHE);
  }

  showPlaceholder() {
    this.dispatchSimpleAction(at.DISCOVERY_STREAM_DEV_SHOW_PLACEHOLDER);
  }

  toggleTBRFeed(e) {
    const feed = e.target.value;
    const selectedFeed = "discoverystream.contextualContent.selectedFeed";
    this.props.dispatch(ac.SetPref(selectedFeed, feed));
  }

  idleDaily() {
    this.dispatchSimpleAction(at.DISCOVERY_STREAM_DEV_IDLE_DAILY);
  }

  syncRemoteSettings() {
    this.dispatchSimpleAction(at.DISCOVERY_STREAM_DEV_SYNC_RS);
  }

  handleWeatherUpdate(e) {
    this.setState({ weatherQuery: e.target.value || "" });
  }

  handleWeatherSubmit(e) {
    e.preventDefault();
    const { weatherQuery } = this.state;
    this.props.dispatch(ac.SetPref("weather.query", weatherQuery));
  }

  toggleIABBanners(e) {
    const { pressed, id } = e.target;
    const billboardEnabled = this.props.otherPrefs["newtabAdSize.billboard"];
    const leaderboardEnabled =
      this.props.otherPrefs["newtabAdSize.leaderboard"];
    let spocValue;
    let spocCount;

    if (id === "billboard") {
      this.props.dispatch(ac.SetPref("newtabAdSize.billboard", pressed));
      if (pressed) {
        spocValue = `newtab_spocs, newtab_billboard${leaderboardEnabled ? ", newtab_leaderboard" : ""}`;
        spocCount = `6,1${leaderboardEnabled ? ",1" : ""}`;
      } else {
        spocValue = `newtab_spocs${leaderboardEnabled ? ", newtab_leaderboard" : ""}`;
        spocCount = `6${leaderboardEnabled ? ",1" : ""}`;
      }
    } else if (id === "leaderboard") {
      this.props.dispatch(ac.SetPref("newtabAdSize.leaderboard", pressed));
      if (pressed) {
        spocValue = `newtab_spocs, newtab_leaderboard${billboardEnabled ? ", newtab_billboard" : ""}`;
        spocCount = `6,1${billboardEnabled ? ",1" : ""}`;
      } else {
        spocValue = `newtab_spocs${billboardEnabled ? ", newtab_billboard" : ""}`;
        spocCount = `6${billboardEnabled ? ",1" : ""}`;
      }
    }
    this.props.dispatch(
      ac.SetPref("discoverystream.placements.spocs", spocValue)
    );
    this.props.dispatch(
      ac.SetPref("discoverystream.placements.spocs.counts", spocCount)
    );
  }

  handleSectionsToggle(e) {
    const { pressed } = e.target;
    this.props.dispatch(
      ac.SetPref("discoverystream.sections.enabled", pressed)
    );
    this.props.dispatch(
      ac.SetPref("discoverystream.sections.cards.enabled", pressed)
    );
    this.props.dispatch(
      ac.SetPref("discoverystream.sections.cards.thumbsUpDown.enabled", pressed)
    );
  }

  renderComponent(width, component) {
    return (
      <table>
        <tbody>
          <Row>
            <td className="min">Type</td>
            <td>{component.type}</td>
          </Row>
          <Row>
            <td className="min">Width</td>
            <td>{width}</td>
          </Row>
          {component.feed && this.renderFeed(component.feed)}
        </tbody>
      </table>
    );
  }

  renderWeatherData() {
    const { suggestions } = this.props.state.Weather;
    let weatherTable;
    if (suggestions) {
      weatherTable = (
        <div className="weather-section">
          <form onSubmit={this.handleWeatherSubmit}>
            <label htmlFor="weather-query">Weather query</label>
            <input
              type="text"
              min="3"
              max="10"
              id="weather-query"
              onChange={this.handleWeatherUpdate}
              value={this.weatherQuery}
            />
            <button type="submit">Submit</button>
          </form>
          <table>
            <tbody>
              {suggestions.map(suggestion => (
                <tr className="message-item" key={suggestion.city_name}>
                  <td className="message-id">
                    <span>
                      {suggestion.city_name} <br />
                    </span>
                  </td>
                  <td className="message-summary">
                    <pre>{JSON.stringify(suggestion, null, 2)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return weatherTable;
  }

  renderFeedData(url) {
    const { feeds } = this.props.state.DiscoveryStream;
    const feed = feeds.data[url].data;
    return (
      <React.Fragment>
        <h4>Feed url: {url}</h4>
        <table>
          <tbody>
            {feed.recommendations?.map(story => this.renderStoryData(story))}
          </tbody>
        </table>
      </React.Fragment>
    );
  }

  renderFeedsData() {
    const { feeds } = this.props.state.DiscoveryStream;
    return (
      <React.Fragment>
        {Object.keys(feeds.data).map(url => this.renderFeedData(url))}
      </React.Fragment>
    );
  }

  renderImpressionsData() {
    const { impressions } = this.props.state.DiscoveryStream;
    return (
      <>
        <h4>Feed Impressions</h4>
        <table>
          <tbody>
            {Object.keys(impressions.feed).map(key => {
              return (
                <Row key={key}>
                  <td className="min">{key}</td>
                  <td>{relativeTime(impressions.feed[key]) || "(no data)"}</td>
                </Row>
              );
            })}
          </tbody>
        </table>
      </>
    );
  }

  renderBlocksData() {
    const { blocks } = this.props.state.DiscoveryStream;
    return (
      <>
        <h4>Blocks</h4>
        <button className="button" onClick={this.resetBlocks}>
          Reset Blocks
        </button>{" "}
        <table>
          <tbody>
            {Object.keys(blocks).map(key => {
              return (
                <Row key={key}>
                  <td className="min">{key}</td>
                </Row>
              );
            })}
          </tbody>
        </table>
      </>
    );
  }

  renderSpocs() {
    const { spocs } = this.props.state.DiscoveryStream;

    const unifiedAdsSpocsEnabled =
      this.props.otherPrefs["unifiedAds.spocs.enabled"];

    const unifiedAdsEndpoint = this.props.otherPrefs["unifiedAds.endpoint"];

    let spocsData = [];

    if (
      spocs.data &&
      spocs.data.newtab_spocs &&
      spocs.data.newtab_spocs.items
    ) {
      spocsData = spocs.data.newtab_spocs.items || [];
    }

    return (
      <React.Fragment>
        <table>
          <tbody>
            <Row>
              <td className="min">spocs_endpoint</td>
              <td>
                {unifiedAdsSpocsEnabled
                  ? unifiedAdsEndpoint
                  : spocs.spocs_endpoint}
              </td>
            </Row>
            <Row>
              <td className="min">Data last fetched</td>
              <td>{relativeTime(spocs.lastUpdated)}</td>
            </Row>
          </tbody>
        </table>
        <h4>Spoc data</h4>
        <table>
          <tbody>{spocsData.map(spoc => this.renderStoryData(spoc))}</tbody>
        </table>
        <h4>Spoc frequency caps</h4>
        <table>
          <tbody>
            {spocs.frequency_caps.map(spoc => this.renderStoryData(spoc))}
          </tbody>
        </table>
      </React.Fragment>
    );
  }

  onStoryToggle(story) {
    const { toggledStories } = this.state;
    this.setState({
      toggledStories: {
        ...toggledStories,
        [story.id]: !toggledStories[story.id],
      },
    });
  }

  renderStoryData(story) {
    let storyData = "";
    if (this.state.toggledStories[story.id]) {
      storyData = JSON.stringify(story, null, 2);
    }
    return (
      <tr className="message-item" key={story.id}>
        <td className="message-id">
          <span>
            {story.id} <br />
          </span>
          <ToggleStoryButton story={story} onClick={this.onStoryToggle} />
        </td>
        <td className="message-summary">
          <pre>{storyData}</pre>
        </td>
      </tr>
    );
  }

  renderFeed(feed) {
    const { feeds } = this.props.state.DiscoveryStream;
    if (!feed.url) {
      return null;
    }
    return (
      <React.Fragment>
        <Row>
          <td className="min">Feed url</td>
          <td>{feed.url}</td>
        </Row>
        <Row>
          <td className="min">Data last fetched</td>
          <td>
            {relativeTime(
              feeds.data[feed.url] ? feeds.data[feed.url].lastUpdated : null
            ) || "(no data)"}
          </td>
        </Row>
      </React.Fragment>
    );
  }

  render() {
    const prefToggles = "enabled collapsible".split(" ");
    const { config, layout } = this.props.state.DiscoveryStream;
    const personalized =
      this.props.otherPrefs["discoverystream.personalization.enabled"];
    const selectedFeed =
      this.props.otherPrefs["discoverystream.contextualContent.selectedFeed"];
    const sectionsEnabled =
      this.props.otherPrefs["discoverystream.sections.enabled"];
    const TBRFeeds = this.props.otherPrefs[
      "discoverystream.contextualContent.feeds"
    ]
      .split(",")
      .map(s => s.trim())
      .filter(item => item);

    // Prefs for IAB Banners
    const billboardsEnabled = this.props.otherPrefs["newtabAdSize.billboard"];
    const leaderboardEnabled =
      this.props.otherPrefs["newtabAdSize.leaderboard"];
    const spocPlacements =
      this.props.otherPrefs["discoverystream.placements.spocs"];
    const billboardPressed =
      billboardsEnabled && spocPlacements.includes("newtab_billboard");
    const leaderboardPressed =
      leaderboardEnabled && spocPlacements.includes("newtab_leaderboard");
    return (
      <div>
        <button className="button" onClick={this.restorePrefDefaults}>
          Restore Pref Defaults
        </button>{" "}
        <button className="button" onClick={this.refreshCache}>
          Refresh Cache
        </button>
        <br />
        <button className="button" onClick={this.expireCache}>
          Expire Cache
        </button>{" "}
        <button className="button" onClick={this.systemTick}>
          Trigger System Tick
        </button>{" "}
        <button className="button" onClick={this.idleDaily}>
          Trigger Idle Daily
        </button>
        <br />
        <button className="button" onClick={this.syncRemoteSettings}>
          Sync Remote Settings
        </button>{" "}
        <button className="button" onClick={this.refreshTopicSelectionCache}>
          Refresh Topic selection count
        </button>
        <br />
        <button className="button" onClick={this.showPlaceholder}>
          Show Placeholder Cards
        </button>{" "}
        <select
          className="button"
          onChange={this.toggleTBRFeed}
          value={selectedFeed}
        >
          {TBRFeeds.map(feed => (
            <option key={feed} value={feed}>
              {feed}
            </option>
          ))}
        </select>
        <div className="toggle-wrapper">
          <moz-toggle
            id="sections-toggle"
            pressed={sectionsEnabled || null}
            onToggle={this.handleSectionsToggle}
            label="Toggle DS Sections"
          />
        </div>
        {/* Collapsible Sections for experiments for easy on/off */}
        <details className="details-section">
          <summary>IAB Banner Ad Sizes</summary>
          <div className="toggle-wrapper">
            <moz-toggle
              id="leaderboard"
              pressed={leaderboardPressed || null}
              onToggle={this.toggleIABBanners}
              label="Enable IAB Leaderboard"
            />
          </div>
          <div className="toggle-wrapper">
            <moz-toggle
              id="billboard"
              pressed={billboardPressed || null}
              onToggle={this.toggleIABBanners}
              label="Enable IAB Billboard"
            />
          </div>
        </details>
        <table>
          <tbody>
            {prefToggles.map(pref => (
              <Row key={pref}>
                <td>
                  <TogglePrefCheckbox
                    checked={config[pref]}
                    pref={pref}
                    onChange={this.setConfigValue}
                  />
                </td>
              </Row>
            ))}
          </tbody>
        </table>
        <h3>Layout</h3>
        {layout.map((row, rowIndex) => (
          <div key={`row-${rowIndex}`}>
            {row.components.map((component, componentIndex) => (
              <div key={`component-${componentIndex}`} className="ds-component">
                {this.renderComponent(row.width, component)}
              </div>
            ))}
          </div>
        ))}
        <h3>Personalization</h3>
        <Personalization
          personalized={personalized}
          dispatch={this.props.dispatch}
          state={{
            Personalization: this.props.state.Personalization,
          }}
        />
        <h3>Spocs</h3>
        {this.renderSpocs()}
        <h3>Feeds Data</h3>
        <div className="large-data-container">{this.renderFeedsData()}</div>
        <h3>Impressions Data</h3>
        <div className="large-data-container">
          {this.renderImpressionsData()}
        </div>
        <h3>Blocked Data</h3>
        <div className="large-data-container">{this.renderBlocksData()}</div>
        <h3>Weather Data</h3>
        {this.renderWeatherData()}
      </div>
    );
  }
}

export class DiscoveryStreamAdminInner extends React.PureComponent {
  constructor(props) {
    super(props);
    this.setState = this.setState.bind(this);
  }

  render() {
    return (
      <div
        className={`discoverystream-admin ${
          this.props.collapsed ? "collapsed" : "expanded"
        }`}
      >
        <main className="main-panel">
          <h1>Discovery Stream Admin</h1>

          <p className="helpLink">
            <span className="icon icon-small-spacer icon-info" />{" "}
            <span>
              Need to access the ASRouter Admin dev tools?{" "}
              <a target="blank" href="about:asrouter">
                Click here
              </a>
            </span>
          </p>

          <React.Fragment>
            <DiscoveryStreamAdminUI
              state={{
                DiscoveryStream: this.props.DiscoveryStream,
                Personalization: this.props.Personalization,
                Weather: this.props.Weather,
              }}
              otherPrefs={this.props.Prefs.values}
              dispatch={this.props.dispatch}
            />
          </React.Fragment>
        </main>
      </div>
    );
  }
}

export class CollapseToggle extends React.PureComponent {
  constructor(props) {
    super(props);
    this.onCollapseToggle = this.onCollapseToggle.bind(this);
    this.state = { collapsed: false };
  }

  get renderAdmin() {
    const { props } = this;
    return props.location.hash && props.location.hash.startsWith("#devtools");
  }

  onCollapseToggle(e) {
    e.preventDefault();
    this.setState(state => ({ collapsed: !state.collapsed }));
  }

  setBodyClass() {
    if (this.renderAdmin && !this.state.collapsed) {
      globalThis.document.body.classList.add("no-scroll");
    } else {
      globalThis.document.body.classList.remove("no-scroll");
    }
  }

  componentDidMount() {
    this.setBodyClass();
  }

  componentDidUpdate() {
    this.setBodyClass();
  }

  componentWillUnmount() {
    globalThis.document.body.classList.remove("no-scroll");
  }

  render() {
    const { props } = this;
    const { renderAdmin } = this;
    const isCollapsed = this.state.collapsed || !renderAdmin;
    const label = `${isCollapsed ? "Expand" : "Collapse"} devtools`;
    return (
      <React.Fragment>
        <a
          href="#devtools"
          title={label}
          aria-label={label}
          className={`discoverystream-admin-toggle ${
            isCollapsed ? "collapsed" : "expanded"
          }`}
          onClick={this.renderAdmin ? this.onCollapseToggle : null}
        >
          <span className="icon icon-devtools" />
        </a>
        {renderAdmin ? (
          <DiscoveryStreamAdminInner
            {...props}
            collapsed={this.state.collapsed}
          />
        ) : null}
      </React.Fragment>
    );
  }
}

const _DiscoveryStreamAdmin = props => (
  <SimpleHashRouter>
    <CollapseToggle {...props} />
  </SimpleHashRouter>
);

export const DiscoveryStreamAdmin = connect(state => ({
  Sections: state.Sections,
  DiscoveryStream: state.DiscoveryStream,
  Personalization: state.Personalization,
  Prefs: state.Prefs,
  Weather: state.Weather,
}))(_DiscoveryStreamAdmin);
