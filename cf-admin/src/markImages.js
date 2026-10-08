import jpegJs from "jpeg-js";
import { convertIndexedToRgb, decode as decodePng, encode as encodePng } from "fast-png";

const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
};

function hexRgb(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return [22, 16, 24];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function decodeImage(bytes, mime) {
  const type = String(mime || "").toLowerCase();
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (type.indexOf("png") !== -1 || (input[0] === 0x89 && input[1] === 0x50)) {
    let png = decodePng(input);
    if (png.palette) {
      const rgb = convertIndexedToRgb(png);
      const channels = png.palette[0].length;
      return { data: rgb, width: png.width, height: png.height, channels: channels };
    }
    return { data: png.data, width: png.width, height: png.height, channels: png.channels || 4 };
  }
  const jpg = jpegJs.decode(input, { useTArray: true, maxMemoryUsageInMB: 40 });
  return { data: jpg.data, width: jpg.width, height: jpg.height, channels: 4 };
}

function sample(src, sw, sh, ch, size, contain) {
  const scale = contain ? Math.min(size / sw, size / sh) * 0.86 : Math.max(size / sw, size / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const ox = (size - dw) / 2;
  const oy = (size - dh) / 2;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x + 0.5 - ox) / scale);
      const sy = Math.floor((y + 0.5 - oy) / scale);
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
      const si = (sy * sw + sx) * ch;
      const di = (y * size + x) * 4;
      out[di] = src[si] || 0;
      out[di + 1] = src[si + 1] || 0;
      out[di + 2] = src[si + 2] || 0;
      out[di + 3] = ch >= 4 ? src[si + 3] : 255;
    }
  }
  return out;
}

function fill(size, rgb) {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = rgb[0];
    out[i + 1] = rgb[1];
    out[i + 2] = rgb[2];
    out[i + 3] = 255;
  }
  return out;
}

function over(base, sprite) {
  for (let i = 0; i < base.length; i += 4) {
    const a = sprite[i + 3] / 255;
    if (!a) continue;
    base[i] = Math.round(sprite[i] * a + base[i] * (1 - a));
    base[i + 1] = Math.round(sprite[i + 1] * a + base[i + 1] * (1 - a));
    base[i + 2] = Math.round(sprite[i + 2] * a + base[i + 2] * (1 - a));
    base[i + 3] = 255;
  }
  return base;
}

function punchCircle(rgba, size) {
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      if (dist >= r) rgba[i + 3] = 0;
      else if (dist > r - 1) rgba[i + 3] = Math.round(rgba[i + 3] * (r - dist));
    }
  }
  return rgba;
}

function drawLetter(size, letter, ink) {
  const glyph = FONT[letter] || FONT.O;
  const out = new Uint8Array(size * size * 4);
  const scale = Math.max(1, Math.floor(size / 10));
  const gw = 5 * scale;
  const gh = 7 * scale;
  const ox = Math.floor((size - gw) / 2);
  const oy = Math.floor((size - gh) / 2);
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 5; x++) {
      if (glyph[y].charAt(x) !== "1") continue;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const dx = ox + x * scale + px;
          const dy = oy + y * scale + py;
          if (dx < 0 || dy < 0 || dx >= size || dy >= size) continue;
          const i = (dy * size + dx) * 4;
          out[i] = ink[0];
          out[i + 1] = ink[1];
          out[i + 2] = ink[2];
          out[i + 3] = 255;
        }
      }
    }
  }
  return out;
}

function pngBytes(rgba, size) {
  return encodePng({ width: size, height: size, data: rgba, channels: 4 });
}

function jpegBytes(rgba, size) {
  const encoded = jpegJs.encode({ data: rgba, width: size, height: size }, 82);
  return encoded.data;
}

