document.addEventListener("DOMContentLoaded", () => {
  // ===== Theme handling (NEW) =========================================
  const THEME_KEY = "aihearing-theme";
  const themeToggle = document.getElementById("theme-toggle");

  function getSystemTheme() {
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  function getInitialTheme() {
    return localStorage.getItem(THEME_KEY) || getSystemTheme();
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    // switch icon
    const icon = themeToggle?.querySelector("i");
    if (icon) {
      icon.className =
        theme === "light" ? "bi bi-moon-stars" : "bi bi-brightness-high";
    }
    themeToggle?.setAttribute(
      "aria-pressed",
      theme === "light" ? "true" : "false"
    );
    themeToggle?.setAttribute(
      "title",
      theme === "light" ? "Switch to dark" : "Switch to light"
    );
  }
  function toggleTheme() {
    const current =
      document.documentElement.getAttribute("data-theme") || getInitialTheme();
    applyTheme(current === "light" ? "dark" : "light");
  }

  applyTheme(getInitialTheme());
  themeToggle?.addEventListener("click", toggleTheme);

  /* =========================
     State
  ==========================*/
  let userData = { email: null, id: null };
  let patternId = null;

  /* =========================
     Webhooks
     (① リセット: チャット再開フローの start 側のみ)
  ==========================*/
  const mainWebhookUrl =
    "https://norimax.app.n8n.cloud/webhook-test/e-bridge-interview-main"; // ←そのまま（依頼はstartのみ）
  const historyCheckWebhookUrl =
    "https://norimax.app.n8n.cloud/webhook/e-bridge-interview-start"; // ← 変更前: .../webhook-test/... → 変更後: .../webhook/...

  /* =========================
     DOM
  ==========================*/
  const pages = {
    welcome: document.getElementById("welcome-page"),
    survey: document.getElementById("survey-page"),
    chat: document.getElementById("chat-page"),
  };
  const startBtn = document.getElementById("start-btn");
  const chatBox = document.getElementById("chat-box");
  const chatFormContainer = document.getElementById("chat-form-container");
  const surveyForm = document.getElementById("survey-form");

  /* =========================
     App Init
  ==========================*/
  function initializeApp() {
    const urlParams = new URLSearchParams(window.location.search);
    userData.email = urlParams.get("email");
    userData.id = urlParams.get("id");
    console.log("[INIT] Data pengguna dari URL:", userData);

    startBtn?.addEventListener("click", handleStartClick);

    if (surveyForm) {
      surveyForm.addEventListener("submit", handleSurveySubmit);
      const q1Radios = surveyForm.querySelectorAll('input[name="location"]');
      q1Radios.forEach((radio) =>
        radio.addEventListener("change", handleLocationChange)
      );
    }

    attachChatListeners();
    showPage("welcome");
  }

  function attachChatListeners() {
    const form = document.getElementById("chat-form");
    if (form) form.addEventListener("submit", handleChatSubmit);

    const micBtn = document.getElementById("mic-btn");
    if (micBtn && speech) {
      micBtn.addEventListener("click", toggleSpeechRecognition);
    } else if (micBtn && !speech) {
      micBtn.style.display = "none";
    }
  }

  /* =========================
     Start (Resume flow with history check)
  ==========================*/
  async function handleStartClick() {
    startBtn.disabled = true;
    startBtn.textContent = "確認中...";

    if (!userData.id || !userData.email) {
      alert("Authentication Error: ID dan Email pengguna wajib ada.");
      startBtn.disabled = false;
      startBtn.textContent = "スタート";
      return;
    }

    try {
      const response = await fetch(historyCheckWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userData),
      });

      if (!response.ok) throw new Error("Gagal menghubungi start webhook.");

      const data = await response.json();

      if (data.historyFound) {
        console.log("[AUTH] Riwayat ditemukan. Melewatkan survei.");
        patternId = data.patternId;
        displayChatHistory(data.history);
        showPage("chat");
        showTriggerButton();
      } else {
        console.log("[AUTH] Riwayat tidak ditemukan. Lanjut ke survei。");
        showPage("survey");
      }
    } catch (err) {
      console.error("[AUTH] Error saat memeriksa riwayat:", err);
      alert("Gagal memeriksa riwayat percakapan。後でもう一度お試しください。");
      startBtn.disabled = false;
      startBtn.textContent = "スタート";
    }
  }

  function displayChatHistory(history = []) {
    chatBox.innerHTML = "";
    history.forEach((item) => {
      const role = item.role === "system" || item.role === "ai" ? "ai" : "user";
      addMessage(item.message, role, item.timestamp);
    });
  }

  function showTriggerButton() {
    chatFormContainer.innerHTML =
      '<button id="trigger-btn" class="trigger-button" aria-label="Resume chat">再開する</button>';
    document
      .getElementById("trigger-btn")
      .addEventListener("click", handleTriggerClick);
  }

  function showChatForm() {
    chatFormContainer.innerHTML = `
      <form id="chat-form" class="chat-form" autocomplete="off">
        <button type="button" id="mic-btn" class="icon-btn" aria-label="Start voice input">
          <i class="bi bi-mic-fill"></i>
        </button>
        <input type="text" id="user-input" placeholder="メッセージを入力…" />
        <button type="submit" id="send-btn" class="icon-btn" aria-label="Send">
          <i class="bi bi-send-fill"></i>
        </button>
      </form>`;
    attachChatListeners();
  }

  async function handleTriggerClick() {
    const triggerBtn = document.getElementById("trigger-btn");
    triggerBtn.disabled = true;
    triggerBtn.textContent = "AIの応答を待っています...";
    await submitMessage("再開する");
    showChatForm();
  }

  async function handleChatSubmit(event) {
    event.preventDefault();
    const userInputEl = document.getElementById("user-input");
    const userText = userInputEl.value.trim();
    if (userText === "") return;
    userInputEl.value = "";
    await submitMessage(userText);
  }

  /* =========================
     Send & Receive
     (② JSON 返信形式の変更に対応)
  ==========================*/
  async function submitMessage(text, isInitial = false) {
    if (!isInitial) addMessage(text, "user");
    setTyping(true);

    const payload = {
      message: text,
      isInitialMessage: isInitial,
      email: userData.email,
      userId: userData.id,
      patternId: patternId,
    };

    try {
      const response = await fetch(mainWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      setTyping(false);
      await processN8nResponse(response, isInitial);
    } catch (error) {
      console.error("[CHAT] Gagal mendapatkan balasan:", error);
      setTyping(false);
      addMessage(
        "申し訳ありませんが、AIへの接続中にエラーが発生しました。後でもう一度お試しください。",
        "ai"
      );
    }
  }

  async function processN8nResponse(response, isInitial) {
    if (isInitial) {
      const defaultMessage = document.getElementById("default-system-message");
      if (defaultMessage) defaultMessage.remove();
    }

    const data = await response.json();
    console.log("[FETCH] Response JSON:", data);

    // 受け取りフォーマットの互換処理：
    // Case A: { messages: ["...", "..."] }
    // Case B: [ { messages: ["...", "..."] } ]
    // Fallback: reply1/reply2/reply3（後方互換）
    let messages = [];

    if (
      Array.isArray(data) &&
      data.length > 0 &&
      Array.isArray(data[0].messages)
    ) {
      messages = data[0].messages;
    } else if (Array.isArray(data?.messages)) {
      messages = data.messages;
    } else {
      // Fallback to old format
      const legacy = [data.reply1, data.reply2, data.reply3].filter(Boolean);
      messages = legacy;
    }

    // 最大3つまで表示
    messages.slice(0, 3).forEach(async (msg, idx) => {
      await new Promise((r) => setTimeout(r, 400 + idx * 200));
      addMessage(String(msg), "ai");
    });
  }

  /* =========================
     Survey
  ==========================*/
  function handleLocationChange(event) {
    const q2Container = document.getElementById("question2");
    const q2Title = document.getElementById("question2-title");
    const q2Options = {
      japan: document.getElementById("options-japan"),
      indonesia: document.getElementById("options-indonesia"),
    };

    const location = event.target.value;
    q2Container.classList.remove("hidden");
    if (location === "jepang") {
      q2Title.textContent = "2. 日本では何をしていますか？";
      q2Options.japan.classList.remove("hidden");
      q2Options.indonesia.classList.add("hidden");
    } else if (location === "indonesia") {
      q2Title.textContent = "2. 今あなたのステータスは何ですか？";
      q2Options.indonesia.classList.remove("hidden");
      q2Options.japan.classList.add("hidden");
    }
    document
      .querySelectorAll('input[name="status"]')
      .forEach((r) => (r.checked = false));
  }

  async function handleSurveySubmit(event) {
    event.preventDefault();
    patternId = getPatternId(
      surveyForm.location.value,
      surveyForm.status.value
    );
    console.log(`[SURVEY] Pattern ID: ${patternId}`);
    showPage("chat");

    addMessage(
      "現在、ユーザーの情報を初期化しています。少々お待ちください。",
      "ai",
      null,
      "default-system-message"
    );
    await submitMessage("", true);
  }

  function getPatternId(location, status) {
    if (status === "lainnya") return 9;
    if (location === "jepang") {
      if (status === "ginou_jisshu") return 1;
      if (status === "tokutei_ginou") return 2;
      if (status === "ryugaku_intern") return 3;
    } else if (location === "indonesia") {
      if (status === "moto_ginou_jisshu") return 4;
      if (status === "belum_pernah_kerja_jp") return 5;
      if (status === "moto_ryugaku_intern") return 6;
      if (status === "moto_tokutei_ginou") return 7;
      if (status === "berhenti_magang") return 8;
    }
    return 9;
  }

  /* =========================
     Chat UI helpers
  ==========================*/
  function showPage(pageName) {
    Object.values(pages).forEach((p) => p.classList.add("hidden"));
    pages[pageName].classList.remove("hidden");
  }

  function addMessage(text, sender, timestampStr = null, customId = null) {
    const wrapper = document.createElement("div");
    const role =
      sender === "ai" && text.includes("初期化しています") ? "system" : sender;
    wrapper.className = `message-wrapper ${role}`;
    if (customId) wrapper.id = customId;

    const bubble = document.createElement("div");
    bubble.className = "message";
    bubble.textContent = text;
    wrapper.appendChild(bubble);

    if (timestampStr) {
      const t = document.createElement("div");
      t.className = "timestamp";
      const date = new Date(timestampStr);
      t.textContent = date.toLocaleString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      });
      wrapper.appendChild(t);
    }

    chatBox.appendChild(wrapper);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function setTyping(isTyping) {
    let indicator = document.getElementById("typing-indicator");
    if (isTyping && !indicator) {
      indicator = document.createElement("div");
      indicator.id = "typing-indicator";
      indicator.className = "typing-indicator";
      indicator.innerHTML = "<span></span><span></span><span></span>";
      chatBox.appendChild(indicator);
      chatBox.scrollTop = chatBox.scrollHeight;
    } else if (!isTyping && indicator) {
      indicator.remove();
    }
  }

  /* =========================
     Speech Recognition
  ==========================*/
  var recognizing = false;
  var speech = (() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    return SR ? new SR() : null;
  })();

  function toggleSpeechRecognition() {
    if (!speech) return;
    recognizing ? speech.stop() : speech.start();
  }

  if (speech) {
    speech.lang = "ja-JP";
    speech.continuous = false;
    speech.interimResults = true;

    speech.onstart = () => {
      recognizing = true;
      const micBtn = document.getElementById("mic-btn");
      const userInput = document.getElementById("user-input");
      micBtn?.classList.add("listening");
      if (userInput) userInput.placeholder = "Mendengarkan...";
    };
    speech.onend = () => {
      recognizing = false;
      const micBtn = document.getElementById("mic-btn");
      const userInput = document.getElementById("user-input");
      micBtn?.classList.remove("listening");
      if (userInput) userInput.placeholder = "メッセージを入力…";
    };
    speech.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
    };
    speech.onresult = (event) => {
      const userInput = document.getElementById("user-input");
      if (!userInput) return;

      let interim_transcript = "";
      let final_transcript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final_transcript += event.results[i][0].transcript;
        } else {
          interim_transcript += event.results[i][0].transcript;
        }
      }
      userInput.value = final_transcript;
      if (interim_transcript) userInput.placeholder = interim_transcript;
    };
  }

  /* =========================
     Boot
  ==========================*/
  initializeApp();
});
