(function (global) {
  function setFiles(fileInput, files) {
    const data = new DataTransfer();
    files.forEach(function (file) {
      data.items.add(file);
    });
    fileInput.files = data.files;
  }

  function fileKey(file) {
    return [file.name, file.size, file.lastModified].join(":");
  }

  function mergeFiles(current, incoming, max) {
    const seen = {};
    const out = [];
    current.concat(incoming).forEach(function (file) {
      const key = fileKey(file);
      if (seen[key]) return;
      seen[key] = true;
      out.push(file);
    });
    return out.slice(0, max);
  }

  function bind(fileInput, options) {
    const max = options.max || (fileInput.multiple ? 10 : 1);
    const nouns = options.nouns || (max > 1 ? "files" : "file");
    const previews = options.previews;
    let current = Array.from(fileInput.files || []);
    const urls = [];

    function revoke() {
      urls.forEach(function (url) {
        URL.revokeObjectURL(url);
      });
      urls.length = 0;
    }

    function labelText() {
      const label = fileInput.parentElement.querySelector(".brief-pick-label");
      if (!label) return;
      if (!current.length) {
        label.textContent = max > 1 ? "Choose files" : "Choose file";
        return;
      }
      if (max === 1) {
        label.textContent = "Change";
        return;
      }
      label.textContent =
        current.length +
        " of " +
        max +
        " " +
        nouns +
        (current.length >= max ? "" : " · add more");
    }

    function render() {
      labelText();
      if (!previews) return;
      revoke();
      previews.innerHTML = "";
      if (!current.length) {
        previews.hidden = true;
        return;
      }
      previews.hidden = false;
      current.forEach(function (file, index) {
        const item = document.createElement("div");
        item.className = "brief-preview";
        item.setAttribute("role", "listitem");

        const isImage = file.type && file.type.indexOf("image/") === 0;
        if (isImage) {
          const img = document.createElement("img");
          const url = URL.createObjectURL(file);
          urls.push(url);
          img.src = url;
          img.alt = file.name;
          item.appendChild(img);
        } else {
          const fallback = document.createElement("span");
          fallback.className = "brief-preview-fallback";
          const ext = (file.name.split(".").pop() || "FILE").toUpperCase();
          fallback.textContent = ext.slice(0, 4);
          item.appendChild(fallback);
        }

        const name = document.createElement("span");
        name.className = "brief-preview-name";
        name.textContent = file.name;
        item.appendChild(name);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "brief-preview-remove";
        remove.setAttribute("aria-label", "Remove " + file.name);
        remove.textContent = "×";
        remove.addEventListener("click", function () {
          current.splice(index, 1);
          setFiles(fileInput, current);
          render();
        });
        item.appendChild(remove);
        previews.appendChild(item);
      });
    }

    fileInput.addEventListener("change", function () {
      const incoming = Array.from(fileInput.files || []);
      current = max === 1 ? incoming.slice(0, 1) : mergeFiles(current, incoming, max);
      setFiles(fileInput, current);
      render();
    });

    render();
  }

  global.VibeBriefFiles = {
    setFiles: setFiles,
    bind: bind,
    storeBrief: function (formEl) {
      const endpoint =
        (formEl && formEl.getAttribute("data-store")) ||
        "https://vibeit-admin.vibeit-intel.workers.dev/api/briefs";
      const data = new FormData(formEl);
      const ctrl = new AbortController();
      const timer = setTimeout(function () {
        ctrl.abort();
      }, 20000);
      return fetch(endpoint, {
        method: "POST",
        body: data,
        signal: ctrl.signal,
      })
        .then(function (res) {
          if (!res.ok) throw new Error("store failed");
        })
        .finally(function () {
          clearTimeout(timer);
        });
    },
  };
})(window);
