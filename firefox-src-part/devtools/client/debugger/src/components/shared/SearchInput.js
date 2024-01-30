/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import React, { Component } from "react";
import PropTypes from "prop-types";
import { connect } from "../../utils/connect";
import { CloseButton } from "./Button";

import AccessibleImage from "./AccessibleImage";
import actions from "../../actions";
import "./SearchInput.css";
import { getSearchOptions } from "../../selectors";

const classnames = require("devtools/client/shared/classnames.js");
const SearchModifiers = require("devtools/client/shared/components/SearchModifiers");

const arrowBtn = (onClick, type, className, tooltip) => {
  const props = {
    className,
    key: type,
    onClick,
    title: tooltip,
    type,
  };

  return (
    <button {...props}>
      <AccessibleImage className={type} />
    </button>
  );
};

export class SearchInput extends Component {
  static defaultProps = {
    expanded: false,
    hasPrefix: false,
    selectedItemId: "",
    size: "",
    showClose: true,
  };

  constructor(props) {
    super(props);
    this.state = {
      history: [],
      excludePatterns: props.searchOptions.excludePatterns,
    };
  }

  static get propTypes() {
    return {
      count: PropTypes.number.isRequired,
      expanded: PropTypes.bool.isRequired,
      handleClose: PropTypes.func,
      handleNext: PropTypes.func,
      handlePrev: PropTypes.func,
      hasPrefix: PropTypes.bool.isRequired,
      isLoading: PropTypes.bool.isRequired,
      onBlur: PropTypes.func,
      onChange: PropTypes.func,
      onFocus: PropTypes.func,
      onHistoryScroll: PropTypes.func,
      onKeyDown: PropTypes.func,
      onKeyUp: PropTypes.func,
      placeholder: PropTypes.string,
      query: PropTypes.string,
      selectedItemId: PropTypes.string,
      shouldFocus: PropTypes.bool,
      showClose: PropTypes.bool.isRequired,
      showExcludePatterns: PropTypes.bool.isRequired,
      excludePatternsLabel: PropTypes.string,
      excludePatternsPlaceholder: PropTypes.string,
      showErrorEmoji: PropTypes.bool.isRequired,
      size: PropTypes.string,
      summaryMsg: PropTypes.string,
      searchKey: PropTypes.string.isRequired,
      searchOptions: PropTypes.object,
      setSearchOptions: PropTypes.func,
      showSearchModifiers: PropTypes.bool.isRequired,
      onToggleSearchModifier: PropTypes.func,
    };
  }

  componentDidMount() {
    this.setFocus();
  }

  componentDidUpdate(prevProps) {
    if (this.props.shouldFocus && !prevProps.shouldFocus) {
      this.setFocus();
    }
  }

  setFocus() {
    if (this.$input) {
      const input = this.$input;
      input.focus();

      if (!input.value) {
        return;
      }

      // omit prefix @:# from being selected
      const selectStartPos = this.props.hasPrefix ? 1 : 0;
      input.setSelectionRange(selectStartPos, input.value.length + 1);
    }
  }

  renderArrowButtons() {
    const { handleNext, handlePrev } = this.props;

    return [
      arrowBtn(
        handlePrev,
        "arrow-up",
        classnames("nav-btn", "prev"),
        L10N.getFormatStr("editor.searchResults.prevResult")
      ),
      arrowBtn(
        handleNext,
        "arrow-down",
        classnames("nav-btn", "next"),
        L10N.getFormatStr("editor.searchResults.nextResult")
      ),
    ];
  }

  onFocus = e => {
    const { onFocus } = this.props;

    if (onFocus) {
      onFocus(e);
    }
  };

  onBlur = e => {
    const { onBlur } = this.props;

    if (onBlur) {
      onBlur(e);
    }
  };

