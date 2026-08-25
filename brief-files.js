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
          notify();
        });
        item.appendChild(remove);
        previews.appendChild(item);
      });
    }

    function notify() {
      if (typeof options.onChange === "function") options.onChange(current.slice());
    }

    fileInput.addEventListener("change", function () {
      const incoming = Array.from(fileInput.files || []);
      current = max === 1 ? incoming.slice(0, 1) : mergeFiles(current, incoming, max);
      setFiles(fileInput, current);
      render();
      notify();
    });

    render();
  }

  function toHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map(function (n) {
          return ("0" + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2);
        })
        .join("")
    );
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / d + 2) * 60;
      else h = ((r - g) / d + 4) * 60;
    }
    return { h: h, s: s, l: l };
  }

  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = ((h % 360) + 360) % 360 / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp < 1) {
      r = c;
      g = x;
    } else if (hp < 2) {
      r = x;
      g = c;
    } else if (hp < 3) {
      g = c;
      b = x;
    } else if (hp < 4) {
      g = x;
      b = c;
    } else if (hp < 5) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    const m = l - c / 2;
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function hueDiff(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function isImageFile(file) {
    if (file.type && file.type.indexOf("image/") === 0) return true;
    return /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(file.name || "");
  }

  function loadImage(file) {
    return new Promise(function (resolve) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  function sampleImage(img, weight) {
    const max = 128;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) return [];
    const scale = Math.min(1, max / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, w, h);
    let data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (err) {
      return [];
    }

    function patchAvg(x0, y0, size) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const x1 = Math.min(w, x0 + size);
      const y1 = Math.min(h, y0 + size);
      for (let y = Math.max(0, y0); y < y1; y++) {
        for (let x = Math.max(0, x0); x < x1; x++) {
          const i = (y * w + x) * 4;
          if (data[i + 3] < 140) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
      }
      return n ? [r / n, g / n, b / n] : null;
    }

    function distSq(a, r, g, b) {
      const dr = a[0] - r;
      const dg = a[1] - g;
      const db = a[2] - b;
      return dr * dr + dg * dg + db * db;
    }

    const corners = [
      patchAvg(0, 0, 8),
      patchAvg(w - 8, 0, 8),
      patchAvg(0, h - 8, 8),
      patchAvg(w - 8, h - 8, 8),
    ].filter(Boolean);
    let backdrop = null;
    if (corners.length >= 3) {
      const avg = [0, 0, 0];
      corners.forEach(function (c) {
        avg[0] += c[0];
        avg[1] += c[1];
        avg[2] += c[2];
      });
      avg[0] /= corners.length;
      avg[1] /= corners.length;
      avg[2] /= corners.length;
      const agree = corners.every(function (c) {
        return distSq(avg, c[0], c[1], c[2]) < 1600;
      });
      if (agree) backdrop = avg;
    }

    const buckets = {};
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 140) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (backdrop && distSq(backdrop, r, g, b) < 2200) continue;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const hsl = rgbToHsl(r, g, b);
      if (chroma < 22 && hsl.l < 0.22) continue;
      if (chroma < 22 && hsl.l > 0.82) continue;
      if (hsl.l < 0.12 && chroma < 48) continue;
      const hBucket = Math.round(hsl.h / 12) % 30;
      const sBand = hsl.s < 0.28 ? 0 : hsl.s < 0.58 ? 1 : 2;
      const lBand = hsl.l < 0.32 ? 0 : hsl.l < 0.62 ? 1 : 2;
      const key = hBucket + ":" + sBand + ":" + lBand;
      const wgt = weight * (0.12 + (chroma / 255) * 2.6) * (0.35 + hsl.s);
      if (!buckets[key]) {
        buckets[key] = { r: 0, g: 0, b: 0, w: 0, h: hsl.h };
      }
      buckets[key].r += r * wgt;
      buckets[key].g += g * wgt;
      buckets[key].b += b * wgt;
      buckets[key].w += wgt;
    }
    return Object.keys(buckets).map(function (key) {
      const item = buckets[key];
      const rgb = [item.r / item.w, item.g / item.w, item.b / item.w];
      const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      return {
        hex: toHex(rgb[0], rgb[1], rgb[2]),
        w: item.w,
        h: hsl.h,
        s: hsl.s,
        l: hsl.l,
        rgb: rgb,
      };
    });
  }

  function shiftHex(hex, dh, ds, dl) {
    const n = parseInt(hex.slice(1), 16);
    const hsl = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
    const rgb = hslToRgb(
      hsl.h + dh,
      Math.max(0.22, Math.min(0.92, hsl.s + ds)),
      Math.max(0.22, Math.min(0.78, hsl.l + dl))
    );
    return toHex(rgb[0], rgb[1], rgb[2]);
  }

  function pickThree(clusters) {
    clusters.forEach(function (item) {
      if (item.s == null) {
        const hsl = rgbToHsl(item.rgb[0], item.rgb[1], item.rgb[2]);
        item.h = hsl.h;
        item.s = hsl.s;
        item.l = hsl.l;
      }
      item.score = item.w * (0.2 + item.s * 2.4) * (item.l < 0.16 || item.l > 0.88 ? 0.25 : 1);
    });
    clusters.sort(function (a, b) {
      return b.score - a.score;
    });
    const chromatic = clusters.filter(function (item) {
      return item.s >= 0.22 && item.l >= 0.16 && item.l <= 0.86;
    });
    const rest = clusters.filter(function (item) {
      return chromatic.indexOf(item) === -1 && item.l >= 0.14 && item.l <= 0.9;
    });
    const picked = [];

    function take(list) {
      list.forEach(function (item) {
        if (picked.length >= 3) return;
        const tooClose = picked.some(function (other) {
          const dr = item.rgb[0] - other.rgb[0];
          const dg = item.rgb[1] - other.rgb[1];
          const db = item.rgb[2] - other.rgb[2];
          return hueDiff(item.h, other.h) < 16 && dr * dr + dg * dg + db * db < 4800;
        });
        if (!tooClose) picked.push(item);
      });
    }

    take(chromatic);
    if (picked.length < 3) take(rest);
    if (!picked.length) return ["#00c8c9", "#ff8a1a", "#4a1f7a"];
    const hexes = picked.map(function (item) {
      return item.hex;
    });
    const seed = hexes[0];
    if (hexes.length === 1) {
      hexes.push(shiftHex(seed, 0, 0.04, -0.18));
      hexes.push(shiftHex(seed, 36, -0.12, 0.16));
    } else if (hexes.length === 2) {
      hexes.push(shiftHex(seed, 42, -0.06, 0.12));
    }
    return hexes.slice(0, 3);
  }

  function extractColours(jobs) {
    return Promise.all(
      jobs.map(function (job) {
        if (!isImageFile(job.file)) return Promise.resolve([]);
        return loadImage(job.file).then(function (img) {
          if (!img) return [];
          return sampleImage(img, job.weight);
        });
      })
    ).then(function (lists) {
      const merged = [];
      lists.forEach(function (list) {
        merged.push.apply(merged, list);
      });
      return pickThree(merged);
    });
  }

  function watchColours(options) {
    const defaults = options.defaults || ["#00c8c9", "#ff8a1a", "#4a1f7a"];
    const swatches = options.swatches || [];
    const fileInputs = options.fileInputs || [];
    const note = options.note;
    const weights = options.weights || {};
    const locked = swatches.map(function () {
      return false;
    });
    let timer = 0;
    let token = 0;

    swatches.forEach(function (el, i) {
      el.addEventListener("input", function () {
        locked[i] = true;
        el.closest(".brief-swatch").classList.remove("is-auto");
      });
    });

    function collect() {
      const jobs = [];
      fileInputs.forEach(function (input) {
        const list = Array.from(input.files || []);
        const cap = input.id === "extra-photos" ? 4 : list.length;
        list.slice(0, cap).forEach(function (file) {
          jobs.push({ file: file, weight: weights[input.id] || 1 });
        });
      });
      return jobs;
    }

    function apply(hexes, fromFiles) {
      swatches.forEach(function (el, i) {
        if (locked[i]) return;
        el.value = hexes[i] || defaults[i];
        const wrap = el.closest(".brief-swatch");
        if (fromFiles) {
          wrap.classList.add("is-auto");
        } else {
          wrap.classList.remove("is-auto");
        }
      });
      if (!note) return;
      note.textContent = fromFiles
        ? "Using colours from your logo and photos. Change them if they look wrong."
        : "We’ll read three colours from your logo and photos. Change them if they look wrong.";
    }

    function refresh() {
      const jobs = collect();
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        if (!jobs.length) {
          apply(defaults, false);
          return;
        }
        const run = ++token;
        extractColours(jobs).then(function (hexes) {
          if (run !== token) return;
          apply(hexes, true);
        });
      }, 180);
    }

    apply(defaults, false);
    return refresh;
  }

  global.VibeBriefFiles = {
    setFiles: setFiles,
    bind: bind,
    watchColours: watchColours,
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
