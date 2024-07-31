addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const PROXY_COOKIE = "__PROXY_VISITEDSITE__";
const REPLACE_URL_OBJ = "__location____";
let thisProxyServerUrlHttps;
let thisProxyServerUrl_hostOnly;

const httpRequestInjection = `
// 网络请求注入代码
(function() {
  const now = new URL(window.location.href);
  const base = now.host;
  const protocol = now.protocol;
  const nowlink = protocol + "//" + base + "/";
  const oriUrlStr = window.location.href.substring(nowlink.length);
  const oriUrl = new URL(oriUrlStr);
  const original_host = new URL(oriUrlStr).host;
  const mainOnly = oriUrlStr.substring(0, oriUrlStr.indexOf("://") + "://".length) + original_host + "/";

  function changeURL(relativePath) {
    if (!relativePath) return "";
    try {
      if (relativePath.startsWith(nowlink)) relativePath = relativePath.substring(nowlink.length);
      if (relativePath.startsWith(base + "/")) relativePath = relativePath.substring(base.length + 1);
      if (relativePath.startsWith(base)) relativePath = relativePath.substring(base.length);

      let absolutePath = new URL(relativePath, oriUrlStr).href;
      absolutePath = absolutePath.replace(window.location.href, oriUrlStr);
      absolutePath = absolutePath.replace(encodeURI(window.location.href), oriUrlStr);
      absolutePath = absolutePath.replace(encodeURIComponent(window.location.href), oriUrlStr);

      absolutePath = absolutePath.replace(nowlink, mainOnly);
      absolutePath = absolutePath.replace(nowlink, encodeURI(mainOnly));
      absolutePath = absolutePath.replace(nowlink, encodeURIComponent(nowlink));

      absolutePath = absolutePath.replace(base, original_host);

      return nowlink + absolutePath;
    } catch (e) {
      console.error("Error changing URL:", e);
      return "";
    }
  }

  // 拦截 XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    arguments[1] = changeURL(url);
    return originalXHROpen.apply(this, arguments);
  };

  // 拦截 fetch
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      arguments[0] = changeURL(input);
    } else if (input instanceof Request) {
      input = new Request(changeURL(input.url), input);
    }
    return originalFetch.apply(this, arguments);
  };

  // 拦截 window.open
  const originalOpen = window.open;
  window.open = function(url, name, specs) {
    arguments[0] = changeURL(url);
    return originalOpen.apply(this, arguments);
  };

  // Location 对象代理
  class ProxyLocation {
    constructor(originalLocation) {
      this.originalLocation = originalLocation;
    }

    get href() { return oriUrlStr; }
    set href(url) { this.originalLocation.href = changeURL(url); }

    get protocol() { return this.originalLocation.protocol; }
    set protocol(value) { this.originalLocation.protocol = value; }

    get host() { return original_host; }
    set host(value) { this.originalLocation.host = changeURL(value).split('/')[2]; }

    get hostname() { return oriUrl.hostname; }
    set hostname(value) { this.originalLocation.hostname = value; }

    get port() { return oriUrl.port; }
    set port(value) { this.originalLocation.port = value; }

    get pathname() { return oriUrl.pathname; }
    set pathname(value) { this.originalLocation.pathname = value; }

    get search() { return oriUrl.search; }
    set search(value) { this.originalLocation.search = value; }

    get hash() { return oriUrl.hash; }
    set hash(value) { this.originalLocation.hash = value; }

    get origin() { return oriUrl.origin; }

    assign(url) { this.originalLocation.assign(changeURL(url)); }
    replace(url) { this.originalLocation.replace(changeURL(url)); }
    reload(forcedReload) { this.originalLocation.reload(forcedReload); }
  }

  // 注入 ProxyLocation
  Object.defineProperty(window, '${REPLACE_URL_OBJ}', {
    get: function() { return new ProxyLocation(window.location); },
    set: function(url) { window.location.href = changeURL(url); }
  });

  Object.defineProperty(document, '${REPLACE_URL_OBJ}', {
    get: function() { return new ProxyLocation(document.location); },
    set: function(url) { document.location = changeURL(url); }
  });

  // 注入历史状态管理
  const originalPushState = History.prototype.pushState;
  const originalReplaceState = History.prototype.replaceState;

  History.prototype.pushState = function(state, title, url) {
    return originalPushState.call(this, state, title, changeURL(url));
  };

  History.prototype.replaceState = function(state, title, url) {
    return originalReplaceState.call(this, state, title, changeURL(url));
  };

  // 监视页面变化
  function observeDOM() {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              processNode(node);
            }
          });
        } else if (mutation.type === 'attributes') {
          processNode(mutation.target);
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'href']
    });
  }

  function processNode(node) {
    if (node.tagName === 'A' && node.href) {
      node.href = changeURL(node.href);
    } else if ((node.tagName === 'IMG' || node.tagName === 'SCRIPT') && node.src) {
      node.src = changeURL(node.src);
    } else if (node.tagName === 'LINK' && node.href) {
      node.href = changeURL(node.href);
    }
    // 移除 integrity 属性
    if (node.hasAttribute('integrity')) {
      node.removeAttribute('integrity');
    }
  }

  // 初始化
  window.addEventListener('DOMContentLoaded', () => {
    Array.from(document.getElementsByTagName('*')).forEach(processNode);
    observeDOM();
  });
})();
`;

