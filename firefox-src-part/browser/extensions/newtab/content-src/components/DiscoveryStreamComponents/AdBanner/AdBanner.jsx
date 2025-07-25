/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import React, { useState } from "react";
import { SafeAnchor } from "../SafeAnchor/SafeAnchor";
import { ImpressionStats } from "../../DiscoveryStreamImpressionStats/ImpressionStats";
import { actionCreators as ac } from "common/Actions.mjs";
import { AdBannerContextMenu } from "../AdBannerContextMenu/AdBannerContextMenu";

/**
 * A new banner ad that appears between rows of stories: leaderboard or billboard size.
 *
 * @param spoc
 * @param dispatch
 * @param firstVisibleTimestamp
 * @param row
 * @param type
 * @param prefs
 * @returns {Element}
 * @constructor
 */
export const AdBanner = ({
  spoc,
  dispatch,
  firstVisibleTimestamp,
  row,
  type,
  prefs,
}) => {
  const getDimensions = format => {
    switch (format) {
      case "leaderboard":
        return {
          width: "728",
          height: "90",
        };
      case "billboard":
        return {
          width: "970",
          height: "250",
        };
    }
    return {
      // image will still render with default values
      width: undefined,
      height: undefined,
    };
  };

  const sectionsEnabled = prefs["discoverystream.sections.enabled"];
  const showAdReporting = prefs["discoverystream.reportAds.enabled"];
  const [menuActive, setMenuActive] = useState(false);
  const adBannerWrapperClassName = `ad-banner-wrapper ${menuActive ? "active" : ""}`;

  const { width: imgWidth, height: imgHeight } = getDimensions(spoc.format);

  const onLinkClick = () => {
    dispatch(
      ac.DiscoveryStreamUserEvent({
        event: "CLICK",
        source: type.toUpperCase(),
        // Banner ads don't have a position, but a row number
        action_position: parseInt(row, 10),
        value: {
          card_type: "spoc",
          tile_id: spoc.id,
          ...(spoc.shim?.click ? { shim: spoc.shim.click } : {}),
          fetchTimestamp: spoc.fetchTimestamp,
          firstVisibleTimestamp,
          format: spoc.format,
          ...(sectionsEnabled
            ? {
                section: spoc.format,
                section_position: parseInt(row, 10),
              }
            : {}),
        },
      })
    );
  };

  const toggleActive = active => {
    setMenuActive(active);
  };

  // in the default card grid 1 would come before the 1st row of cards and 9 comes after the last row
  // using clamp to make sure its between valid values (1-9)
  const clampedRow = Math.max(1, Math.min(9, row));

  return (
    <aside className={adBannerWrapperClassName} style={{ gridRow: clampedRow }}>
      <div className={`ad-banner-inner ${spoc.format}`}>
        <SafeAnchor
          className="ad-banner-link"
          url={spoc.url}
          title={spoc.title || spoc.sponsor || spoc.alt_text}
          onLinkClick={onLinkClick}
          dispatch={dispatch}
        >
          <ImpressionStats
            flightId={spoc.flight_id}
            rows={[
              {
                id: spoc.id,
                card_type: "spoc",
                pos: row,
                recommended_at: spoc.recommended_at,
                received_rank: spoc.received_rank,
                format: spoc.format,
                ...(spoc.shim?.impression
                  ? { shim: spoc.shim.impression }
                  : {}),
              },
            ]}
            dispatch={dispatch}
            firstVisibleTimestamp={firstVisibleTimestamp}
          />
          <div className="ad-banner-content">
            <img
              src={spoc.raw_image_src}
              alt={spoc.alt_text}
              loading="eager"
              width={imgWidth}
              height={imgHeight}
            />
          </div>
          <div className="ad-banner-sponsored">
            <span
              className="ad-banner-sponsored-label"
              data-l10n-id="newtab-label-sponsored-fixed"
            />
          </div>
        </SafeAnchor>
        <div className="ad-banner-hover-background">
          <AdBannerContextMenu
            dispatch={dispatch}
            spoc={spoc}
            position={row}
            type={type}
            showAdReporting={showAdReporting}
            toggleActive={toggleActive}
          />
        </div>
      </div>
    </aside>
  );
};
