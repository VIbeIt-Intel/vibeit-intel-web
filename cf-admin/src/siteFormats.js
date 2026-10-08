const FORMATS = {
  "Hair or beauty salon": {
    title: "Hair or beauty salon",
    look: "Warm, polished, booking-led. Lead with hair work, the team, and a price list. The site should feel like a salon, not a restaurant or a workshop.",
    sections: [
      "Hero with Book / WhatsApp as the main button",
      "Treatments and prices (cuts, colour, treatments — not a food menu)",
      "If they sell products, a Shop shelf separate from treatments",
      "Team / stylists if names exist in the brief",
      "Gallery of hair and the space",
      "Hours",
      "Book / contact",
    ],
    avoid: "Do not use a restaurant menu, a trades quote-first layout, or a gym class timetable.",
  },
  "Nail salon": {
    title: "Nail salon",
    look: "Clean, close-up, appointment-led. Nail work and the studio come first. Easy to scan sets, fills, and add-ons.",
    sections: [
      "Hero with Book as the main button",
      "Menu of sets, fills, and add-ons with prices if the brief has them",
      "If they sell nail products, a Shop section separate from treatments",
      "Gallery of nail work",
      "Hours and how far ahead to book",
      "Book / contact",
    ],
    avoid: "Do not use a food menu, a mechanic service list, or a large corporate services grid.",
  },
  Barber: {
    title: "Barber",
    look: "Sharp and straightforward. Cuts, fades, and the chair. Walk-in vs book should be obvious.",
    sections: [
      "Hero with Book or Walk in as the main button",
      "Cuts and prices",
      "Gallery of cuts and the shop",
      "Hours",
      "Book / contact",
    ],
    avoid: "Do not dress it like a beauty spa or a restaurant.",
  },
  "Maker or fabricator": {
    title: "Maker or fabricator",
    look: "The work is the page. Dark or high-contrast, full-bleed photos of what they actually build, named pieces, then call or WhatsApp. This is a workshop brand, not a call-out trades brochure and not a copy of any other client.",
    sections: [
      "Hero with one line from what they make, and Call / WhatsApp as the main button",
      "The builds as jobs: every angle of one vehicle, frame, or bar together, with a real name for that piece",
      "What they make, as products if they sell items",
      "How the work is done, short — custom, since when, where",
      "Call / WhatsApp / contact",
    ],
    avoid: "Do not use a plumber quote layout, a salon booking page, a cream brochure, or another client's timber/lodge wording.",
  },
  "Mechanic or panel beater": {
    title: "Mechanic or panel beater",
    look: "Trust and workshop. Practical, darker, photo of real work. Quote and phone beat pretty bookings.",
    sections: [
      "Hero with Get a quote / Call as the main button",
      "Services (service, repair, diagnostics, panel — not salon treatments)",
      "Why trust us (years, brands, insurance) if the brief has it",
      "Recent jobs / workshop photos",
      "Hours and area served",
      "Quote / contact",
    ],
    avoid: "Do not use a salon price list, a food menu, or a class timetable.",
  },
  "Plumber, electrician or other trade": {
    title: "Trades / maintenance",
    look: "Outdoor and job-site. Service area and a quote path. Practical, not pretty-spa.",
    sections: [
      "Hero with Get a quote as the main button",
      "Services (what they actually fix or install)",
      "Areas they work",
      "Recent jobs",
      "Hours / call-out notes if in the brief",
      "Quote / contact",
    ],
    avoid: "Do not use a salon booking layout, a restaurant menu, or a retail product grid as the main page.",
  },
  "Restaurant, cafe or takeaway": {
    title: "Restaurant, cafe or takeaway",
    look: "Appetite first. Food photos, the menu, hours, and how to order or reserve. This is not a salon.",
    sections: [
      "Hero with Order / Reserve / WhatsApp as the main button",
      "Menu grouped by starters, mains, drinks (or the groups in the brief)",
      "Hours and location",
      "Gallery of food and the space",
      "Order / reserve / contact",
    ],
    avoid: "Do not use a hair price list, a trades quote form as the only content, or a gym timetable.",
  },
  "Medical, dental or physio": {
    title: "Medical, dental or physio",
    look: "Calm, clear, professional. Services, who they will see, hours, and how to book. No flashy sales.",
    sections: [
      "Hero with Book / Call as the main button",
      "Services in plain language",
      "Practitioners if names exist",
      "Hours and what to bring / medical aid notes if in the brief",
      "Book / contact",
    ],
    avoid: "Do not use a restaurant menu, loud retail banners, or a workshop quote layout.",
  },
  "Gym or fitness": {
    title: "Gym or fitness",
    look: "Energy and timetable. Classes, trainers, and how to join or trial.",
    sections: [
      "Hero with Join / Book a class as the main button",
      "Classes or timetable",
      "Trainers if names exist",
      "Memberships or packages if in the brief",
      "Gallery",
      "Join / contact",
    ],
    avoid: "Do not use a food menu or a salon treatment list as the main structure.",
  },
  "Retail shop": {
    title: "Retail shop",
    look: "Product-led. Categories and featured items, then visit or buy.",
    sections: [
      "Hero with Visit / Buy / WhatsApp as the main button",
      "Featured products",
      "Categories",
      "Hours and how to buy (in-store, order, delivery) if in the brief",
      "Contact",
    ],
    avoid: "Do not default to a salon booking page or a restaurant menu unless they actually sell those.",
  },
  "Professional services": {
    title: "Professional services",
    look: "Quiet trust. What they do, who they help, the process, then contact. Less gallery, more clarity.",
    sections: [
      "Hero with Call / Email / Enquire as the main button",
      "Services",
      "Who they help",
      "How it works / process",
      "Contact",
    ],
    avoid: "Do not force a big photo gallery, a food menu, or a salon price list.",
  },
  "Cleaning or home services": {
    title: "Cleaning or home services",
    look: "Before/after and packages. Quote and areas served. Clean and easy to scan.",
    sections: [
      "Hero with Get a quote as the main button",
      "Packages / what is included",
      "Areas they cover",
      "Before and after if photos exist",
      "Quote / contact",
    ],
    avoid: "Do not use a restaurant menu or a salon booking calendar as the main page.",
  },
  "Events or photography": {
    title: "Events or photography",
    look: "Showcase first. Past work, packages, then enquire.",
    sections: [
      "Hero with Enquire / Book as the main button",
      "Packages",
      "Gallery of past work",
      "Enquire / contact",
    ],
    avoid: "Do not use a food menu or a mechanic service checklist as the main layout.",
  },
  Other: {
    title: "Other",
    look: "Follow the brief. Infer layout from what they sell and the customer action. Still pick one coherent structure.",
    sections: [
      "Hero with the chosen customer action as the main button",
      "What they do",
      "Proof / photos if they exist",
      "Hours if relevant",
      "Primary CTA and contact",
    ],
    avoid: "Do not default to a salon, a restaurant, or a generic five-section brochure if the brief points elsewhere.",
  },
};

