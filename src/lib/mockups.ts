export type Mockup = {
  /** Basename shared by the screenshot, the thumbnail and the standalone page. */
  slug: string;
  name: string;
  /** What kind of app it is — shown next to the name. */
  kind: string;
  blurb: string;
  /** The React/Next pieces the real build would lean on. */
  built: string;
};

/**
 * Interface demos, not client work. Each entry has a standalone page under
 * /mockups/<slug> (served straight out of public/), a full-size screenshot at
 * /mockups/<slug>.png and a small preview at /mockups/thumbs/<slug>.webp.
 */
export const MOCKUPS: Mockup[] = [
  {
    slug: "01-analytics-dashboard",
    name: "Pulse",
    kind: "analytics dashboard",
    blurb: "KPI tiles, a live chart, a sortable table.",
    built: "server components · SVG charts",
  },
  {
    slug: "02-audio-workstation",
    name: "Waveform",
    kind: "live-coding studio",
    blurb: "Pattern library, code pane, live waveform.",
    built: "CodeMirror · Web Audio",
  },
  {
    slug: "03-docs-site",
    name: "Atlas",
    kind: "documentation site",
    blurb: "Sidebar, prose column, code blocks, TOC.",
    built: "MDX · static generation",
  },
  {
    slug: "04-ai-chat",
    name: "Relay",
    kind: "assistant interface",
    blurb: "Threaded chat, tool cards, context panel.",
    built: "streaming · route handlers",
  },
  {
    slug: "05-kanban-board",
    name: "Lane",
    kind: "project board",
    blurb: "Columns, labels, progress, a card mid-drag.",
    built: "drag & drop · server actions",
  },
  {
    slug: "06-storefront",
    name: "Foundry",
    kind: "storefront",
    blurb: "Hero, faceted filters, product grid.",
    built: "incremental regeneration · URL state",
  },
  {
    slug: "07-observability-console",
    name: "Tailwatch",
    kind: "live log console",
    blurb: "Log tail, query bar, trace waterfall.",
    built: "websocket tail · virtual list",
  },
  {
    slug: "08-editorial",
    name: "Longform",
    kind: "editorial layout",
    blurb: "Lead story, article grid, most-read rail.",
    built: "MDX posts · static export",
  },
  {
    slug: "09-scheduling",
    name: "Cadence",
    kind: "scheduling app",
    blurb: "Week grid, overlapping events, now-line.",
    built: "timezone-aware dates · CSS grid",
  },
];
