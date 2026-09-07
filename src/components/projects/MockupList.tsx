"use client";

import React, { useState } from "react";
import { Anchor, Frame, ScrollView } from "react95";
import { MOCKUPS } from "@/lib/mockups";
import { Layout } from "@/components/windows/windowTypes";

type MockupListProps = {
  layout: Layout;
};

const SELECTED_BG = "#000080";

/**
 * The Projects window content: a list of interface demos. They are deliberately
 * *not* presented as client work — the note at the top and the "demo" tag on
 * every row say so — they exist to show what the stack builds quickly.
 */
export default function MockupList({ layout }: MockupListProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const isMax = layout === "maximized";
  const thumbWidth = isMax ? 128 : 72;
  const thumbHeight = Math.round((thumbWidth * 10) / 16);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 auto", minHeight: 0 }}>
      <Frame variant="well" style={{ padding: "6px 8px", background: "#fff", lineHeight: 1.45 }}>
        <b>not real projects</b> — client work stays private. nine interface demos, built with{" "}
        <b>Next.js</b> + <b>React</b>, to show what the stack does quickly.
      </Frame>

      <ScrollView style={{ flex: "1 1 auto", minHeight: 0, background: "#fff" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {MOCKUPS.map((mockup) => {
            const selected = activeSlug === mockup.slug;
            return (
              <li key={mockup.slug}>
                <a
                  href={`/mockups/${mockup.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  onFocus={() => setActiveSlug(mockup.slug)}
                  onBlur={() => setActiveSlug(null)}
                  onMouseEnter={() => setActiveSlug(mockup.slug)}
                  onMouseLeave={() => setActiveSlug(null)}
                  style={{
                    display: "flex",
                    gap: 7,
                    padding: "5px 6px",
                    textDecoration: "none",
                    color: selected ? "#fff" : "#000",
                    background: selected ? SELECTED_BG : "transparent",
                  }}
                >
                  <img
                    src={`/mockups/thumbs/${mockup.slug}.webp`}
                    alt=""
                    width={thumbWidth}
                    height={thumbHeight}
                    style={{ flex: "none", border: "1px solid #808080", background: "#000", objectFit: "cover" }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", marginBottom: 3 }}>
                      <b>{mockup.name}</b>{" "}
                      <span style={{ color: selected ? "#c8c8ff" : "#555" }}>— {mockup.kind}</span>{" "}
                      <span
                        style={{
                          border: `1px solid ${selected ? "#c8c8ff" : "#808080"}`,
                          padding: "0 3px",
                          fontSize: 10,
                          verticalAlign: 1,
                        }}
                      >
                        demo
                      </span>
                    </span>
                    <span style={{ display: "block", lineHeight: 1.4 }}>{mockup.blurb}</span>
                    <span
                      style={{
                        display: "block",
                        marginTop: 3,
                        fontSize: 11,
                        color: selected ? "#c8c8ff" : "#555",
                      }}
                    >
                      built with: {mockup.built}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </ScrollView>

      <div style={{ display: "flex", gap: 6, lineHeight: 1.4 }}>
        <Anchor href="/mockups/" target="_blank" rel="noreferrer">
          all nine on one page
        </Anchor>
        <span style={{ color: "#555" }}>·</span>
        <Anchor href="https://github.com/rattmouse/mrwr.dev" target="_blank" rel="noreferrer">
          this site&apos;s source
        </Anchor>
      </div>
    </div>
  );
}