function fuzzyKey(raw) {
  const t = String(raw || "").toLowerCase();
  if (!t) return "Other";
  if (FORMATS[raw]) return raw;
  if (/nail|gel|lash|manicur/.test(t)) return "Nail salon";
  if (/barber|fade/.test(t)) return "Barber";
  if (/hair|beauty|salon|spa/.test(t)) return "Hair or beauty salon";
  if (/steel|fabricat|weld|bush\s?bar|4x4|game view|cattle frame|pipe ?work|joiner|cabinet|furniture|timber|metalwork|coachbuild/.test(t)) {
    return "Maker or fabricator";
  }
  if (/mechanic|panel|auto|garage|workshop|car repair/.test(t)) {
    return "Mechanic or panel beater";
  }
  if (/plumb|electric|trade|maintenance|handyman|builder|roof|paint/.test(t)) {
    return "Plumber, electrician or other trade";
  }
  if (/restaurant|cafe|café|takeaway|food|bakery|cater|pizza|braai/.test(t)) {
    return "Restaurant, cafe or takeaway";
  }
  if (/medical|dental|physio|clinic|doctor|\bgp\b|health/.test(t)) {
    return "Medical, dental or physio";
  }
  if (/gym|fitness|yoga|pilates/.test(t)) return "Gym or fitness";
  if (/retail|shop|boutique|store/.test(t)) return "Retail shop";
  if (/clean/.test(t)) return "Cleaning or home services";
  if (/event|photo|wedding/.test(t)) return "Events or photography";
  if (/lawyer|account|consult|professional|insurance|estate/.test(t)) {
    return "Professional services";
  }
  return "Other";
}

const LOOK_BY_KEY = {
  "Maker or fabricator": "maker",
  "Mechanic or panel beater": "workshop",
  Barber: "barber",
  "Hair or beauty salon": "salon",
  "Nail salon": "salon",
  "Restaurant, cafe or takeaway": "food",
  "Plumber, electrician or other trade": "trade",
  "Retail shop": "shop",
  "Medical, dental or physio": "trust",
  "Professional services": "trust",
  "Events or photography": "showcase",
  "Gym or fitness": "fitness",
  "Cleaning or home services": "clean",
  Other: "studio",
};

