/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  NetworkUtils:
    "resource://devtools/shared/network-observer/NetworkUtils.sys.mjs",

  TabManager: "chrome://remote/content/shared/TabManager.sys.mjs",
});

/**
 * The NetworkEventRecord implements the interface expected from network event
 * owners for consumers of the DevTools NetworkObserver.
 *
 * The NetworkEventRecord emits the before-request-sent event on behalf of the
 * NetworkListener instance which created it.
 */
export class NetworkEventRecord {
  #channel;
  #fromCache;
  #networkListener;
  #redirectCount;
  #requestData;
  #requestId;
  #responseData;
  #wrappedChannel;

  /**
   *
   * @param {object} networkEvent
   *     The initial network event information (see createNetworkEvent() in
   *     NetworkUtils.sys.mjs).
   * @param {nsIChannel} channel
   *     The nsIChannel behind this network event.
   * @param {NetworkListener} networkListener
   *     The NetworkListener which created this NetworkEventRecord.
   */
  constructor(networkEvent, channel, networkListener) {
    this.#channel = channel;
    this.#fromCache = networkEvent.fromCache;

    this.#wrappedChannel = ChannelWrapper.get(channel);

    this.#networkListener = networkListener;

    // The wrappedChannel id remains identical across redirects, whereas
    // nsIChannel.channelId is different for each and every request.
    this.#requestId = this.#wrappedChannel.id.toString();

    const { cookies, headers } =
      lazy.NetworkUtils.fetchRequestHeadersAndCookies(channel);

    // See the RequestData type definition for the full list of properties that
    // should be set on this object.
    this.#requestData = {
      bodySize: null,
      cookies,
      headers,
      headersSize: networkEvent.rawHeaders ? networkEvent.rawHeaders.length : 0,
      method: channel.requestMethod,
      request: this.#requestId,
      timings: {},
      url: channel.URI.spec,
    };

