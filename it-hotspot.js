(function () {
  const img = document.querySelector(".hero-image");
  const link = document.querySelector(".it-link");
  if (!img || !link) return;

  const spots = {
    landscape: { x: 0.5651, y: 0.5254, w: 0.0625, h: 0.0938 },
    portrait: { x: 0.627, y: 0.5, w: 0.1094, h: 0.0729 },
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

    link.style.left = ox + spot.x * shownW + "px";
    link.style.top = oy + spot.y * shownH + "px";
    link.style.width = spot.w * shownW + "px";
    link.style.height = spot.h * shownH + "px";
  }

  img.addEventListener("load", place);
  window.addEventListener("resize", place);
  if (img.complete) place();
})();
