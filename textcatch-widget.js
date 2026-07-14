(function () {
  "use strict";

  /* =================== CONFIG =================== */
  const CONFIG = {
    webhookUrl: "/api/chat",     // Layer 2 backend (same-origin on textcatch.app)
    agentName: "Tex",            // the friendly name the chat greets with
    position: "right",           // "right" or "left"
    popupDelay: 3000,            // ms after page load before the bubble pops
    panelWidth: 320,             // chat panel width in px (try 300-360)
    launcherSize: 56,            // round button diameter in px
    scale: 1,                    // overall size multiplier (0.9 = 10% smaller)
    businessName: "TextCatch",
    defaultCountryCode: "1",     // US
    accent: "#16B57A",           // TextCatch brand green
    accentDark: "#109A66",       // darker shade for hover
    panelBg: "#1c1c1e",
    panelBg2: "#262629",
    bubbleBot: "#2f2f33",        // bot message bubble color
    bubbleUser: "#16B57A",       // user message bubble color
    logoUrl: "",                 // no avatar photo yet → falls back to text logo

    // ---- Conversation copy (edit freely) ----
    peekMessage: "Hey 👋 This is TextCatch — ask a question and watch it text you back.",
    askDetails: "Happy to help with that! Before I do — mind sharing your name, email & phone so I can follow up by text?",
    closing: "Thanks {name}! I'll get right back to you — keep an eye on your texts 📲"
  };
  /* ============================================== */

  const side = CONFIG.position === "left" ? "left" : "right";

  const css = `
    #bfh-root, #bfh-root * { box-sizing: border-box; }
    #bfh-root {
      position: fixed; bottom: 22px; ${side}: 22px; z-index: 2147483000;
      transform: scale(${CONFIG.scale}); transform-origin: ${side} bottom;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    #bfh-launcher {
      width: ${CONFIG.launcherSize}px; height: ${CONFIG.launcherSize}px; border-radius: 50%;
      border: none; cursor: pointer; background: ${CONFIG.accent};
      box-shadow: 0 6px 20px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.18);
      display: flex; align-items: center; justify-content: center;
      transition: transform .18s ease, box-shadow .18s ease; position: relative;
    }
    #bfh-launcher:hover { transform: scale(1.06); }
    #bfh-launcher:active { transform: scale(.97); }
    #bfh-launcher svg { width: 28px; height: 28px; fill: #fff; }
    #bfh-launcher.bfh-open { background: ${CONFIG.panelBg}; }
    #bfh-badge {
      position: absolute; top: -4px; ${side === "right" ? "left" : "right"}: -4px;
      width: 18px; height: 18px; border-radius: 50%; background: #e25555;
      color: #fff; font-size: 11px; font-weight: 700; display: none;
      align-items: center; justify-content: center;
    }
    #bfh-launcher.bfh-has-msg #bfh-badge { display: flex; }

    /* peek bubble that pops before opening */
    #bfh-peek {
      position: absolute; bottom: ${CONFIG.launcherSize + 14}px; ${side}: 0;
      width: 248px; background: #fff; color: #1c1c1e; border-radius: 16px;
      padding: 12px 14px; font-size: 13.5px; line-height: 1.45;
      box-shadow: 0 10px 30px rgba(0,0,0,.22); cursor: pointer;
      display: flex; align-items: center; gap: 10px;
      opacity: 0; transform: translateY(10px); pointer-events: none;
      transition: opacity .25s ease, transform .25s ease;
    }
    #bfh-peek .bfh-peek-photo {
      width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; overflow: hidden;
      background: #eee; display: flex; align-items: center; justify-content: center;
    }
    #bfh-peek .bfh-peek-photo img { width: 100%; height: 100%; object-fit: cover; }
    #bfh-peek #bfh-peek-text { flex: 1; }
    #bfh-peek.bfh-show { opacity: 1; transform: translateY(0); pointer-events: auto; }
    #bfh-peek .bfh-peek-close {
      position: absolute; top: 4px; ${side === "right" ? "right" : "left"}: 6px;
      border: none; background: none; color: #bbb; font-size: 16px; cursor: pointer; line-height: 1;
    }

    #bfh-panel {
      position: absolute; bottom: ${CONFIG.launcherSize + 16}px; ${side}: 0;
      width: ${CONFIG.panelWidth}px; max-width: calc(100vw - 36px);
      height: 440px; max-height: calc(100vh - 120px);
      transform-origin: ${side} bottom;
      background: ${CONFIG.panelBg}; color: #fff; border-radius: 18px; overflow: hidden;
      box-shadow: 0 18px 50px rgba(0,0,0,.45);
      opacity: 0; transform: translateY(14px) scale(.97); pointer-events: none;
      transition: opacity .2s ease, transform .2s ease; display: flex; flex-direction: column;
    }
    #bfh-panel.bfh-show { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }

    .bfh-head {
      padding: 14px 16px; display: flex; align-items: center; gap: 10px;
      background: linear-gradient(180deg, ${CONFIG.panelBg2} 0%, ${CONFIG.panelBg} 100%);
      border-bottom: 1px solid rgba(255,255,255,.06); flex-shrink: 0;
    }
    .bfh-avatar {
      width: 36px; height: 36px; border-radius: 50%; background: #fff; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; overflow: hidden;
      font-weight: 800; font-size: 9px; line-height: 1; color: #111; text-align: center;
    }
    .bfh-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .bfh-head-txt b { font-size: 14px; display: block; }
    .bfh-head-txt span { font-size: 11.5px; color: #8a8a8e; }
    .bfh-head-txt .bfh-dot { color: ${CONFIG.accent}; }

    .bfh-msgs {
      flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 10px;
    }
    .bfh-msg {
      max-width: 82%; padding: 9px 12px; border-radius: 14px; font-size: 13.5px; line-height: 1.45;
      word-wrap: break-word; animation: bfh-pop .2s ease;
    }
    @keyframes bfh-pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .bfh-msg.bot { background: ${CONFIG.bubbleBot}; color: #f0f0f2; align-self: flex-start; border-bottom-left-radius: 4px; }
    .bfh-msg.user { background: ${CONFIG.bubbleUser}; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
    .bfh-typing { display: flex; gap: 4px; padding: 12px; align-self: flex-start; }
    .bfh-typing span { width: 7px; height: 7px; border-radius: 50%; background: #6c6c70; animation: bfh-blink 1.2s infinite; }
    .bfh-typing span:nth-child(2) { animation-delay: .2s; }
    .bfh-typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes bfh-blink { 0%,60%,100% { opacity: .3; } 30% { opacity: 1; } }

    .bfh-foot { flex-shrink: 0; border-top: 1px solid rgba(255,255,255,.06); padding: 12px 14px; }

    /* free-text composer */
    .bfh-compose { display: flex; gap: 8px; }
    .bfh-compose input {
      flex: 1; background: ${CONFIG.panelBg2}; color: #fff; border: 1px solid rgba(255,255,255,.10);
      border-radius: 20px; padding: 10px 14px; font-size: 14px; font-family: inherit;
    }
    .bfh-compose input:focus { outline: none; border-color: ${CONFIG.accent}; }
    .bfh-send {
      width: 38px; min-width: 38px; height: 38px; padding: 0; border-radius: 50%; border: none;
      background: ${CONFIG.accent}; color: #fff; cursor: pointer; flex-shrink: 0; flex-grow: 0;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 6px rgba(0,0,0,.25); transition: background .15s ease, transform .12s ease;
    }
    .bfh-send:hover { background: ${CONFIG.accentDark}; }
    .bfh-send:active { transform: scale(.92); }
    .bfh-send:disabled { opacity: .5; cursor: default; }
    .bfh-send svg { width: 17px; height: 17px; fill: #fff; display: block; margin-left: 1px; }

    /* mini form */
    .bfh-form { display: none; flex-direction: column; gap: 8px; }
    .bfh-form.bfh-show { display: flex; }
    .bfh-form input {
      width: 100%; background: ${CONFIG.panelBg2}; color: #fff; border: 1px solid rgba(255,255,255,.10);
      border-radius: 10px; padding: 10px 12px; font-size: 14px; font-family: inherit;
    }
    .bfh-form input:focus { outline: none; border-color: ${CONFIG.accent}; }
    .bfh-form input.bfh-err { border-color: #e25555; }
    .bfh-form button {
      background: ${CONFIG.accent}; color: #fff; border: none; border-radius: 10px; padding: 11px;
      font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
    }
    .bfh-form button:disabled { opacity: .55; cursor: default; }
    .bfh-consent { font-size: 10px; color: #76767a; line-height: 1.4; margin: 2px; }
    .bfh-consent a { color: #16B57A; text-decoration: underline; }
    .bfh-consent-row { display: flex; align-items: flex-start; gap: 8px; margin: 2px; cursor: pointer; }
    .bfh-consent-row input[type="checkbox"] {
      width: 15px; height: 15px; min-width: 15px; margin: 1px 0 0; padding: 0;
      accent-color: ${CONFIG.accent}; cursor: pointer;
    }
    .bfh-consent-row.bfh-err-box { outline: 1px solid #e25555; outline-offset: 3px; border-radius: 4px; }

    @media (max-width: 480px) {
      #bfh-root { bottom: 16px; ${side}: 16px; }
      #bfh-panel { width: calc(100vw - 32px); height: 70vh; }
      #bfh-peek { width: calc(100vw - 90px); }
    }
  `;

  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  const avatarInner = CONFIG.logoUrl ? '<img src="' + CONFIG.logoUrl + '" alt="">' : "TextCatch";

  const root = document.createElement("div");
  root.id = "bfh-root";
  root.innerHTML =
    '<div id="bfh-panel" role="dialog" aria-label="Chat with ' + CONFIG.businessName + '">' +
      '<div class="bfh-head">' +
        '<div class="bfh-avatar">' + avatarInner + '</div>' +
        '<div class="bfh-head-txt"><b>' + CONFIG.agentName + '</b><span><span class="bfh-dot">●</span> ' + CONFIG.businessName + '</span></div>' +
      '</div>' +
      '<div class="bfh-msgs" id="bfh-msgs"></div>' +
      '<div class="bfh-foot">' +
        '<div class="bfh-compose" id="bfh-compose">' +
          '<input id="bfh-input" type="text" placeholder="Type your message..." autocomplete="off">' +
          '<button class="bfh-send" id="bfh-send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg></button>' +
        '</div>' +
        '<div class="bfh-form" id="bfh-form">' +
          '<input id="bfh-name" type="text" placeholder="Your name" autocomplete="given-name">' +
          '<input id="bfh-phone" type="tel" placeholder="Phone number" autocomplete="tel">' +
          '<input id="bfh-email" type="email" placeholder="Email address" autocomplete="email">' +
          '<label class="bfh-consent-row" id="bfh-consent-row" for="bfh-sms-consent">' +
            '<input id="bfh-sms-consent" type="checkbox">' +
            '<span class="bfh-consent">I agree to receive SMS text messages from ' + CONFIG.businessName + ' at the number provided in response to my inquiry. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help. See our <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a> and <a href="/terms" target="_blank" rel="noopener">Terms</a>.</span>' +
          '</label>' +
          '<button id="bfh-submit" type="button">Send</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="bfh-peek"><button class="bfh-peek-close" aria-label="Dismiss">×</button><div class="bfh-peek-photo">' + avatarInner + '</div><span id="bfh-peek-text"></span></div>' +
    '<button id="bfh-launcher" aria-label="Open chat">' +
      '<span id="bfh-badge">1</span>' +
      '<svg id="bfh-icon-chat" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>' +
      '<svg id="bfh-icon-close" viewBox="0 0 24 24" style="display:none"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
    '</button>';
  document.body.appendChild(root);

  const launcher = root.querySelector("#bfh-launcher");
  const panel = root.querySelector("#bfh-panel");
  const peek = root.querySelector("#bfh-peek");
  const peekText = root.querySelector("#bfh-peek-text");
  const iconChat = root.querySelector("#bfh-icon-chat");
  const iconClose = root.querySelector("#bfh-icon-close");
  const msgs = root.querySelector("#bfh-msgs");
  const composeRow = root.querySelector("#bfh-compose");
  const input = root.querySelector("#bfh-input");
  const sendBtn = root.querySelector("#bfh-send");
  const form = root.querySelector("#bfh-form");
  const submitBtn = root.querySelector("#bfh-submit");

  peekText.textContent = CONFIG.peekMessage;

  // conversation state
  let firstQuestion = "";   // captured as "comment"
  let started = false;      // whether the convo has begun
  let dismissed = false;

  // capture the page the visitor is on the moment the widget loads
  // (so if they navigate mid-chat, we still know where they started)
  const startPage = (function () {
    const title = (document.title || "").split(/\s*[–—|]\s*/)[0].trim();
    const path = window.location.pathname + window.location.search;
    return {
      url: window.location.href,
      path: path,
      label: title || path || "Home"
    };
  })();

  function addMsg(text, who) {
    const el = document.createElement("div");
    el.className = "bfh-msg " + who;
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function showTyping() {
    const t = document.createElement("div");
    t.className = "bfh-typing";
    t.innerHTML = "<span></span><span></span><span></span>";
    msgs.appendChild(t);
    msgs.scrollTop = msgs.scrollHeight;
    return t;
  }

  function botSay(text, delay, cb) {
    const t = showTyping();
    setTimeout(function () {
      t.remove();
      addMsg(text, "bot");
      if (cb) cb();
    }, delay || 900);
  }

  function openPanel() {
    panel.classList.add("bfh-show");
    launcher.classList.add("bfh-open");
    launcher.classList.remove("bfh-has-msg");
    peek.classList.remove("bfh-show");
    iconChat.style.display = "none";
    iconClose.style.display = "block";
    if (!started) {
      started = true;
      botSay(CONFIG.peekMessage, 500, function () {
        setTimeout(function () { input.focus(); }, 100);
      });
    }
  }

  function closePanel() {
    panel.classList.remove("bfh-show");
    launcher.classList.remove("bfh-open");
    iconChat.style.display = "block";
    iconClose.style.display = "none";
  }

  function toggle() {
    if (panel.classList.contains("bfh-show")) closePanel();
    else openPanel();
  }

  launcher.addEventListener("click", toggle);
  peek.addEventListener("click", function (e) {
    if (e.target.classList.contains("bfh-peek-close")) {
      dismissed = true; peek.classList.remove("bfh-show"); return;
    }
    openPanel();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanel(); });

  // pop the peek bubble after delay
  setTimeout(function () {
    if (!dismissed && !panel.classList.contains("bfh-show")) {
      peek.classList.add("bfh-show");
      launcher.classList.add("bfh-has-msg");
    }
  }, CONFIG.popupDelay);

  // visitor sends their first message -> capture as comment, then ask for details
  function handleSend() {
    const txt = input.value.trim();
    if (!txt) return;
    addMsg(txt, "user");
    input.value = "";

    if (!firstQuestion) {
      firstQuestion = txt;
      // hide composer, ask for details, reveal form
      composeRow.style.display = "none";
      botSay(CONFIG.askDetails, 1000, function () {
        form.classList.add("bfh-show");
        setTimeout(function () { root.querySelector("#bfh-name").focus(); }, 100);
      });
    } else {
      // extra messages before they fill the form -> keep it warm
      firstQuestion += " | " + txt;
      botSay("Got it — noted! Just pop your details below and I'll be in touch.", 800);
    }
  }

  sendBtn.addEventListener("click", handleSend);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") handleSend(); });

  // phone normalize
  function normalizePhone(raw) {
    let d = (raw || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.length === 10) return "+" + CONFIG.defaultCountryCode + d;
    if (d.length === 11 && d[0] === CONFIG.defaultCountryCode) return "+" + d;
    return "+" + d;
  }

  // submit the lead
  submitBtn.addEventListener("click", async function () {
    const nameEl = root.querySelector("#bfh-name");
    const phoneEl = root.querySelector("#bfh-phone");
    const emailEl = root.querySelector("#bfh-email");
    const consentEl = root.querySelector("#bfh-sms-consent");
    const consentRow = root.querySelector("#bfh-consent-row");
    const name = nameEl.value.trim();
    const phoneRaw = phoneEl.value.trim();
    const email = emailEl.value.trim();

    let ok = true;
    [nameEl, phoneEl, emailEl].forEach(function (el) { el.classList.remove("bfh-err"); });
    consentRow.classList.remove("bfh-err-box");
    if (!name) { nameEl.classList.add("bfh-err"); ok = false; }
    const phone = normalizePhone(phoneRaw);
    if (phone.replace(/\D/g, "").length < 11) { phoneEl.classList.add("bfh-err"); ok = false; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { emailEl.classList.add("bfh-err"); ok = false; }
    // SMS consent must be an affirmative, deliberate opt-in (checkbox defaults to unchecked)
    if (!consentEl.checked) { consentRow.classList.add("bfh-err-box"); ok = false; }
    if (!ok) return;

    submitBtn.disabled = true; submitBtn.textContent = "Sending...";

    const payload = {
      firstName: name,
      phone: phone,
      phoneRaw: phoneRaw,
      email: email,
      comment: firstQuestion || "(no message)",
      pageLabel: startPage.label,
      pagePath: startPage.path,
      pageUrl: startPage.url,
      commentWithPage: (firstQuestion || "(no message)") + "  [page: " + startPage.label + " — " + startPage.url + "]",
      source: "website-chat-widget",
      smsConsent: true,
      smsConsentTimestamp: new Date().toISOString(),
      smsConsentText: "I agree to receive SMS text messages from " + CONFIG.businessName + " at the number provided in response to my inquiry. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.",
      submittedAt: new Date().toISOString()
    };

    try {
      const res = await fetch(CONFIG.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      form.classList.remove("bfh-show");
      addMsg(name + " • " + phoneRaw + " • " + email, "user");
      botSay(CONFIG.closing.replace("{name}", name), 900);
    } catch (err) {
      submitBtn.disabled = false; submitBtn.textContent = "Send";
      botSay("Hmm, something went wrong sending that. Mind trying again, or give us a call?", 600);
      console.error("TextCatch chat submit error:", err);
    }
  });
})();
