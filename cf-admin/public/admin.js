(function () {
  const login = document.getElementById("login");
  const app = document.getElementById("app");
  const detail = document.getElementById("detail");
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");
  const who = document.getElementById("who");
  const loginMsg = document.getElementById("login-msg");
  const google = document.getElementById("google");
  const passwordForm = document.getElementById("password-form");
  const setup = document.getElementById("setup");
  let filter = "";
  let currentId = "";

  function show(el) {
    login.classList.add("hidden");
    app.classList.add("hidden");
    detail.classList.add("hidden");
    el.classList.remove("hidden");
  }

  function api(path, options) {
    return fetch(path, Object.assign({ credentials: "same-origin" }, options || {})).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body.error || "Request failed");
        return body;
      });
    });
  }

  function labelStatus(status) {
    if (status === "in_progress") return "In progress";
    if (status === "done") return "Done";
    return "New";
  }

  function tagClass(status) {
    if (status === "in_progress") return "tag progress";
    if (status === "done") return "tag done";
    return "tag";
  }

  function when(iso) {
    try {
      return new Date(iso).toLocaleString("en-ZA", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch (err) {
      return iso;
    }
  }

  function hashLogin() {
    if (location.hash === "#login-denied") {
      loginMsg.textContent = "That Google account is not allowed. Use support@vibeit-intel.net.";
      loginMsg.classList.remove("hidden");
    } else if (location.hash === "#login-error") {
      loginMsg.textContent = "Google sign-in did not finish. Try again.";
      loginMsg.classList.remove("hidden");
    }
  }

  function renderList(briefs) {
    list.innerHTML = "";
    empty.classList.toggle("hidden", Boolean(briefs.length));
    briefs.forEach(function (item) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "item";
      btn.innerHTML =
        "<h2></h2><p></p><span></span>";
      btn.querySelector("h2").textContent = item.businessName || "New brief";
      btn.querySelector("p").textContent =
        (item.package || "Brief") + " · " + when(item.createdAt);
      const tag = btn.querySelector("span");
      tag.className = tagClass(item.status);
      tag.textContent = labelStatus(item.status);
      btn.addEventListener("click", function () {
        openBrief(item.id);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function loadList() {
    const query = filter ? "?status=" + encodeURIComponent(filter) : "";
    return api("/api/briefs" + query).then(function (body) {
      renderList(body.briefs || []);
    });
  }

  function openBrief(id) {
    currentId = id;
    return api("/api/briefs/" + id).then(function (body) {
      const brief = body.brief;
      document.getElementById("d-package").textContent = brief.package || "Brief";
      document.getElementById("d-name").textContent = brief.businessName || "New client";
      document.getElementById("d-meta").textContent = when(brief.createdAt);
      document.getElementById("d-status").textContent = labelStatus(brief.status);
      const contact = [];
      if (brief.email) contact.push(brief.email);
      if (brief.phone) contact.push(brief.phone);
      const contactEl = document.getElementById("d-contact");
      contactEl.innerHTML = "";
      if (brief.email) {
        const mail = document.createElement("a");
        mail.href = "mailto:" + brief.email;
        mail.textContent = brief.email;
        mail.style.color = "#00c8c9";
        contactEl.appendChild(mail);
      }
      if (brief.phone) {
        contactEl.appendChild(document.createTextNode((brief.email ? " · " : "") + brief.phone));
      }
      document.getElementById("d-brief").textContent = brief.briefText || "";
      document.querySelectorAll(".status-row .chip").forEach(function (chip) {
        chip.classList.toggle("on", chip.getAttribute("data-set") === brief.status);
      });
      const files = document.getElementById("d-files");
      files.innerHTML = "";
      (brief.files || []).forEach(function (file, index) {
        const link = document.createElement("a");
        link.className = "file";
        link.href = "/api/briefs/" + id + "/file/" + index;
        link.target = "_blank";
        link.rel = "noopener";
        if (file.type && file.type.indexOf("image/") === 0) {
          const img = document.createElement("img");
          img.src = link.href;
          img.alt = file.label || file.name || "File";
          link.appendChild(img);
        } else {
          const fallback = document.createElement("div");
          fallback.className = "fallback";
          fallback.textContent = (file.label || "FILE").slice(0, 12);
          link.appendChild(fallback);
        }
        const cap = document.createElement("span");
        cap.textContent = file.label || file.name || "File";
        link.appendChild(cap);
        files.appendChild(link);
      });
      show(detail);
    });
  }

  document.querySelectorAll(".filters .chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      filter = chip.getAttribute("data-status") || "";
      document.querySelectorAll(".filters .chip").forEach(function (item) {
        item.classList.toggle("on", item === chip);
      });
      loadList();
    });
  });

  document.querySelectorAll(".status-row .chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      const status = chip.getAttribute("data-set");
      api("/api/briefs/" + currentId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: status }),
      }).then(function () {
        openBrief(currentId);
      });
    });
  });

  document.getElementById("back").addEventListener("click", function () {
    show(app);
    loadList();
  });

  document.getElementById("out").addEventListener("click", function () {
    api("/auth/logout", { method: "POST" }).then(function () {
      location.reload();
    });
  });

  passwordForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const data = new FormData(passwordForm);
    api("/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(data.get("email") || ""),
        password: String(data.get("password") || ""),
      }),
    })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        loginMsg.textContent = err.message;
        loginMsg.classList.remove("hidden");
      });
  });

  hashLogin();

  Promise.all([api("/api/me"), api("/api/auth-options")])
    .then(function (results) {
      const me = results[0];
      const options = results[1];
      if (me.email) {
        who.textContent = me.email;
        show(app);
        return loadList();
      }
      google.classList.toggle("hidden", !options.google);
      passwordForm.classList.toggle("hidden", !options.password);
      setup.classList.toggle("hidden", options.google || options.password);
      show(login);
    })
    .catch(function () {
      setup.classList.remove("hidden");
      show(login);
    });
})();