async function handleRequest(request) {
  const url = new URL(request.url);
  thisProxyServerUrlHttps = `${url.protocol}//${url.hostname}/`;
  thisProxyServerUrl_hostOnly = url.host;

  if (request.url.endsWith("favicon.ico")) {
    return Response.redirect("https://www.example.com/favicon.ico", 301);
  }

  let actualUrlStr = url.pathname.substring(1) + url.search + url.hash;
  if (actualUrlStr === "") {
    return getHTMLResponse(getMainPage());
  }

  try {
    if (!actualUrlStr.startsWith("http")) {
      actualUrlStr = "https://" + actualUrlStr;
    }
    new URL(actualUrlStr);
  } catch {
    const lastVisit = getCookie(PROXY_COOKIE, request.headers.get('Cookie'));
    if (lastVisit) {
      return Response.redirect(thisProxyServerUrlHttps + lastVisit + "/" + actualUrlStr, 301);
    }
    return getHTMLResponse("Invalid URL or cookie error.");
  }

  if (!actualUrlStr.startsWith("http")) {
    return Response.redirect(thisProxyServerUrlHttps + "https://" + actualUrlStr, 301);
  }

  const actualUrl = new URL(actualUrlStr);
  const modifiedHeaders = new Headers(request.headers);
  modifiedHeaders.set('Host', actualUrl.host);
  modifiedHeaders.set('Referer', actualUrl.origin);

  let modifiedBody = request.body;
  if (request.body) {
    const bodyText = await request.text();
    modifiedBody = bodyText
      .replaceAll(thisProxyServerUrlHttps, actualUrlStr)
      .replaceAll(thisProxyServerUrl_hostOnly, actualUrl.host);
  }

  const modifiedRequest = new Request(actualUrl, {
    method: request.method,
    headers: modifiedHeaders,
    body: modifiedBody,
    redirect: "manual"
  });

  const response = await fetch(modifiedRequest);

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("Location");
    if (location) {
      try {
        const redirectUrl = new URL(location, actualUrl).href;
        return Response.redirect(thisProxyServerUrlHttps + redirectUrl, response.status);
      } catch {
        return getHTMLResponse("Redirect error: " + location);
      }
    }
  }

  let responseBody;
  const contentType = response.headers.get("Content-Type");
  if (contentType && contentType.includes("text")) {
    responseBody = await response.text();
    responseBody = processResponseBody(responseBody, actualUrlStr, contentType);
  } else {
    responseBody = await response.arrayBuffer();
  }

  const modifiedResponse = new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });

  modifyResponseHeaders(modifiedResponse.headers, actualUrl);

  return modifiedResponse;
}

function processResponseBody(body, requestPath, contentType) {
  body = replaceUrls(body, requestPath);
  
  if (contentType.includes("text/html")) {
    body = removeIntegrityAttributes(body);
    body = injectScript(body);
  }

  return body;
}

function replaceUrls(body, requestPath) {
  const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
  return body.replace(urlRegex, (match) => {
    try {
      const absoluteUrl = new URL(match, requestPath).href;
      return thisProxyServerUrlHttps + absoluteUrl;
    } catch {
      return match;
    }
  });
}

function removeIntegrityAttributes(body) {
  return body.replace(/integrity=("|')([^"']*)("|')/g, '');
}

function injectScript(body) {
  const scriptTag = `<script>${httpRequestInjection}</script>`;
  return body.replace(/<head>/i, `<head>${scriptTag}`);
}

function modifyResponseHeaders(headers, actualUrl) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.delete('Content-Security-Policy');
  headers.delete('Strict-Transport-Security');
  headers.set('X-Frame-Options', 'SAMEORIGIN');

  const cookies = headers.getAll('Set-Cookie');
  headers.delete('Set-Cookie');
  cookies.forEach(cookie => {
    const modifiedCookie = modifyCookie(cookie, actualUrl);
    headers.append('Set-Cookie', modifiedCookie);
  });

  headers.set('Set-Cookie', `${PROXY_COOKIE}=${actualUrl.origin}; Path=/; Domain=${thisProxyServerUrl_hostOnly}`);
}

function modifyCookie(cookie, actualUrl) {
  const parts = cookie.split(';').map(part => part.trim());
  const modifiedParts = parts.map(part => {
    if (part.toLowerCase().startsWith('domain=')) {
      return `domain=${thisProxyServerUrl_hostOnly}`;
    }
    if (part.toLowerCase().startsWith('path=')) {
      const originalPath = part.split('=')[1];
      const absolutePath = new URL(originalPath, actualUrl).pathname;
      return `path=${absolutePath}`;
    }
    return part;
  });
  return modifiedParts.join('; ');
}

function getCookie(name, cookieString) {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function getHTMLResponse(html) {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function getMainPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Proxy Service</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f4f4;
            animation: fadeIn 0.5s ease-in;
        }
        h1 {
          color: #03c9a9;
          text-align: center;
          margin-bottom: 30px;
        }
        input[type="text"] {
            width: calc(100% - 140px);
            padding: 10px;
            margin-right: 10px;
            border: 2px solid #03c9a9;
            border-radius: 5px;
            font-size: 16px;
        }
        button {
            padding: 10px 20px;
            background-color: #03c9a9;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            transition: background-color 0.3s;
        }
        button:hover {
            background-color: #029f87;
        }
        button:active {
            background-color: #027d69;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
    </style>
</head>
<body>
    <h1>Welcome to the Proxy Service</h1>
    <input type="text" id="urlInput" placeholder="https://example.com">
    <button onclick="accessUrl()">Access</button>

    <script>
        function accessUrl() {
            var url = document.getElementById('urlInput').value;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            window.location.href = '/' + url;
        }
    </script>
</body>
</html>
  `;
}
