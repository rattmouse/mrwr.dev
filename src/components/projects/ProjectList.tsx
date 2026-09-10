"use client";

import React, { useState } from "react";
import { Anchor, Frame, ScrollView } from "react95";
import { PROJECTS } from "@/lib/projects";
import { Layout } from "@/components/windows/windowTypes";

type ProjectListProps = {
  layout: Layout;
};

const SELECTED_BG = "#000080";

/**
 * The Projects window content: real, public projects, each linking to its
 * repository. The interface demos live in their own window (demos.txt).
 */
export default function ProjectList({ layout }: ProjectListProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const isMax = layout === "maximized";
  const thumbWidth = isMax ? 128 : 72;
  const thumbHeight = Math.round((thumbWidth * 10) / 16);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 auto", minHeight: 0 }}>
      <Frame variant="well" style={{ padding: "6px 8px", background: "#fff", lineHeight: 1.45 }}>
        <b>open source</b> — things I actually built and use. client work stays private; the interface
        demos are in <b>demos.txt</b>.
      </Frame>

      <ScrollView style={{ flex: "1 1 auto", minHeight: 0, background: "#fff" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {PROJECTS.map((project) => {
            const selected = activeSlug === project.slug;
            return (
              <li key={project.slug}>
                <a
                  href={project.href}
                  target="_blank"
                  rel="noreferrer"
                  onFocus={() => setActiveSlug(project.slug)}
                  onBlur={() => setActiveSlug(null)}
                  onMouseEnter={() => setActiveSlug(project.slug)}
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
                  {project.thumb ? (
                    <img
                      src={project.thumb}
                      alt=""
                      width={thumbWidth}
                      height={thumbHeight}
                      style={{ flex: "none", border: "1px solid #808080", background: "#000", objectFit: "cover" }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      style={{
                        flex: "none",
                        width: thumbWidth,
                        height: thumbHeight,
                        border: "1px solid #808080",
                        background: "#c0c0c0",
                        display: "grid",
                        placeItems: "center",
                        fontWeight: 700,
                        color: selected ? "#000080" : "#808080",
                      }}
                    >
                      {project.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", marginBottom: 3 }}>
                      <b>{project.name}</b>{" "}
                      <span style={{ color: selected ? "#c8c8ff" : "#555" }}>— {project.kind}</span>{" "}
                      <span
                        style={{
                          border: `1px solid ${selected ? "#c8c8ff" : "#808080"}`,
                          padding: "0 3px",
                          fontSize: 10,
                          verticalAlign: 1,
                        }}
                      >
                        github
                      </span>
                    </span>
                    <span style={{ display: "block", lineHeight: 1.4 }}>{project.blurb}</span>
                    <span
                      style={{
                        display: "block",
                        marginTop: 3,
                        fontSize: 11,
                        color: selected ? "#c8c8ff" : "#555",
                      }}
                    >
                      built with: {project.built}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </ScrollView>

      <div style={{ display: "flex", gap: 6, lineHeight: 1.4 }}>
        <Anchor href="https://github.com/rattmouse" target="_blank" rel="noreferrer">
          all repos on github
        </Anchor>
        <span style={{ color: "#555" }}>·</span>
        <Anchor href="https://github.com/rattmouse/mrwr.dev" target="_blank" rel="noreferrer">
          this site&apos;s source
        </Anchor>
      </div>
    </div>
  );
}