  onKeyDown = e => {
    const { onHistoryScroll, onKeyDown } = this.props;
    if (!onHistoryScroll) {
      onKeyDown(e);
      return;
    }

    const inputValue = e.target.value;
    const { history } = this.state;
    const currentHistoryIndex = history.indexOf(inputValue);

    if (e.key === "Enter") {
      this.saveEnteredTerm(inputValue);
      onKeyDown(e);
      return;
    }

    if (e.key === "ArrowUp") {
      const previous =
        currentHistoryIndex > -1 ? currentHistoryIndex - 1 : history.length - 1;
      const previousInHistory = history[previous];
      if (previousInHistory) {
        e.preventDefault();
        onHistoryScroll(previousInHistory);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      const next = currentHistoryIndex + 1;
      const nextInHistory = history[next];
      if (nextInHistory) {
        onHistoryScroll(nextInHistory);
      }
    }
  };

  onExcludeKeyDown = e => {
    if (e.key === "Enter") {
      this.props.setSearchOptions(this.props.searchKey, {
        excludePatterns: this.state.excludePatterns,
      });
      this.props.onKeyDown(e);
    }
  };

  saveEnteredTerm(query) {
    const { history } = this.state;
    const previousIndex = history.indexOf(query);
    if (previousIndex !== -1) {
      history.splice(previousIndex, 1);
    }
    history.push(query);
    this.setState({ history });
  }

  renderSummaryMsg() {
    const { summaryMsg } = this.props;

    if (!summaryMsg) {
      return null;
    }

    return <div className="search-field-summary">{summaryMsg}</div>;
  }

  renderSpinner() {
    const { isLoading } = this.props;
    if (!isLoading) {
      return null;
    }
    return <AccessibleImage className="loader spin" />;
  }

  renderNav() {
    const { count, handleNext, handlePrev } = this.props;
    if ((!handleNext && !handlePrev) || !count || count == 1) {
      return null;
    }

    return (
      <div className="search-nav-buttons">{this.renderArrowButtons()}</div>
    );
  }

  renderSearchModifiers() {
    if (!this.props.showSearchModifiers) {
      return null;
    }
    return (
      <SearchModifiers
        modifiers={this.props.searchOptions}
        onToggleSearchModifier={updatedOptions => {
          this.props.setSearchOptions(this.props.searchKey, updatedOptions);
          this.props.onToggleSearchModifier();
        }}
      />
    );
  }

  renderExcludePatterns() {
    if (!this.props.showExcludePatterns) {
      return null;
    }

    return (
      <div className={classnames("exclude-patterns-field", this.props.size)}>
        <label>{this.props.excludePatternsLabel}</label>
        <input
          placeholder={this.props.excludePatternsPlaceholder}
          value={this.state.excludePatterns}
          onKeyDown={this.onExcludeKeyDown}
          onChange={e => this.setState({ excludePatterns: e.target.value })}
        />
      </div>
    );
  }

  renderClose() {
    if (!this.props.showClose) {
      return null;
    }
    return (
      <React.Fragment>
        <span className="pipe-divider" />
        <CloseButton
          handleClick={this.props.handleClose}
          buttonClass={this.props.size}
        />
      </React.Fragment>
    );
  }

  render() {
    const {
      expanded,
      onChange,
      onKeyUp,
      placeholder,
      query,
      selectedItemId,
      showErrorEmoji,
      size,
    } = this.props;

    const inputProps = {
      className: classnames({
        empty: showErrorEmoji,
      }),
      onChange,
      onKeyDown: e => this.onKeyDown(e),
      onKeyUp,
      onFocus: e => this.onFocus(e),
      onBlur: e => this.onBlur(e),
      "aria-autocomplete": "list",
      "aria-controls": "result-list",
      "aria-activedescendant":
        expanded && selectedItemId ? `${selectedItemId}-title` : "",
      placeholder,
      value: query,
      spellCheck: false,
      ref: c => (this.$input = c),
    };

    return (
      <div className="search-outline">
        <div
          className={classnames("search-field", size)}
          role="combobox"
          aria-haspopup="listbox"
          aria-owns="result-list"
          aria-expanded={expanded}
        >
          <AccessibleImage className="search" />
          <input {...inputProps} />
          {this.renderSpinner()}
          {this.renderSummaryMsg()}
          {this.renderNav()}
          <div className="search-buttons-bar">
            {this.renderSearchModifiers()}
            {this.renderClose()}
          </div>
        </div>
        {this.renderExcludePatterns()}
      </div>
    );
  }
}
const mapStateToProps = (state, props) => ({
  searchOptions: getSearchOptions(state, props.searchKey),
});

export default connect(mapStateToProps, {
  setSearchOptions: actions.setSearchOptions,
})(SearchInput);
