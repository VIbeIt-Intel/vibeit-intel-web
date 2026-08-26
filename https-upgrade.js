(function () {
  var host = String(location.hostname || "").toLowerCase();
  if (
    location.protocol === "http:" &&
    (host === "vibeit-intel.net" || host === "www.vibeit-intel.net")
  ) {
    location.replace(
      "https://vibeit-intel.net" +
        location.pathname +
        location.search +
        location.hash
    );
  }
})();
