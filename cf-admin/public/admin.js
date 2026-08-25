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
    if (status === "declined") return "Declined";
    return "New";
  }

  function tagClass(status) {
    if (status === "in_progress") return "tag progress";
    if (status === "done") return "tag done";
    if (status === "declined") return "tag declined";
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

  const FORMAT_NOTES = {
    "Hair or beauty salon":
      "Cursor will build a salon: treatments, team, hair photos, and book — not a restaurant menu.",
    "Nail salon": "Cursor will build a nail studio: sets, fills, gallery, and book.",
    Barber: "Cursor will build a barber shop: cuts, fades, hours, and book or walk-in.",
    "Mechanic or panel beater":
      "Cursor will build a workshop: services, jobs, and quote or call — not a salon price list.",
    "Plumber, electrician or other trade":
      "Cursor will build a trades site: what they fix, where they work, and a quote.",
    "Restaurant, cafe or takeaway":
      "Cursor will build a food site: menu, hours, photos, and order or reserve.",
    "Medical, dental or physio":
      "Cursor will build a calm clinic: services, hours, and how to book.",
    "Gym or fitness": "Cursor will build a gym: classes, trainers, and how to join.",
    "Retail shop": "Cursor will build a shop: products and how to visit or buy.",
    "Professional services":
      "Cursor will build a professional site: what they do, who they help, then enquire.",
    "Cleaning or home services":
      "Cursor will build a cleaning site: packages, areas, and a quote.",
    "Events or photography":
      "Cursor will build a showcase: past work, packages, then enquire.",
    Other: "Cursor will follow the brief and still pick one coherent layout — not a generic salon.",
  };

  function syncFormatNote() {
    const type = document.getElementById("d-type").value;
    const note = document.getElementById("d-format-note");
    if (!type) {
      note.textContent = "";
      note.classList.add("hidden");
      return;
    }
    note.textContent =
      FORMAT_NOTES[type] ||
      "Cursor will follow this trade and the brief. Reshape the starter to match; do not keep a generic brochure if the work is different.";
    note.classList.remove("hidden");
  }

  function packageKind(brief, fields) {
    const raw = String((brief && brief.package) || (fields && fields.Package) || "");
    if (/advance|custom platform/i.test(raw)) return "Advance";
    if (/intermediate|booking/i.test(raw)) return "Intermediate";
    return "Entry";
  }

  function isEntryPackage(brief, fields) {
    return packageKind(brief, fields) === "Entry";
  }

  function syncActionOptions(entry, actionVal) {
    const select = document.getElementById("d-action");
    Array.prototype.forEach.call(select.options, function (opt) {
      const locked = entry && (opt.value === "Book" || opt.value === "Buy");
      opt.hidden = locked;
      opt.disabled = locked;
    });
    if (entry && (actionVal === "Book" || actionVal === "Buy")) return "";
    return actionVal;
  }

  function formatRand(amount) {
    const n = Math.round(Number(amount) || 0);
    return "R" + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function fillBill(brief, billing) {
    const kind = document.getElementById("d-bill-kind");
    const amount = document.getElementById("d-bill-amount");
    const send = document.getElementById("d-bill-send");
    const open = document.getElementById("d-bill-open");
    const msg = document.getElementById("d-bill-msg");
    const sent = document.getElementById("d-bill-sent");
    kind.value = "quote";
    send.disabled = false;
    send.textContent = "Send quote";
    open.classList.add("hidden");
    amount.value = brief.suggestedAmount > 0 ? String(brief.suggestedAmount) : "";
    clearNode(sent);
    const quotes = brief.quotes || [];
    sent.classList.toggle("hidden", !quotes.length);
    quotes.forEach(function (item) {
      const li = document.createElement("li");
      const label = item.kind === "invoice" ? "Invoice" : "Quote";
      const via = item.sentVia === "email" ? "emailed" : "opened in Gmail";
      li.textContent =
        label +
        " " +
        item.number +
        " · " +
        formatRand(item.amount) +
        (item.sentAt ? " · " + via + " " + when(item.sentAt) : "");
      sent.appendChild(li);
    });
    if (quotes[0]) {
      open.href = "/api/briefs/" + brief.id + "/quote/" + quotes[0].id;
      open.classList.remove("hidden");
    }
    if (!billing.bank) {
      msg.textContent =
        "Add your VibeIt bank details in Cloudflare first (account name, bank, account number). Then you can send a quote.";
      msg.classList.remove("hidden");
    } else if (!brief.email) {
      msg.textContent = "This brief has no client email, so a quote cannot be sent yet.";
      msg.classList.remove("hidden");
    } else {
      msg.classList.add("hidden");
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

  function setStatus(id, status) {
    return api("/api/briefs/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status }),
    }).then(function () {
      return loadList();
    });
  }

  function renderList(briefs) {
    list.innerHTML = "";
    empty.classList.toggle("hidden", Boolean(briefs.length));
    briefs.forEach(function (item) {
      const li = document.createElement("li");
      li.className = "item-wrap";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "item";
      btn.innerHTML = "<h2></h2><p></p><span></span>";
      btn.querySelector("h2").textContent = item.businessName || "New brief";
      btn.querySelector("p").textContent =
        (item.package || "Brief") + " · " + when(item.createdAt);
      const tag = btn.querySelector("span");
      tag.className = tagClass(item.status);
      tag.textContent = labelStatus(item.status);
      btn.addEventListener("click", function () {
        openBrief(item.id);
      });
      const actions = document.createElement("div");
      actions.className = "item-actions";
      function act(label, className, handler) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = className;
        b.textContent = label;
        b.addEventListener("click", function (event) {
          event.stopPropagation();
          handler();
        });
        actions.appendChild(b);
      }
      act("Accept", "btn btn-mini", function () {
        setStatus(item.id, "in_progress");
      });
      act("Decline", "btn btn-mini btn-ghost", function () {
        setStatus(item.id, "declined");
      });
      act("Delete", "btn btn-mini btn-danger", function () {
        if (!window.confirm("Delete " + (item.businessName || "this request") + "? This cannot be undone.")) {
          return;
        }
        api("/api/briefs/" + item.id, { method: "DELETE" }).then(function () {
          loadList();
        });
      });
      li.appendChild(btn);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  function loadList() {
    const query = filter ? "?status=" + encodeURIComponent(filter) : "";
    return api("/api/briefs" + query).then(function (body) {
      renderList(body.briefs || []);
    });
  }

  function normalizeHex(value) {
    const hex = String(value || "").trim();
    if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
      return (
        "#" +
        hex
          .slice(1)
          .split("")
          .map(function (ch) {
            return ch + ch;
          })
          .join("")
      ).toLowerCase();
    }
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
    return "";
  }

  function parseBrief(text) {
    const fields = {};
    const blocks = {};
    const colours = [];
    const names = {
      CONTACT: "contact",
      WEBSITE: "website",
      BUSINESS: "business",
      "WHAT THEY DO": "do",
      "WHAT THEY NEED": "do",
      "PRODUCTS OR SERVICES": "products",
      "ITEMS FOR SALE": "shop",
      NOTES: "notes",
      BOOKINGS: "bookings",
      HOURS: "hours",
      "ADMIN AND PAYMENTS": "admin",
    };
    const prose = { do: 1, products: 1, shop: 1, notes: 1, bookings: 1, hours: 1 };
    let current = "";
    String(text || "")
      .split(/\r?\n/)
      .forEach(function (raw) {
        const line = raw.trim();
        if (!line) return;
        if (names[line]) {
          current = names[line];
          if (!blocks[current]) blocks[current] = [];
          return;
        }
        if (/^FILES\b/.test(line)) {
          current = "";
          return;
        }
        const pair = line.match(/^([^:]{1,40}):\s*(.+)$/);
        if (pair && !prose[current]) {
          const key = pair[1].trim();
          const value = pair[2].trim();
          fields[key] = value;
          if (/^colou?rs$/i.test(key)) {
            String(value).replace(/#[0-9a-fA-F]{3,8}/g, function (hit) {
              const hex = normalizeHex(hit);
              if (hex && colours.indexOf(hex) === -1) colours.push(hex);
            });
          }
          return;
        }
        if (current) {
          if (!blocks[current]) blocks[current] = [];
          blocks[current].push(line);
        }
      });
    return { fields: fields, blocks: blocks, colours: colours };
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function showPanel(id, on) {
    document.getElementById(id).hidden = !on;
  }

  function addField(list, label, value, href) {
    if (!value) return;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (href) {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = value;
      if (href.indexOf("http") === 0) {
        link.target = "_blank";
        link.rel = "noopener";
      }
      dd.appendChild(link);
    } else {
      dd.textContent = value;
    }
    list.appendChild(dt);
    list.appendChild(dd);
  }

  function domainHref(value) {
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (/\./.test(value) && value.indexOf(" ") === -1) return "https://" + value.replace(/^\/+/, "");
    return "";
  }

  function fillCopy(id, lines) {
    const text = (lines || []).join("\n").trim();
    document.getElementById(id).textContent = text;
    return Boolean(text);
  }

  function openBrief(id) {
    currentId = id;
    return api("/api/briefs/" + id).then(function (body) {
      const brief = body.brief;
      const parsed = parseBrief(brief.briefText || "");
      const fields = parsed.fields;
      const blocks = parsed.blocks;
      const colours = parsed.colours.slice(0, 3);

      document.getElementById("d-package").textContent = brief.package || fields.Package || "Brief";
      document.getElementById("d-name").textContent = brief.businessName || fields.Name || "New client";
      document.getElementById("d-meta").textContent = when(brief.createdAt);
      const email = brief.email || fields.Email || "";
      const phone = brief.phone || fields.Phone || "";
      const whatsapp = fields.WhatsApp || "";
      const typeVal = fields.Type || "";
      const actionVal =
        fields["Customer action"] ||
        (whatsapp ? "WhatsApp" : "") ||
        (phone ? "Call" : "");
      const sellsVal = fields["Sells products"] || "";
      const facts = document.getElementById("d-facts");
      clearNode(facts);
      [typeVal, actionVal, sellsVal ? "Sells items: " + sellsVal : "", packageKind(brief, fields) === "Advance" ? "Advance enquiry" : ""].filter(Boolean).forEach(function (text) {
        const pill = document.createElement("span");
        pill.className = "fact";
        pill.textContent = text;
        facts.appendChild(pill);
      });
      const typeSelect = document.getElementById("d-type");
      const actionSelect = document.getElementById("d-action");
      typeSelect.value = typeVal;
      if (typeVal && typeSelect.value !== typeVal) {
        const opt = document.createElement("option");
        opt.value = typeVal;
        opt.textContent = typeVal;
        typeSelect.appendChild(opt);
        typeSelect.value = typeVal;
      }
      actionSelect.value = syncActionOptions(isEntryPackage(brief, fields), actionVal);
      const cursorLink = document.getElementById("d-cursor-link");
      const buildBtn = document.getElementById("d-build");
      const buildMsg = document.getElementById("d-build-msg");
      const buildRow = document.getElementById("d-build-row");
      const formatNote = document.getElementById("d-format-note");
      buildMsg.classList.add("hidden");
      const advance = packageKind(brief, fields) === "Advance";
      if (buildRow) buildRow.classList.toggle("hidden", advance);
      if (advance) {
        formatNote.textContent =
          "This is an Advance enquiry. WhatsApp them or send a quote — do not start a standard website.";
        formatNote.classList.remove("hidden");
        cursorLink.classList.add("hidden");
      } else if (brief.cursorUrl) {
        cursorLink.href = brief.cursorUrl;
        cursorLink.classList.remove("hidden");
        buildBtn.textContent = "Started";
        buildBtn.disabled = true;
        syncFormatNote();
      } else {
        cursorLink.classList.add("hidden");
        buildBtn.textContent = "Start website";
        buildBtn.disabled = false;
        syncFormatNote();
      }
      document.getElementById("d-status").textContent = labelStatus(brief.status);
      document.querySelectorAll(".status-row .chip").forEach(function (chip) {
        chip.classList.toggle("on", chip.getAttribute("data-set") === brief.status);
      });

      fillBill(brief, body.billing || {});

      const links = document.getElementById("d-links");
      clearNode(links);
      if (email) {
        const mail = document.createElement("a");
        mail.href = "mailto:" + email;
        mail.textContent = "Email client";
        links.appendChild(mail);
      }
      if (phone) {
        const call = document.createElement("a");
        call.className = "ghost";
        call.href = "tel:" + phone.replace(/\s+/g, "");
        call.textContent = "Call";
        links.appendChild(call);
      }
      if (whatsapp) {
        const wa = document.createElement("a");
        wa.className = "ghost";
        wa.href = "https://wa.me/" + whatsapp.replace(/\D/g, "");
        wa.target = "_blank";
        wa.rel = "noopener";
        wa.textContent = "WhatsApp";
        links.appendChild(wa);
      }

      const palette = document.getElementById("d-palette");
      clearNode(palette);
      if (colours.length) {
        colours.forEach(function (hex, i) {
          const swatch = document.createElement("div");
          swatch.className = "swatch";
          const chip = document.createElement("span");
          chip.className = "swatch-chip";
          chip.style.background = hex;
          const meta = document.createElement("span");
          meta.className = "swatch-meta";
          const code = document.createElement("code");
          code.textContent = hex;
          const label = document.createElement("small");
          label.textContent = ["Primary", "Secondary", "Accent"][i] || "Colour " + (i + 1);
          meta.appendChild(code);
          meta.appendChild(label);
          swatch.appendChild(chip);
          swatch.appendChild(meta);
          palette.appendChild(swatch);
        });
        palette.hidden = false;
      } else {
        palette.hidden = true;
      }

      const contactList = document.getElementById("d-contact-fields");
      clearNode(contactList);
      addField(contactList, "Name", fields.Name || brief.businessName);
      addField(contactList, "Registration", fields.Registration);
      addField(contactList, "Address", fields.Address);
      addField(contactList, "Phone", phone, phone ? "tel:" + phone.replace(/\s+/g, "") : "");
      addField(contactList, "WhatsApp", whatsapp);
      addField(contactList, "Email", email, email ? "mailto:" + email : "");
      addField(contactList, "Agreed to terms", fields["Agreed to terms"]);
      showPanel("d-contact-panel", contactList.childNodes.length > 0);

      const webList = document.getElementById("d-web-fields");
      clearNode(webList);
      addField(webList, "Domain", fields.Domain);
      addField(
        webList,
        "Domain name",
        fields["Domain name"],
        domainHref(fields["Domain name"])
      );
      showPanel("d-web-panel", webList.childNodes.length > 0);

      const doTitle = document.querySelector("#d-do-panel h2");
      if (doTitle) doTitle.textContent = advance ? "What they need" : "What they do";
      showPanel("d-do-panel", fillCopy("d-do", blocks.do));
      showPanel("d-products-panel", fillCopy("d-products", blocks.products));
      showPanel("d-shop-panel", fillCopy("d-shop", blocks.shop));
      showPanel("d-book-panel", fillCopy("d-book", blocks.bookings));
      showPanel("d-hours-panel", fillCopy("d-hours", blocks.hours));
      showPanel("d-notes-panel", fillCopy("d-notes", blocks.notes));

      const adminList = document.getElementById("d-admin-fields");
      clearNode(adminList);
      addField(adminList, "Booking admin", fields["Booking admin"]);
      addField(adminList, "Payments", fields.Payments);
      addField(adminList, "Bank account name", fields["Bank account name"]);
      addField(adminList, "Bank", fields.Bank);
      addField(adminList, "Account number", fields["Account number"]);
      addField(adminList, "Branch code", fields["Branch code"]);
      addField(adminList, "Pay link", fields["Pay link"], domainHref(fields["Pay link"]));
      addField(adminList, "Google", fields.Google);
      addField(
        adminList,
        "Google profile",
        fields["Google profile"],
        domainHref(fields["Google profile"])
      );
      showPanel("d-admin-panel", adminList.childNodes.length > 0);

      const files = document.getElementById("d-files");
      clearNode(files);
      document.getElementById("d-files-title").textContent =
        "Files" + (brief.files && brief.files.length ? " (" + brief.files.length + ")" : "");
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

  document.getElementById("d-type").addEventListener("change", syncFormatNote);

  document.getElementById("d-build").addEventListener("click", function () {
    const type = document.getElementById("d-type").value;
    const action = document.getElementById("d-action").value;
    const msg = document.getElementById("d-build-msg");
    const btn = document.getElementById("d-build");
    if (!type || !action) {
      msg.textContent = "Pick the site format and what customers should do, then start.";
      msg.classList.remove("hidden");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Starting…";
    msg.classList.add("hidden");
    api("/api/briefs/" + currentId + "/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: type, action: action }),
    })
      .then(function (body) {
        const link = document.getElementById("d-cursor-link");
        if (body.cursorUrl) {
          link.href = body.cursorUrl;
          link.classList.remove("hidden");
        }
        btn.textContent = "Started";
        msg.textContent = body.repoUrl
          ? "Repo and Cursor agent are up. Open in Cursor to review the draft."
          : "Cursor agent started.";
        msg.classList.remove("hidden");
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Start website";
        const raw = err.message || "Could not start the website.";
        msg.textContent = /resource_exhausted/i.test(raw)
          ? "Cursor Cloud Agents are out of usage. Open cursor.com/dashboard/spending, raise or wait for the limit, then hit Start website again. The GitHub repo is already created."
          : raw;
        msg.classList.remove("hidden");
      });
  });

  document.getElementById("d-bill-kind").addEventListener("change", function () {
    const kind = document.getElementById("d-bill-kind").value;
    document.getElementById("d-bill-send").textContent = kind === "invoice" ? "Send invoice" : "Send quote";
  });

  document.getElementById("d-bill-send").addEventListener("click", function () {
    const kind = document.getElementById("d-bill-kind").value;
    const amount = Number(document.getElementById("d-bill-amount").value);
    const msg = document.getElementById("d-bill-msg");
    const btn = document.getElementById("d-bill-send");
    if (!amount || amount < 1) {
      msg.textContent = "Enter the amount in rand.";
      msg.classList.remove("hidden");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Sending…";
    msg.classList.add("hidden");
    api("/api/briefs/" + currentId + "/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: kind, amount: amount }),
    })
      .then(function (body) {
        if (body.mailto && !body.sent) window.location.href = body.mailto;
        return openBrief(currentId).then(function () {
          const note = document.getElementById("d-bill-msg");
          const link = document.getElementById("d-bill-open");
          document.getElementById("d-bill-send").disabled = false;
          document.getElementById("d-bill-send").textContent =
            kind === "invoice" ? "Send invoice" : "Send quote";
          if (body.printUrl) {
            link.href = body.printUrl;
            link.classList.remove("hidden");
          }
          if (body.sent) {
            note.textContent =
              (kind === "invoice" ? "Invoice " : "Quote ") +
              body.quote.number +
              " emailed to the client. A copy went to support@vibeit-intel.net.";
          } else {
            note.textContent =
              (body.mailError ? body.mailError + " " : "") +
              "Gmail should open with the " +
              (kind === "invoice" ? "invoice" : "quote") +
              " and your bank details. Open if you want a print/PDF copy.";
          }
          note.classList.remove("hidden");
        });
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = kind === "invoice" ? "Send invoice" : "Send quote";
        msg.textContent = err.message || "Could not send.";
        msg.classList.remove("hidden");
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