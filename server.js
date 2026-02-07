const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const OUT_DIR = path.join(__dirname, ".");

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

app.listen(PORT, () => {
  console.log(`Serving ${OUT_DIR} on http://localhost:${PORT}`);
});
