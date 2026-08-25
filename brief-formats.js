(function () {
  var FORMATS = [
    {
      value: "Hair or beauty salon",
      title: "Hair or beauty salon",
      hint: "Bookings, price list, team, and hair photos — not a restaurant menu.",
    },
    {
      value: "Nail salon",
      title: "Nail salon",
      hint: "Sets, fills, and nail photos. Built around booking, not food or quotes.",
    },
    {
      value: "Barber",
      title: "Barber",
      hint: "Cuts, fades, and the chair. Walk-in or book, not a spa brochure.",
    },
    {
      value: "Mechanic or panel beater",
      title: "Mechanic or panel beater",
      hint: "Workshop photos, services, and a quote or call — not a salon price list.",
    },
    {
      value: "Plumber, electrician or other trade",
      title: "Trades / maintenance",
      hint: "What you fix, where you work, and a quote. Practical, not pretty-spa.",
    },
    {
      value: "Restaurant, cafe or takeaway",
      title: "Restaurant, cafe or takeaway",
      hint: "Menu, hours, food photos, and order or reserve — not a salon layout.",
    },
    {
      value: "Medical, dental or physio",
      title: "Medical, dental or physio",
      hint: "Calm services, hours, and how to book. No flashy sales page.",
    },
    {
      value: "Gym or fitness",
      title: "Gym or fitness",
      hint: "Classes, timetable, trainers, and how to join.",
    },
    {
      value: "Retail shop",
      title: "Retail shop",
      hint: "Products and how to visit or buy, not a booking-only salon page.",
    },
    {
      value: "Professional services",
      title: "Professional services",
      hint: "What you do, who you help, then enquire. Quiet and clear.",
    },
    {
      value: "Cleaning or home services",
      title: "Cleaning or home services",
      hint: "Packages, areas you cover, and a quote. Before/after if you have photos.",
    },
    {
      value: "Events or photography",
      title: "Events or photography",
      hint: "Past work first, then packages and enquire.",
    },
    {
      value: "Other",
      title: "Something else",
      hint: "Tell us what you do. We will shape the pages around that.",
    },
  ];

  function card(item, index) {
    return (
      '<label class="brief-choice format-card">' +
      '<input type="radio" name="Business type" value="' +
      item.value +
      '"' +
      (index === 0 ? " required" : "") +
      " />" +
      '<span class="format-copy"><strong>' +
      item.title +
      "</strong><span>" +
      item.hint +
      "</span></span>" +
      "</label>"
    );
  }

  document.querySelectorAll("[data-site-formats]").forEach(function (root) {
    root.innerHTML = FORMATS.map(card).join("");
  });
})();
