const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const OUT_DIR = path.join(__dirname, "out");

// Serve Next exported static assets
app.use(express.static(OUT_DIR, {
  extensions: ["html"],
  etag: true,
  maxAge: "1h",
}));

// SPA-ish fallback: serve index.html for non-file routes
app.get("*", (req, res) => {
  res.sendFile(path.join(OUT_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Serving static site from ${OUT_DIR} on http://localhost:${PORT}`);
});
