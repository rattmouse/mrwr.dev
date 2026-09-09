export type Project = {
  /** Basename of the preview image at /projects/thumbs/<slug>.webp. */
  slug: string;
  name: string;
  /** What kind of thing it is — shown next to the name. */
  kind: string;
  blurb: string;
  /** What it is made of. */
  built: string;
  /** Where the code lives. */
  repo: string;
};

/**
 * Real, public projects — the things that are actually mine, as opposed to the
 * interface demos under /mockups. Each entry links out to its repository and
 * has a small preview at /projects/thumbs/<slug>.webp.
 */
export const PROJECTS: Project[] = [
  {
    slug: "cairn",
    name: "cairn",
    kind: "local-first notes editor",
    blurb: "Note list, markdown source, live preview. A folder of .md files is the whole data model.",
    built: "Python standard library · vanilla JS",
    repo: "https://github.com/rattmouse/cairn",
  },
];
