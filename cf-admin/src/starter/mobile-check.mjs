import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const failures = [];

if (!/name=["']viewport["']/i.test(html)) {
  failures.push("index.html needs <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.");
}

const mobileCss = stripMinWidthMedia(stripComments(css));

if (!/max-width\s*:\s*100%/.test(mobileCss)) {
  failures.push("Images need max-width: 100% so they stay on the screen.");
}

if (!/overflow-wrap\s*:|word-break\s*:/.test(mobileCss)) {
  failures.push("Long words need overflow-wrap so a heading cannot force a sideways scroll.");
}

if (!/overflow-x\s*:\s*(?:clip|hidden)/.test(mobileCss)) {
  failures.push("html or body needs overflow-x: clip so a full-bleed photo does not add a sideways scroll.");
}

if (/white-space\s*:\s*nowrap/.test(mobileCss)) {
  failures.push("white-space: nowrap is on the phone layout. It cuts off long names. Keep nowrap inside a min-width media query only.");
}

const wide = [];
const widthRe = /(?:^|[{;\n])\s*(?:width|min-width)\s*:\s*(\d+(?:\.\d+)?)px/g;
let widthMatch;
while ((widthMatch = widthRe.exec(mobileCss))) {
  const size = Number(widthMatch[1]);
  if (size > 400) wide.push(Math.round(size) + "px");
}
if (wide.length) {
  failures.push("Phone layout has a fixed width wider than a phone: " + wide.join(", ") + ". Use a percentage or put that width inside a min-width media query.");
}

const inlineWide = [];
const inlineRe = /style=["'][^"']*(?:width|min-width)\s*:\s*(\d+(?:\.\d+)?)px/gi;
let inlineMatch;
while ((inlineMatch = inlineRe.exec(html))) {
  const size = Number(inlineMatch[1]);
  if (size > 400) inlineWide.push(Math.round(size) + "px");
}
if (inlineWide.length) {
  failures.push("index.html has an inline width wider than a phone: " + inlineWide.join(", ") + ".");
}

if (!/min-height\s*:\s*(\d+)px/.test(mobileCss) || !mobileMinHeight(mobileCss)) {
  failures.push("The main buttons need min-height: 44px so they can be tapped on a phone.");
}

if (failures.length) {
  console.log("FAIL");
  failures.forEach(function (line) {
    console.log("- " + line);
  });
  process.exit(1);
}

console.log("PASS");
console.log("Phone layout in index.html and styles.css can fit a 360px-wide screen.");
console.log("Still look at the page at 360px and 390px. This script cannot see overlap.");

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripMinWidthMedia(text) {
  const re = /@media[^{]*\bmin-width\s*:/g;
  let result = "";
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    result += text.slice(last, match.index);
    const brace = text.indexOf("{", match.index);
    if (brace === -1) break;
    let depth = 0;
    let end = brace;
    for (; end < text.length; end++) {
      if (text[end] === "{") depth += 1;
      else if (text[end] === "}") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    last = end;
    re.lastIndex = end;
  }
  result += text.slice(last);
  return result;
}

function mobileMinHeight(text) {
  const re = /min-height\s*:\s*(\d+)px/g;
  let match;
  while ((match = re.exec(text))) {
    if (Number(match[1]) >= 44) return true;
  }
  return false;
}
