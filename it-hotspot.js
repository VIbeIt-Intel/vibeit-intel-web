(function () {
  const img = document.querySelector(".hero-image");
  const link = document.querySelector(".it-link");
  if (!img || !link) return;

  const spots = {
    landscape: { x: 0.562, y: 0.537, w: 0.052, h: 0.078 },
    portrait: { x: 0.586, y: 0.51, w: 0.085, h: 0.057 },
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
    link.style.fontSize = height * 0.7 + "px";
    link.classList.add("is-ready");
  }

  img.addEventListener("load", place);
  window.addEventListener("resize", place);
  if (img.complete) place();
})();