    // See the ResponseData type definition for the full list of properties that
    // should be set on this object.
    this.#responseData = {
      // encoded size (body)
      bodySize: null,
      content: {
        // decoded size
        size: null,
      },
      // encoded size (headers)
      headersSize: null,
      url: channel.URI.spec,
    };

    // NetworkObserver creates a network event when request headers have been
    // parsed.
    // According to the BiDi spec, we should emit beforeRequestSent when adding
    // request headers, see https://whatpr.org/fetch/1540.html#http-network-or-cache-fetch
    // step 8.17
    // Bug 1802181: switch the NetworkObserver to an event-based API.
    this.#emitBeforeRequestSent();
  }

  /**
   * Add network request POST data.
   *
   * Required API for a NetworkObserver event owner.
   *
   * @param {object} postData
   *     The request POST data.
   */
  addRequestPostData(postData) {
    // Only the postData size is needed for RemoteAgent consumers.
    this.#requestData.bodySize = postData.size;
  }

  /**
   * Add the initial network response information.
   *
   * Required API for a NetworkObserver event owner.
   *
   *
   * @param {object} options
   * @param {nsIChannel} options.channel
   *     The channel.
   * @param {boolean} options.fromCache
   * @param {string} options.rawHeaders
   */
  addResponseStart(options) {
    const { channel, fromCache, rawHeaders = "" } = options;
    const { headers } =
      lazy.NetworkUtils.fetchResponseHeadersAndCookies(channel);

    const headersSize = rawHeaders.length;
    this.#responseData = {
      ...this.#responseData,
      bodySize: 0,
      bytesReceived: headersSize,
      fromCache: this.#fromCache || !!fromCache,
      headers,
      headersSize,
      mimeType: this.#getMimeType(),
      protocol: lazy.NetworkUtils.getProtocol(channel),
      status: channel.responseStatus,
      statusText: channel.responseStatusText,
    };

    // This should be triggered when all headers have been received, matching
    // the WebDriverBiDi response started trigger in `4.6. HTTP-network fetch`
    // from the fetch specification, based on the PR visible at
    // https://github.com/whatwg/fetch/pull/1540
    this.#emitResponseStarted();
  }

  /**
   * Add connection security information.
   *
   * Required API for a NetworkObserver event owner.
   *
   * Not used for RemoteAgent.
   *
   * @param {object} info
   *     The object containing security information.
   * @param {boolean} isRacing
   *     True if the corresponding channel raced the cache and network requests.
   */
  addSecurityInfo(info, isRacing) {}

  /**
   * Add network event timings.
   *
   * Required API for a NetworkObserver event owner.
   *
   * Not used for RemoteAgent.
   *
   * @param {number} total
   *     The total time for the request.
   * @param {object} timings
   *     The har-like timings.
   * @param {object} offsets
   *     The har-like timings, but as offset from the request start.
   * @param {Array} serverTimings
   *     The server timings.
   */
  addEventTimings(total, timings, offsets, serverTimings) {}

  /**
   * Add response cache entry.
   *
   * Required API for a NetworkObserver event owner.
   *
   * Not used for RemoteAgent.
   *
   * @param {object} options
   *     An object which contains a single responseCache property.
   */
  addResponseCache(options) {}

  /**
   * Add response content.
   *
   * Required API for a NetworkObserver event owner.
   *
   * @param {object} response
   *     An object which represents the response content.
   * @param {object} responseInfo
   *     Additional meta data about the response.
   */
  addResponseContent(response, responseInfo) {
    // Update content-related sizes with the latest data from addResponseContent.
    this.#responseData = {
      ...this.#responseData,
      bodySize: response.bodySize,
      bytesReceived: response.transferredSize,
      content: {
        size: response.decodedBodySize,
      },
    };

    this.#emitResponseCompleted();
  }

  /**
   * Add server timings.
   *
   * Required API for a NetworkObserver event owner.
   *
   * Not used for RemoteAgent.
   *
   * @param {Array} serverTimings
   *     The server timings.
   */
  addServerTimings(serverTimings) {}

  #emitBeforeRequestSent() {
    this.#updateDataFromTimedChannel();

    this.#networkListener.emit("before-request-sent", {
      contextId: this.#getContextId(),
      redirectCount: this.#redirectCount,
      requestData: this.#requestData,
      timestamp: Date.now(),
    });
  }

  #emitResponseCompleted() {
    this.#updateDataFromTimedChannel();

    this.#networkListener.emit("response-completed", {
      contextId: this.#getContextId(),
      redirectCount: this.#redirectCount,
      requestData: this.#requestData,
      responseData: this.#responseData,
      timestamp: Date.now(),
    });
  }

  #emitResponseStarted() {
    this.#updateDataFromTimedChannel();

    this.#networkListener.emit("response-started", {
      contextId: this.#getContextId(),
      redirectCount: this.#redirectCount,
      requestData: this.#requestData,
      responseData: this.#responseData,
      timestamp: Date.now(),
    });
  }

  /**
   * Convert the provided request timing to a timing relative to the beginning
   * of the request. All timings are numbers representing high definition
   * timestamps.
   *
   * @param {number} timing
   *     High definition timestamp for a request timing relative from the time
   *     origin.
   * @param {number} requestTime
   *     High definition timestamp for the request start time relative from the
   *     time origin.
   * @returns {number}
   *     High definition timestamp for the request timing relative to the start
   *     time of the request, or 0 if the provided timing was 0.
   */
  #convertTimestamp(timing, requestTime) {
    if (timing == 0) {
      return 0;
    }

    return timing - requestTime;
  }

  /**
   * Retrieve the context id corresponding to the current channel, this could
   * change dynamically during a cross group navigation for an iframe, so this
   * should always be retrieved dynamically.
   */
  #getContextId() {
    const id = lazy.NetworkUtils.getChannelBrowsingContextID(this.#channel);
    const browsingContext = BrowsingContext.get(id);
    return lazy.TabManager.getIdForBrowsingContext(browsingContext);
  }

  #getMimeType() {
    // TODO: DevTools NetworkObserver is computing a similar value in
    // addResponseContent, but uses an inconsistent implementation in
    // addResponseStart. This approach can only be used as early as in
    // addResponseHeaders. We should move this logic to the NetworkObserver and
    // expose mimeType in addResponseStart. Bug 1809670.
    let mimeType = "";

    try {
      mimeType = this.#wrappedChannel.contentType;
      const contentCharset = this.#channel.contentCharset;
      if (contentCharset) {
        mimeType += `;charset=${contentCharset}`;
      }
    } catch (e) {
      // Ignore exceptions when reading contentType/contentCharset
    }

    return mimeType;
  }

  #getTimingsFromTimedChannel(timedChannel) {
    const {
      channelCreationTime,
      redirectStartTime,
      redirectEndTime,
      dispatchFetchEventStartTime,
      cacheReadStartTime,
      domainLookupStartTime,
      domainLookupEndTime,
      connectStartTime,
      connectEndTime,
      secureConnectionStartTime,
      requestStartTime,
      responseStartTime,
      responseEndTime,
    } = timedChannel;

    // fetchStart should be the post-redirect start time, which should be the
    // first non-zero timing from: dispatchFetchEventStart, cacheReadStart and
    // domainLookupStart. See https://www.w3.org/TR/navigation-timing-2/#processing-model
    const fetchStartTime =
      dispatchFetchEventStartTime ||
      cacheReadStartTime ||
      domainLookupStartTime;

    // Bug 1805478: Per spec, the origin time should match Performance API's
    // originTime for the global which initiated the request. This is not
    // available in the parent process, so for now we will use 0.
    const originTime = 0;

    return {
      originTime,
      requestTime: this.#convertTimestamp(channelCreationTime, originTime),
      redirectStart: this.#convertTimestamp(redirectStartTime, originTime),
      redirectEnd: this.#convertTimestamp(redirectEndTime, originTime),
      fetchStart: this.#convertTimestamp(fetchStartTime, originTime),
      dnsStart: this.#convertTimestamp(domainLookupStartTime, originTime),
      dnsEnd: this.#convertTimestamp(domainLookupEndTime, originTime),
      connectStart: this.#convertTimestamp(connectStartTime, originTime),
      connectEnd: this.#convertTimestamp(connectEndTime, originTime),
      tlsStart: this.#convertTimestamp(secureConnectionStartTime, originTime),
      tlsEnd: this.#convertTimestamp(connectEndTime, originTime),
      requestStart: this.#convertTimestamp(requestStartTime, originTime),
      responseStart: this.#convertTimestamp(responseStartTime, originTime),
      responseEnd: this.#convertTimestamp(responseEndTime, originTime),
    };
  }

  /**
   * Update the timings and the redirect count from the nsITimedChannel
   * corresponding to the current channel. This should be called before emitting
   * any event from this class.
   */
  #updateDataFromTimedChannel() {
    const timedChannel = this.#channel.QueryInterface(Ci.nsITimedChannel);
    this.#redirectCount = timedChannel.redirectCount;
    this.#requestData.timings = this.#getTimingsFromTimedChannel(timedChannel);
  }
}
