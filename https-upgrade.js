(function () {
  var host = String(location.hostname || "").toLowerCase();
  var path = location.pathname || "";
  var hash = location.hash || "";
  var query = location.search || "";
  try {
    var params = new URLSearchParams(query);
    if (params.has("v")) {
      params.delete("v");
      var next = params.toString();
      query = next ? "?" + next : "";
    }
  } catch (e) {}

  if (
    location.protocol === "http:" &&
    (host === "vibeit-intel.net" || host === "www.vibeit-intel.net")
  ) {
    location.replace("https://vibeit-intel.net" + path + query + hash);
    return;
  }

  if (query !== location.search) {
    history.replaceState(null, "", path + query + hash);
  }
})();
