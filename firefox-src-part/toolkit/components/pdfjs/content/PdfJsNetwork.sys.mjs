/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

function getTypedArray(xhr) {
  const data = xhr.response;
  if (typeof data !== "string") {
    return new Uint8Array(data);
  }
  return Uint8Array.from(data, ch => ch.charCodeAt(0) & 0xff);
}

const OK_RESPONSE = 200;
const PARTIAL_CONTENT_RESPONSE = 206;

export class NetworkManager {
  constructor(url, args = {}) {
    this.url = url;
    this.isHttp = /^https?:/i.test(url);
    this.httpHeaders = (this.isHttp && args.httpHeaders) || {};
    this.withCredentials = args.withCredentials || false;
    this.getXhr =
      args.getXhr ||
      function NetworkManager_getXhr() {
        return new XMLHttpRequest();
      };

    this.currXhrId = 0;
    this.pendingRequests = Object.create(null);
  }

  requestRange(begin, end, listeners) {
    var args = {
      begin,
      end,
    };
    for (var prop in listeners) {
      args[prop] = listeners[prop];
    }
    return this.request(args);
  }

  request(args) {
    var xhr = this.getXhr();
    var xhrId = this.currXhrId++;
    var pendingRequest = (this.pendingRequests[xhrId] = {
      xhr,
    });

    xhr.open("GET", this.url);
    xhr.withCredentials = this.withCredentials;
    for (var property in this.httpHeaders) {
      var value = this.httpHeaders[property];
      if (typeof value === "undefined") {
        continue;
      }
      xhr.setRequestHeader(property, value);
    }
    if (this.isHttp && "begin" in args && "end" in args) {
      var rangeStr = args.begin + "-" + (args.end - 1);
      xhr.setRequestHeader("Range", "bytes=" + rangeStr);
      pendingRequest.expectedStatus = 206;
      xhr.channel.QueryInterface(Ci.nsIHttpChannel).redirectionLimit = 0;
    } else {
      pendingRequest.expectedStatus = 200;
    }

    xhr.responseType = "arraybuffer";

    if (args.onError) {
      xhr.onerror = function (evt) {
        args.onError(xhr.status);
      };
    }
    xhr.onreadystatechange = this.onStateChange.bind(this, xhrId);
    xhr.onprogress = this.onProgress.bind(this, xhrId);

    pendingRequest.onHeadersReceived = args.onHeadersReceived;
    pendingRequest.onDone = args.onDone;
    pendingRequest.onError = args.onError;
    pendingRequest.onProgress = args.onProgress;

    xhr.send(null);

    return xhrId;
  }

  onProgress(xhrId, evt) {
    var pendingRequest = this.pendingRequests[xhrId];
    if (!pendingRequest) {
      // Maybe abortRequest was called...
      return;
    }

    var onProgress = pendingRequest.onProgress;
    if (onProgress) {
      onProgress(evt);
    }
  }

  onStateChange(xhrId, evt) {
    var pendingRequest = this.pendingRequests[xhrId];
    if (!pendingRequest) {
      // Maybe abortRequest was called...
      return;
    }

    var xhr = pendingRequest.xhr;
    if (xhr.readyState >= 2 && pendingRequest.onHeadersReceived) {
      pendingRequest.onHeadersReceived();
      delete pendingRequest.onHeadersReceived;
    }

    if (xhr.readyState !== 4) {
      return;
    }

    if (!(xhrId in this.pendingRequests)) {
      // The XHR request might have been aborted in onHeadersReceived()
      // callback, in which case we should abort request
      return;
    }

    delete this.pendingRequests[xhrId];

    // success status == 0 can be on ftp, file and other protocols
    if (xhr.status === 0 && this.isHttp) {
      if (pendingRequest.onError) {
        pendingRequest.onError(xhr.status);
      }
      return;
    }
    var xhrStatus = xhr.status || OK_RESPONSE;

    // From http://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.35.2:
    // "A server MAY ignore the Range header". This means it's possible to
    // get a 200 rather than a 206 response from a range request.
    var ok_response_on_range_request =
      xhrStatus === OK_RESPONSE &&
      pendingRequest.expectedStatus === PARTIAL_CONTENT_RESPONSE;

    if (
      !ok_response_on_range_request &&
      xhrStatus !== pendingRequest.expectedStatus
    ) {
      if (pendingRequest.onError) {
        pendingRequest.onError(xhr.status);
      }
      return;
    }

    const chunk = getTypedArray(xhr);
    if (xhrStatus === PARTIAL_CONTENT_RESPONSE) {
      var rangeHeader = xhr.getResponseHeader("Content-Range");
      var matches = /bytes (\d+)-(\d+)\/(\d+)/.exec(rangeHeader);
      var begin = parseInt(matches[1], 10);
      pendingRequest.onDone({
        begin,
        chunk,
      });
    } else if (chunk) {
      pendingRequest.onDone({
        begin: 0,
        chunk,
      });
    } else if (pendingRequest.onError) {
      pendingRequest.onError(xhr.status);
    }
  }

  abortAllRequests() {
    for (var xhrId in this.pendingRequests) {
      this.abortRequest(xhrId | 0);
    }
  }

  abortRequest(xhrId) {
    var xhr = this.pendingRequests[xhrId].xhr;
    delete this.pendingRequests[xhrId];
    xhr.abort();
  }
}
