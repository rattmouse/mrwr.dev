"use client";

import React, { useState } from "react";
import { Anchor, Frame, ScrollView } from "react95";
import { PROJECTS } from "@/lib/projects";
import useImagePreview from "@/components/common/useImagePreview";
import { Layout } from "@/components/windows/windowTypes";

type ProjectListProps = {
  layout: Layout;
};

const SELECTED_BG = "#000080";

/**
 * The Projects window content: the things I actually built, each linking to
 * its repository or its own page. A closed-source one with neither opens its
 * own screenshot instead. The interface demos live in their own window
 * (demos.txt).
 */
export default function ProjectList({ layout }: ProjectListProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const { openImage, previewLayer } = useImagePreview({});
  const isMax = layout === "maximized";
  const thumbWidth = isMax ? 128 : 72;
  const thumbHeight = Math.round((thumbWidth * 10) / 16);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 auto", minHeight: 0 }}>
      <Frame variant="well" style={{ padding: "6px 8px", background: "#fff", lineHeight: 1.45 }}>
        things I actually built and use — most of them <b>open source</b>. client work stays private;
        the interface demos are in <b>demos.txt</b>.
      </Frame>

      <ScrollView style={{ flex: "1 1 auto", minHeight: 0, background: "#fff" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {PROJECTS.map((project) => {
            const selected = activeSlug === project.slug;
            // A project with a repo or a page of its own is a link out. One
            // with neither — closed source, nothing public to visit — opens
            // its screenshot instead, so there's still something to look at.
            const shot = project.href ? null : project.shot;
            const Row = project.href ? "a" : shot ? "button" : "div";
            const rowProps = project.href
              ? { href: project.href, target: "_blank", rel: "noreferrer" }
              : shot
                ? { type: "button" as const, onClick: () => openImage(shot) }
                : {};
            return (
              <li key={project.slug}>
                <Row
                  {...rowProps}
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
                    // A <button> brings its own chrome and centred text along.
                    border: "none",
                    textAlign: "left",
                    font: "inherit",
                    cursor: "pointer",
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
                        {project.closedSource ? "closed source" : "github"}
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
                </Row>
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

      {previewLayer}
    </div>
  );
}
