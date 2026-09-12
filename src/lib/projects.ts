import BASE from "@/data/projects.base.json";
import OVERRIDES from "@/data/projects.json";

/** One project as authored in {@link BASE} (src/data/projects.base.json). */
export type ProjectSource = {
  /** Basename of the local fallback preview at /projects/thumbs/<slug>.webp. */
  slug: string;
  name: string;
  /** What kind of thing it is — shown next to the name. */
  kind: string;
  /** Local fallback description, used when GitHub has none. */
  blurb: string;
  /** What it is made of. */
  built: string;
  /** Where the code lives. Omitted for closed-source projects. */
  repo?: string;
  /** True for projects whose source isn't public — no repo, no GitHub badge. */
  closedSource?: boolean;
  /** owner/name on GitHub, used at build time to pull the description + a README image. */
  ghRepo?: string;
  /** Where the project itself lives, if it's something you can visit. Falls back to {@link repo}. */
  url?: string;
  /** Local fallback preview, used when the repo README has no image. Omit if there's nothing to show. */
  thumb?: string;
  /**
   * Full-size screenshot. A project with nowhere to link to opens this
   * instead, so the window itself is what you get to look at.
   */
  shot?: string;
};

/**
 * Build-time enrichment for a project, keyed by slug. Written by
 * scripts/content/refresh-projects.mjs from `gh` — the site never calls
 * GitHub at runtime. `null` means "GitHub had nothing, use the local
 * fallback".
 */
export type ProjectOverride = {
  /** The repo's GitHub description. */
  description?: string | null;
  /** Public path to an image pulled from the repo's README. */
  image?: string | null;
};

/** A project as the Projects window renders it — fallbacks already resolved. */
export type Project = Omit<ProjectSource, "thumb" | "shot"> & {
  /** GitHub description if there is one, otherwise the local {@link ProjectSource.blurb}. */
  blurb: string;
  /** README image if there is one, else the local {@link ProjectSource.thumb}, else nothing. */
  thumb: string | null;
  /** Where the "open" link points — the project's own URL, else its repo. Null if there's nowhere to go. */
  href: string | null;
  /** The image a linkless project opens — its {@link ProjectSource.shot}, else whatever the thumb is. */
  shot: string | null;
};

const overrides = OVERRIDES as Record<string, ProjectOverride>;

/**
 * Real, public projects — the things that are actually mine, as opposed to the
 * interface demos under /mockups. Descriptions and preview images come from
 * each repo's GitHub metadata at build time, falling back to the local values
 * in src/data/projects.base.json.
 */
export const PROJECTS: Project[] = (BASE as ProjectSource[]).map((p) => {
  const o = overrides[p.slug] ?? {};
  return {
    ...p,
    blurb: o.description?.trim() || p.blurb,
    thumb: o.image || p.thumb || null,
    href: p.url || p.repo || null,
    shot: p.shot || o.image || p.thumb || null,
  };
});