const FONT_SETS = {
  maker: ["family=Oswald:wght@500;600;700", "family=Figtree:wght@400;500;600;700"],
  workshop: ["family=Barlow+Condensed:wght@600;700", "family=Barlow:wght@400;500;600"],
  barber: ["family=Oswald:wght@500;600;700", "family=Figtree:wght@400;500;600"],
  salon: ["family=Fraunces:opsz,wght@9..144,560;9..144,680", "family=Outfit:wght@400;500;600"],
  food: ["family=Fraunces:opsz,wght@9..144,560;9..144,680", "family=Nunito+Sans:wght@400;600;700"],
  trade: ["family=Outfit:wght@400;500;700;800"],
  shop: ["family=Sora:wght@500;600;700", "family=Outfit:wght@400;500;600"],
  trust: ["family=Literata:opsz,wght@7..72,560;7..72,680", "family=Source+Sans+3:wght@400;600;700"],
  showcase: ["family=Instrument+Serif:ital@0;1", "family=Figtree:wght@400;500;600"],
  fitness: ["family=Oswald:wght@500;600;700", "family=Figtree:wght@400;500;600"],
  clean: ["family=Outfit:wght@400;500;600;700"],
  studio: ["family=Fraunces:opsz,wght@9..144,560;9..144,680", "family=Figtree:wght@400;500;600"],
};

const FONT_NAMES = {
  maker: ["Oswald", "Figtree"],
  workshop: ["Barlow Condensed", "Barlow"],
  barber: ["Oswald", "Figtree"],
  salon: ["Fraunces", "Outfit"],
  food: ["Fraunces", "Nunito Sans"],
  trade: ["Outfit", "Outfit"],
  shop: ["Sora", "Outfit"],
  trust: ["Literata", "Source Sans 3"],
  showcase: ["Instrument Serif", "Figtree"],
  fitness: ["Oswald", "Figtree"],
  clean: ["Outfit", "Outfit"],
  studio: ["Fraunces", "Figtree"],
};

export function effectiveType(type, briefText) {
  const look = formatLook(type).look;
  const text = String(briefText || "").toLowerCase();
  if (
    look === "trade" &&
    /steel|fabricat|weld|bush\s?bar|4x4|cattle|game view|pipe ?work|furniture|timber|metalwork/.test(text)
  ) {
    return "Maker or fabricator";
  }
  return type;
}

export function formatLook(type) {
  const key = resolveFormat(type).key;
  const look = LOOK_BY_KEY[key] || "studio";
  const names = FONT_NAMES[look] || FONT_NAMES.studio;
  const query = (FONT_SETS[look] || FONT_SETS.studio).join("&");
  return {
    look: look,
    key: key,
    display: names[0],
    text: names[1],
    fontHref: "https://fonts.googleapis.com/css2?" + query + "&display=swap",
  };
}

export function resolveFormat(type) {
  const raw = String(type || "").trim();
  const key = FORMATS[raw] ? raw : fuzzyKey(raw);
  const found = FORMATS[key] || FORMATS.Other;
  return Object.assign({ value: raw || key, key: key }, found);
}

export function formatPlaybook(type) {
  const f = resolveFormat(type);
  const client = f.value && f.value !== f.key ? " (client said: " + f.value + ")" : "";
  return [
    "Site format: " + f.title + client,
    f.look,
    "Must-have sections (reshape the starter to this order, then contact):",
    f.sections.map(function (s) {
      return "- " + s;
    }).join("\n"),
    f.avoid,
    "If they sell items (nail products, food, parts, merch), keep a Shop / Menu / Products section separate from services. A salon can have treatments AND a product shelf. Hide Shop if they do not sell items.",
    "Seeded look class: look-" + formatLook(type).look + ". Colours, logo, and photos are already theirs. Redesign around this business.",
    "Each finished piece is one job. The starter lists one photo per job. Open every Kept photo in PHOTO-PICKS.md and merge different angles of the same piece into that job. A different piece stays a different job.",
    "Rename nav labels to match this trade. Add or drop starter sections as needed. Keep a single index.html.",
  ].join("\n");
}

export function formatMarkdown(type) {
  return [
    "# Site format",
    "",
    formatPlaybook(type),
    "",
    "This file is the layout playbook. Follow it when customizing the starter.",
    "",
  ].join("\n");
}
