#!/usr/bin/env node
// Refresh src/data/projects.json — build-time enrichment for the Projects
// window. For every project in src/data/projects.base.json that names a
// `ghRepo`, this pulls the repo's GitHub description and the first image in
// its README, downloads that image into public/projects/remote/, and writes
// a `{ [slug]: { description, image } }` map.
//
// Both outputs are gitignored and read only at build time — the site never
// calls GitHub at runtime. src/lib/projects.ts merges this over the local
// fallbacks in projects.base.json, so a missing or partial file just means
// the site shows the local blurb + /projects/thumbs/<slug>.webp.
//
// scripts/deploy/deploy.sh runs this before every build (best-effort). Run
// it by hand to make `npm run dev` / a local build pick up new metadata.
//
// Needs the `gh` CLI, authenticated (`gh auth status`).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE_PATH = resolve(ROOT, "src/data/projects.base.json");
const OUT_PATH = resolve(ROOT, "src/data/projects.json");
const REMOTE_DIR = resolve(ROOT, "public/projects/remote");
const REMOTE_PUBLIC = "/projects/remote";

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

async function gh(args) {
  const { stdout } = await execFileP("gh", args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

/** First image reference in a README — markdown `![](url)` or an <img src>. */
function firstReadmeImage(md) {
  const mdMatch = md.match(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/);
  if (mdMatch) return mdMatch[1];
  const imgMatch = md.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];
  return null;
}

/** Resolve a README-relative image path to a raw.githubusercontent.com URL. */
function toAbsoluteImageUrl(ref, repo, branch) {
  if (/^https?:\/\//i.test(ref)) return ref;
  const clean = ref.replace(/^\.?\//, "");
  return `https://raw.githubusercontent.com/${repo}/${branch}/${clean}`;
}

async function fetchRepoMeta(repo) {
  const meta = JSON.parse(await gh(["repo", "view", repo, "--json", "description,defaultBranchRef"]));
  const description = meta.description?.trim() || null;
  const branch = meta.defaultBranchRef?.name || "HEAD";

  let readme = "";
  try {
    const payload = JSON.parse(await gh(["api", `repos/${repo}/readme`]));
    readme = Buffer.from(payload.content ?? "", payload.encoding || "base64").toString("utf8");
  } catch {
    // no README, or it's inaccessible — fine, just means no remote image
  }

  const ref = readme ? firstReadmeImage(readme) : null;
  const imageUrl = ref ? toAbsoluteImageUrl(ref, repo, branch) : null;
  return { description, imageUrl };
}

async function downloadImage(url, slug) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ext = (url.match(IMG_EXT)?.[1] || "png").toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  const file = resolve(REMOTE_DIR, `${slug}.${ext}`);
  await writeFile(file, buf);
  return `${REMOTE_PUBLIC}/${slug}.${ext}`;
}

async function main() {
  const base = JSON.parse(await readFile(BASE_PATH, "utf8"));

  await rm(REMOTE_DIR, { recursive: true, force: true });
  await mkdir(REMOTE_DIR, { recursive: true });

  const out = {};
  for (const project of base) {
    if (!project.ghRepo) continue;
    const entry = { description: null, image: null };
    try {
      const { description, imageUrl } = await fetchRepoMeta(project.ghRepo);
      entry.description = description;
      if (imageUrl) {
        try {
          entry.image = await downloadImage(imageUrl, project.slug);
        } catch (err) {
          console.warn(`  ${project.slug}: image download failed (${err.message}) — using local thumb`);
        }
      }
      console.log(
        `  ${project.slug}: description ${description ? "ok" : "none"}, image ${entry.image ? "ok" : "none"}`,
      );
    } catch (err) {
      console.warn(`  ${project.slug}: GitHub lookup failed (${err.message}) — using local fallbacks`);
    }
    out[project.slug] = entry;
  }

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