function base64(bytes) {
  const chunk = 0x8000;
  let binary = "";
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < src.length; i += chunk) {
    binary += String.fromCharCode.apply(null, src.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function circleMark(sprite, size, paper) {
  const base = fill(size, paper);
  over(base, sprite);
  return punchCircle(base, size);
}

function squareMark(sprite, size, paper) {
  const base = fill(size, paper);
  return over(base, sprite);
}

export function makeMarks(bytes, mime, paperHex, accentHex, letter) {
  const paper = hexRgb(paperHex);
  const accent = hexRgb(accentHex);
  const ink = paper[0] + paper[1] + paper[2] > 380 ? [20, 16, 24] : [247, 244, 239];
  let sprite32;
  let sprite192;
  let sprite180;
  let sprite600;
  try {
    if (!bytes || !bytes.byteLength) throw new Error("no logo");
    if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("logo too large");
    const image = decodeImage(bytes, mime);
    if (!image.width || !image.height || image.width * image.height > 8e6) throw new Error("logo too big");
    sprite32 = sample(image.data, image.width, image.height, image.channels, 32, false);
    sprite192 = sample(image.data, image.width, image.height, image.channels, 192, false);
    sprite180 = sample(image.data, image.width, image.height, image.channels, 180, true);
    sprite600 = sample(image.data, image.width, image.height, image.channels, 600, true);
  } catch (err) {
    const mark = String(letter || "V").toUpperCase().charAt(0);
    sprite32 = drawLetter(32, mark, ink);
    sprite192 = drawLetter(192, mark, ink);
    sprite180 = drawLetter(180, mark, ink);
    sprite600 = drawLetter(600, mark, ink);
  }
  const png192 = pngBytes(circleMark(sprite192, 192, paper), 192);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">' +
    '<image href="data:image/png;base64,' +
    base64(png192) +
    '" width="192" height="192"/></svg>';
  return {
    png32: pngBytes(circleMark(sprite32, 32, paper), 32),
    png192: png192,
    apple: pngBytes(squareMark(sprite180, 180, paper), 180),
    share: jpegBytes(squareMark(sprite600, 600, paper), 600),
    svg: svg,
  };
}

function grayAt(data, width, height, channels, x, y) {
  const sx = Math.max(0, Math.min(width - 1, x));
  const sy = Math.max(0, Math.min(height - 1, y));
  const i = (sy * width + sx) * channels;
  const r = data[i] || 0;
  const g = data[i + 1] || 0;
  const b = data[i + 2] || 0;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function scorePhoto(bytes, mime) {
  const image = decodeImage(bytes, mime);
  const width = image.width;
  const height = image.height;
  const channels = image.channels;
  const data = image.data;
  if (!width || !height || width * height > 8e6) throw new Error("photo too big");
  let hash = 0n;
  let bit = 0n;
  for (let y = 0; y < 8; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / 8));
    for (let x = 0; x < 8; x++) {
      const left = grayAt(data, width, height, channels, Math.floor((x + 0.5) * width / 9), sy);
      const right = grayAt(data, width, height, channels, Math.floor((x + 1.5) * width / 9), sy);
      if (left > right) hash |= 1n << bit;
      bit += 1n;
    }
  }
  const grid = 48;
  let acc = 0;
  let count = 0;
  for (let y = 0; y < grid; y++) {
    let prev = 0;
    for (let x = 0; x < grid; x++) {
      const g = grayAt(
        data,
        width,
        height,
        channels,
        Math.floor((x + 0.5) * width / grid),
        Math.floor((y + 0.5) * height / grid)
      );
      if (x) {
        acc += Math.abs(g - prev);
        count += 1;
      }
      prev = g;
    }
  }
  return {
    hash: hash.toString(),
    sharpness: count ? acc / count : 0,
    pixels: width * height,
  };
}

export function hamming(a, b) {
  let x = BigInt(a) ^ BigInt(b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

function byQuality(a, b) {
  if (b.sharpness !== a.sharpness) return b.sharpness - a.sharpness;
  if (b.pixels !== a.pixels) return b.pixels - a.pixels;
  return a.order - b.order;
}

export function chooseShots(items) {
  const clusters = [];
  items.forEach(function (item, index) {
    const row = Object.assign({ order: index }, item);
    if (!row.hash) {
      clusters.push([row]);
      return;
    }
    for (let i = 0; i < clusters.length; i++) {
      const close = clusters[i].some(function (member) {
        return member.hash && hamming(member.hash, row.hash) <= 8;
      });
      if (close) {
        clusters[i].push(row);
        return;
      }
    }
    clusters.push([row]);
  });
  const kept = [];
  const dropped = [];
  clusters.forEach(function (group) {
    const ranked = group.slice().sort(byQuality);
    kept.push(ranked[0]);
    for (let i = 1; i < ranked.length; i++) {
      dropped.push(Object.assign({}, ranked[i], { keptAs: ranked[0].dest || "" }));
    }
  });
  const vibes = kept.filter(function (shot) {
    return shot.role === "vibe";
  }).sort(byQuality);
  const hero = vibes[0] || kept.slice().sort(byQuality)[0];
  const rest = kept.filter(function (shot) {
    return shot !== hero;
  }).sort(function (a, b) {
    return a.order - b.order;
  });
  return { gallery: hero ? [hero].concat(rest) : [], dropped: dropped };
}
