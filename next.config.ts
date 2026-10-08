import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A stamp for this build's trees.exe data (public/trees/, refreshed by
 * deploy.sh just before the build): its files' names, sizes and times,
 * hashed. trees.exe asks for every file with it on the end, so a new deploy's
 * page never gets a file its browser cached from the last one — the files
 * keep their names and are cached for an hour, and a canopy or address file
 * from before a refresh lines up with nothing in the new street trees.
 */
function treesDataStamp(): string {
  const dir = join(process.cwd(), "public/trees");
  try {
    const hash = createHash("sha256");
    for (const name of readdirSync(dir).sort()) {
      const { size, mtimeMs } = statSync(join(dir, name));
      hash.update(`${name}:${size}:${Math.round(mtimeMs)};`);
    }
    return hash.digest("hex").slice(0, 12);
  } catch {
    return "none";
  }
}

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  compiler: {
    styledComponents: true,
  },
  env: {
    NEXT_PUBLIC_TREES_DATA: treesDataStamp(),
  },
};

export default nextConfig;
