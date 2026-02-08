const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const OUT_DIR = path.join(__dirname, ".");

app.use(express.json());
app.use(express.static(OUT_DIR, {
    extensions: ["html"],
    etag: true,
    maxAge: "1h",
  })
);

// Fallback to index.html for “routes” (not real files)
app.get(/^(?!.*\.).*$/, (req, res) => {
  res.sendFile(path.join(OUT_DIR, "index.html"));
});

app.post("/log-search", (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ error: "Missing query" });
  }

  console.log({
    query: req.body.query,
    ip: req.ip,
    time: new Date().toISOString()
  });
  res.sendStatus(204); // No Content
});

app.listen(PORT, () => {
  console.log(`Serving ${OUT_DIR} on http://localhost:${PORT}`);
});
