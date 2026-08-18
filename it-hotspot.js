(function () {
  const img = document.querySelector(".hero-image");
  const link = document.querySelector(".it-link");
  if (!img || !link) return;

  const spots = {
    landscape: { x: 0.56, y: 0.5361, w: 0.0527, h: 0.0791 },
    portrait: { x: 0.584, y: 0.5104, w: 0.085, h: 0.0566 },
  };

  function place() {
    const portrait = window.matchMedia("(orientation: portrait)").matches;
    const spot = portrait ? spots.portrait : spots.landscape;
    const nw = img.naturalWidth || 1536;
    const nh = img.naturalHeight || 1024;
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

  img.addEventListener("load", place);
  window.addEventListener("resize", place);
  if (img.complete) place();

  link.addEventListener("click", function (event) {
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

    window.setTimeout(function () {
      window.location.href = "services.html?from=it";
    }, 920);
  });
})();
