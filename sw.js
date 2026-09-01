/* TextCatch service worker.
 *
 * Two jobs, and deliberately nothing else:
 *   1. Turn a payload-less push into a lock-screen notification.
 *   2. Put the app in front when that notification is tapped.
 *
 * It does NOT cache the app. A messaging app that serves you a stale inbox is
 * worse than one that needs a network, and a bad cache is the hardest bug to
 * talk someone through over the phone. Offline can come later, on purpose.
 *
 * Must be served from the site ROOT (/sw.js) so its scope covers /app.
 */

var VERSION = "tc-1";

self.addEventListener("install", function () {
  // Take over immediately rather than waiting for every tab to close, so a
  // fix ships the moment the app is reopened.
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

// The push carries no data on purpose (see api/webpush.js). We ask our own
// server what happened, authenticated by the same session cookie the portal
// uses, so the message text never passes through Apple or Google.
async function describeLatest() {
  var fallback = { title: "New message", body: "Someone texted TextCatch.", count: 0 };
  try {
    var r = await fetch("/api/portal/threads", {
      credentials: "include",
      cache: "no-store",
    });
    if (!r.ok) return fallback;

    var j = await r.json();
    var threads = (j && j.threads) || [];
    if (!threads.length) return fallback;

    // threads arrive newest-activity-first
    var t = threads[0];
    var msgs = t.messages || [];
    var last = msgs.length ? msgs[msgs.length - 1] : null;

    // If our own reply is the newest thing, this push was not about a new
    // inbound message. Stay quiet rather than buzzing him about himself.
    if (last && last.direction === "outbound") return null;

    var unread = 0;
    threads.forEach(function (th) {
      var m = (th.messages || [])[(th.messages || []).length - 1];
      if (m && m.direction === "inbound") unread++;
    });

    return {
      title: t.name || prettyPhone(t.phone),
      body: (last && last.body) || "New message",
      tag: "tc-thread-" + t.id,
      count: unread,
    };
  } catch (e) {
    return fallback;
  }
}

function prettyPhone(p) {
  var m = String(p || "").match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? "(" + m[1] + ") " + m[2] + "-" + m[3] : (p || "New message");
}

self.addEventListener("push", function (event) {
  event.waitUntil((async function () {
    var info = await describeLatest();

    // Browsers require a visible notification for every push. Skipping one
    // repeatedly gets the subscription revoked, so when there is nothing worth
    // saying we still have to say something - keep it quiet and untagged.
    if (!info) {
      return self.registration.showNotification("TextCatch", {
        body: "Conversation updated.",
        icon: "/api/icon?n=192",
        badge: "/api/icon?n=72",
        silent: true,
        tag: "tc-quiet",
      });
    }

    if (self.navigator && self.navigator.setAppBadge && info.count) {
      try { self.navigator.setAppBadge(info.count); } catch (e) {}
    }

    return self.registration.showNotification(info.title, {
      body: info.body,
      icon: "/api/icon?n=192",
      badge: "/api/icon?n=72",
      // Same tag replaces the previous notification for that thread instead of
      // stacking five of them when someone sends five texts.
      tag: info.tag || "tc",
      renotify: true,
      data: { url: "/app" },
    });
  })());
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/app";

  event.waitUntil((async function () {
    var all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (var i = 0; i < all.length; i++) {
      if (all[i].url.indexOf(self.registration.scope) === 0 && "focus" in all[i]) {
        // Already open somewhere - focus it rather than opening a second copy.
        try { all[i].postMessage({ type: "refresh" }); } catch (e) {}
        return all[i].focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

// Chrome can silently rotate a subscription. Without this the phone goes quiet
// and nothing anywhere reports an error - the worst possible failure for a
// notification system, so it is handled explicitly.
self.addEventListener("pushsubscriptionchange", function (event) {
  event.waitUntil((async function () {
    try {
      var old = event.oldSubscription || (await self.registration.pushManager.getSubscription());
      var appKey = (event.newSubscription && event.newSubscription.options &&
                    event.newSubscription.options.applicationServerKey) ||
                   (old && old.options && old.options.applicationServerKey);
      var fresh = event.newSubscription || (appKey && await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appKey,
      }));
      if (!fresh) return;
      await fetch("/api/portal/push", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: fresh.toJSON ? fresh.toJSON() : fresh,
          replaces: old && old.endpoint,
        }),
      });
    } catch (e) {
      // Nothing useful to do here; the app resubscribes on next open.
    }
  })());
});
