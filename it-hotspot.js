(function () {
  const img = document.querySelector(".hero-image");
  const link = document.querySelector(".it-link");
  const videos = document.querySelectorAll(".hero-video");
  const deskVideo = document.querySelector(".hero-video--desk");
  const phoneVideos = document.querySelectorAll(".hero-video--phone");
  const phoneFit = document.querySelector(".hero-video--fit");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!img || !link) return;

  // Wordmark It slot on the 1536x1024 / 1024x1536 art, shifted a
  // few pixels right so the lure glow clears the tip of Vibe's e.
  const spots = {
    landscape: { x: 0.565, y: 0.525, w: 0.081, h: 0.121 },
    portrait: { x: 0.593, y: 0.506, w: 0.12, h: 0.08 },
  };

  const IDLE_MS = 5000;
  const INTRO_LIMIT_MS = 22000;
  const STALL_MS = 5000;
  let lureTimer = 0;
  let goTimer = 0;
  let idleTimer = 0;
  let introTimer = 0;
  let stallTimer = 0;
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
    eachVideo(function (clip) {
      clip.pause();
    });
    clearIntroTimers();
    if (goTimer) {
      window.clearTimeout(goTimer);
      goTimer = 0;
    }
  }

  function clearIntroTimers() {
    if (introTimer) {
      window.clearTimeout(introTimer);
      introTimer = 0;
    }
    if (stallTimer) {
      window.clearTimeout(stallTimer);
      stallTimer = 0;
    }
  }

  function goToServices(x, y) {
    if (document.body.classList.contains("is-opening")) return;
    clearIntroTimers();
    stopIdle();
    openServices(null, x, y);
  }

  function armIntroLimit() {
    if (introTimer) {
      window.clearTimeout(introTimer);
    }
    introTimer = window.setTimeout(function () {
      introTimer = 0;
      goToServices();
    }, INTRO_LIMIT_MS);
  }

  function armStall() {
    if (stallTimer) {
      window.clearTimeout(stallTimer);
    }
    stallTimer = window.setTimeout(function () {
      stallTimer = 0;
      goToServices();
    }, STALL_MS);
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

  function phoneIntro() {
    return window.matchMedia("(orientation: portrait), (max-aspect-ratio: 4/5)").matches;
  }

  function activeVideo() {
    if (phoneFit && phoneIntro()) return phoneFit;
    return deskVideo || videos[0];
  }

  function eachVideo(fn) {
    for (let i = 0; i < videos.length; i++) {
      fn(videos[i]);
    }
  }

  function pauseIntro() {
    eachVideo(function (clip) {
      clip.pause();
    });
  }

  function showStaticSplash() {
    document.body.classList.remove("is-intro", "is-intro-wait");
  }

  function revealIntroVideo() {
    document.body.classList.remove("is-intro-wait");
    document.body.classList.add("is-intro");
  }

  function playIntro(force) {
    if (reduceMotion || phoneIntro()) {
      showStaticSplash();
      startIdle();
      return;
    }

    const clip = activeVideo();
    if (!clip) {
      showStaticSplash();
      startIdle();
      return;
    }

    // pageshow fires on first load as well as bfcache restores.
    // Restarting here made the intro play twice in a row.
    if (!force && !clip.paused && clip.currentTime > 0) {
      return;
    }

    stopIdle();
    document.body.classList.add("is-intro-wait");
    document.body.classList.remove("is-intro");
    eachVideo(function (other) {
      other.pause();
      other.muted = true;
      other.defaultMuted = true;
      other.playsInline = true;
      try {
        other.currentTime = 0;
      } catch (e) {}
    });
    clip.preload = "auto";
    armIntroLimit();
    const pack = [clip];
    let playPromise = null;
    for (let i = 0; i < pack.length; i++) {
      pack[i].preload = "auto";
      const next = pack[i].play();
      if (pack[i] === clip) playPromise = next;
    }
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(function () {
        clearIntroTimers();
        showStaticSplash();
        startIdle();
      });
    }
  }

  function restoreSplash() {
    resetOpening();
    startLure();
    playIntro(true);
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
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    restoreSplash();
  });
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

  if (videos.length) {
    eachVideo(function (clip) {
      clip.muted = true;
      clip.addEventListener("playing", function () {
        if (clip !== activeVideo()) return;
        if (stallTimer) {
          window.clearTimeout(stallTimer);
          stallTimer = 0;
        }
        revealIntroVideo();
      });
      clip.addEventListener("waiting", function () {
        if (clip !== activeVideo()) return;
        armStall();
      });
      clip.addEventListener("stalled", function () {
        if (clip !== activeVideo()) return;
        armStall();
      });
      clip.addEventListener("ended", function () {
        if (clip !== activeVideo()) return;
        goToServices();
      });
      clip.addEventListener("error", function () {
        if (clip !== activeVideo()) return;
        clearIntroTimers();
        showStaticSplash();
        startIdle();
      });
    });
  }

  function openServices(event, x, y) {
    stopIdle();
    if (
      event &&
      (event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button)
    ) {
      return;
    }
    pauseIntro();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (!event || event.currentTarget !== link) {
        window.location.assign("/services/?from=it");
      }
      return;
    }
    if (document.body.classList.contains("is-opening")) {
      if (event) event.preventDefault();
      return;
    }

    if (event) event.preventDefault();
    if (x == null || y == null) {
      const box = link.getBoundingClientRect();
      x = box.left + box.width / 2;
      y = box.top + box.height / 2;
    }
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
      window.location.assign("/services/?from=it");
    }, 920);
  }

  startLure();
  playIntro();

  link.addEventListener("click", function (event) {
    openServices(event);
  });

  const page = document.querySelector(".page");
  if (page) {
    page.addEventListener("click", function (event) {
      if (event.target.closest(".it-link")) return;
      openServices(event, event.clientX, event.clientY);
    });
  }
})();
