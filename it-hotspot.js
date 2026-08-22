(function () {
  const img = document.querySelector(".hero-image");
  const link = document.querySelector(".it-link");
  if (!img || !link) return;

  // Wordmark It slot on the 1536x1024 / 1024x1536 art, shifted a
  // few pixels right so the lure glow clears the tip of Vibe's e.
  const spots = {
    landscape: { x: 0.565, y: 0.525, w: 0.081, h: 0.121 },
    portrait: { x: 0.593, y: 0.506, w: 0.12, h: 0.08 },
  };

  const IDLE_MS = 5000;
  let lureTimer = 0;
  let goTimer = 0;
  let idleTimer = 0;
  let idleOn = false;
  let idleRemain = IDLE_MS;
  let idleTick = 0;

  function place() {
    const portrait = window.matchMedia("(orientation: portrait)").matches;
    const spot = portrait ? spots.portrait : spots.landscape;
    const nw = img.naturalWidth || (portrait ? 1024 : 1536);
    const nh = img.naturalHeight || (portrait ? 1536 : 1024);
    const rw = img.clientWidth;
    const rh = img.clientHeight;
    const scale = Math.max(rw / nw, rh / nh);
    const shownW = nw * scale;
    const shownH = nh * scale;
    const ox = (rw - shownW) / 2;
    const oy = (rh - shownH) / 2;

    const width = spot.w * shownW;
    const height = spot.h * shownH;
    link.style.left = ox + spot.x * shownW + "px";
    link.style.top = oy + spot.y * shownH + "px";
    link.style.width = width + "px";
    link.style.height = height + "px";
    link.classList.add("is-ready");
  }

  function resetOpening() {
    document.body.classList.remove("is-opening");
    link.classList.remove("is-opening");
    document.body.style.removeProperty("--it-x");
    document.body.style.removeProperty("--it-y");
    document.body.style.removeProperty("--it-r");
    if (goTimer) {
      window.clearTimeout(goTimer);
      goTimer = 0;
    }
  }

  function startLure() {
    link.classList.remove("is-lure");
    if (lureTimer) {
      window.clearTimeout(lureTimer);
    }
    lureTimer = window.setTimeout(function () {
      lureTimer = 0;
      if (document.body.classList.contains("is-opening")) return;
      link.classList.add("is-lure");
    }, 4000);
  }

  function stopIdle() {
    idleOn = false;
    if (idleTimer) {
      window.clearTimeout(idleTimer);
      idleTimer = 0;
    }
  }

  function armIdle() {
    if (!idleOn || document.hidden) return;
    idleTick = Date.now();
    idleTimer = window.setTimeout(function () {
      idleTimer = 0;
      idleOn = false;
      if (document.body.classList.contains("is-opening")) return;
      link.click();
    }, idleRemain);
  }

  function startIdle() {
    stopIdle();
    idleOn = true;
    idleRemain = IDLE_MS;
    armIdle();
  }

  function restoreSplash() {
    resetOpening();
    startLure();
    startIdle();
    place();
  }

  img.addEventListener("load", place);
  img.addEventListener("error", place);
  window.addEventListener("resize", place);
  place();

  // pagehide clears the portal before bfcache freezes this document,
  // so Back cannot restore a mid-open splash. pageshow / popstate
  // cover persisted restores and same-document history moves.
  window.addEventListener("pagehide", resetOpening);
  window.addEventListener("pageshow", restoreSplash);
  window.addEventListener("popstate", restoreSplash);
  document.addEventListener("visibilitychange", function () {
    if (!idleOn) return;
    if (document.hidden) {
      if (idleTimer) {
        idleRemain = Math.max(0, idleRemain - (Date.now() - idleTick));
        window.clearTimeout(idleTimer);
        idleTimer = 0;
      }
    } else {
      armIdle();
    }
  });
  startLure();
  startIdle();

  link.addEventListener("click", function (event) {
    stopIdle();
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button
    ) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    if (document.body.classList.contains("is-opening")) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    const box = link.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(window.innerWidth, window.innerHeight) * 1.2;
    document.body.style.setProperty("--it-x", x + "px");
    document.body.style.setProperty("--it-y", y + "px");
    document.body.style.setProperty("--it-r", radius + "px");
    link.classList.add("is-opening");
    void document.body.offsetWidth;
    document.body.classList.add("is-opening");

    if (goTimer) {
      window.clearTimeout(goTimer);
    }
    goTimer = window.setTimeout(function () {
      goTimer = 0;
      window.location.assign("services.html?from=it");
    }, 920);
  });
})();
