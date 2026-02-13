"use client";

import React, { useEffect, useRef, useState } from "react";
import { Anchor, GroupBox, Hourglass, ScrollView } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import { DocumentWindowId, Layout } from "@/components/windows/windowTypes";
import albumsData from "@/data/albums.json";

type DocumentWindowProps = {
  id: DocumentWindowId;
  layout: Layout;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onToggleMaximize: () => void;
};

type AlbumCover = {
  title: string;
  artist: string;
  image: string | null;
};

const ALBUM_COVERS: AlbumCover[] = [
  ...albumsData,
];

function shuffleAlbums(input: AlbumCover[]): AlbumCover[] {
  const next = [...input];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
  }
  return next;
}

function getSizedCover(image: string | null, size: "low" | "normal" | "high"): string | null {
  if (!image) return null;
  if (!image.includes("/front-500")) return image;
  if (size === "high") return image.replace("/front-500", "/front-1200");
  if (size === "low") return image.replace("/front-500", "/front-250");
  return image;
}

export default function DocumentWindow({
  id,
  layout,
  onClose,
  onMinimize,
  onRestore,
  onToggleMaximize,
}: DocumentWindowProps) {
  const [activeAlbum, setActiveAlbum] = useState(0);
  const [albums, setAlbums] = useState<AlbumCover[]>(ALBUM_COVERS);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const title =
    id === "about" ? "about.txt" : id === "contact" ? "contact.txt" : id === "albums" ? "albums.gif" : "projects.txt";
  const album = albums[activeAlbum] ?? ALBUM_COVERS[0];
  const albumSize = layout === "maximized" ? 280 : 144;
  const albumImage = getSizedCover(album.image, layout === "maximized" ? "high" : "low");
  const railThumbSize = layout === "maximized" ? 58 : 42;
  const railViewportHeight = layout === "maximized" ? railThumbSize * 4 : railThumbSize * 4;
  const railRef = useRef<HTMLDivElement | null>(null);
  const syncingScrollRef = useRef(false);

  useEffect(() => {
    if (id !== "albums") return;
    let cancelled = false;
    setAlbumsLoading(true);
    setActiveAlbum(0);

    async function resolveCover(entry: AlbumCover): Promise<AlbumCover> {
      try {
        const query = `releasegroup:"${entry.title}" AND artist:"${entry.artist}"`;
        const url = `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=1`;
        const response = await fetch(url);
        if (!response.ok) return entry;
        const payload = (await response.json()) as { "release-groups"?: Array<{ id?: string }> };
        const releaseGroupId = payload["release-groups"]?.[0]?.id;
        if (!releaseGroupId) return entry;
        return {
          ...entry,
          image: `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`,
        };
      } catch {
        return entry;
      }
    }

    async function loadAlbums() {
      try {
        const shuffled = shuffleAlbums(ALBUM_COVERS);
        const resolvedAlbums = await Promise.all(shuffled.map(resolveCover));
        if (!cancelled) setAlbums(resolvedAlbums);
      } catch (error) {
        console.error("Failed to load album covers:", error);
      } finally {
        if (!cancelled) setAlbumsLoading(false);
      }
    }

    void loadAlbums();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (id !== "albums" || albumsLoading) return;
    const rail = railRef.current;
    if (!rail) return;
    const target = rail.querySelector<HTMLElement>(`[data-album-index="${activeAlbum}"]`);
    if (!target) return;
    const desired = target.offsetTop - (rail.clientHeight / 2) + (target.clientHeight / 2);
    syncingScrollRef.current = true;
    rail.scrollTo({ top: Math.max(0, desired), behavior: "smooth" });
    window.setTimeout(() => {
      syncingScrollRef.current = false;
    }, 180);
  }, [activeAlbum, id, albumsLoading]);

  return (
    <DesktopWindow
      title={title}
      layout={layout}
      normalHeight={id === "albums" ? 280 : 200}
      normalWidth={id === "albums" ? 340 : undefined}
      onClose={onClose}
      onMinimize={onMinimize}
      onRestore={onRestore}
      onToggleMaximize={onToggleMaximize}
    >
      {id === "projects" && (
        <>
          <h1>can't share most of them</h1>
          <ul>
            <li>
              - but this one is on{" "}
              <Anchor href="https://github.com/rattmouse/mrwr.dev" target="_blank">
                GitHub
              </Anchor>
            </li>
          </ul>
        </>
      )}

      {id === "albums" && (
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <GroupBox label="collection" style={{ width: layout === "maximized" ? 88 : 66, padding: 4 }}>
              <div
                style={{
                  width: "100%",
                  height: railViewportHeight,
                  position: "relative",
                }}
              >
                <div
                  className="albums-rail-scroll"
                  ref={railRef}
                  onScroll={(event) => {
                    if (syncingScrollRef.current) return;
                    const rail = event.currentTarget;
                    const centerY = rail.scrollTop + rail.clientHeight / 2;
                    const nodes = Array.from(rail.querySelectorAll<HTMLElement>("[data-album-index]"));
                    let nearestIndex = activeAlbum;
                    let nearestDist = Number.POSITIVE_INFINITY;
                    for (const node of nodes) {
                      const indexAttr = node.dataset.albumIndex;
                      if (typeof indexAttr !== "string") continue;
                      const index = Number.parseInt(indexAttr, 10);
                      if (Number.isNaN(index)) continue;
                      const nodeCenter = node.offsetTop + node.clientHeight / 2;
                      const dist = Math.abs(nodeCenter - centerY);
                      if (dist < nearestDist) {
                        nearestDist = dist;
                        nearestIndex = index;
                      }
                    }
                    if (nearestIndex !== activeAlbum) {
                      setActiveAlbum(nearestIndex);
                    }
                  }}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    right: 8,
                    overflowY: "auto",
                    overflowX: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0,
                    padding: "2px 0",
                    scrollbarWidth: "none",
                    msOverflowStyle: "none",
                  }}
                >
                  {albumsLoading ? (
                    <Hourglass size={24} />
                  ) : (
                    albums.map((entry, index) => {
                      const miniImage = getSizedCover(entry.image, "low");
                      const isActive = index === activeAlbum;
                      const scatterX = ((index * 7) % 9) - 4;
                      const scatterY = ((index * 5) % 5) - 2;
                      const scatterR = ((index * 11) % 7) - 3;
                      return (
                        <button
                          key={`${entry.artist}-${entry.title}`}
                          data-album-index={index}
                          onClick={() => setActiveAlbum(index)}
                          style={{
                            width: railThumbSize,
                            height: railThumbSize,
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            flex: `0 0 ${railThumbSize}px`,
                            marginTop: index === 0 ? 0 : -Math.floor(railThumbSize * 0.35),
                            transform: `translate(${scatterX}px, ${scatterY}px) rotate(${scatterR}deg)`,
                          }}
                          aria-label={`Show ${entry.title}`}
                        >
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              borderTop: "1px solid #fff",
                              borderLeft: "1px solid #fff",
                              borderRight: "1px solid #808080",
                              borderBottom: "1px solid #808080",
                              boxShadow: "1px 1px 0 #00000055",
                              background: miniImage ? "#111" : "#5a5a5a",
                              overflow: "hidden",
                              opacity: isActive ? 1 : 0.75,
                              outline: isActive ? "1px solid #0b5ad4" : "none",
                              outlineOffset: 0,
                            }}
                          >
                            {miniImage && (
                              <img
                                src={miniImage}
                                alt=""
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  display: "block",
                                  objectFit: "cover",
                                  imageRendering: "pixelated",
                                }}
                              />
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </GroupBox>
            <div
              style={{
                width: albumSize,
                height: albumSize,
                boxSizing: "border-box",
                borderTop: "2px solid #fff",
                borderLeft: "2px solid #fff",
                borderRight: "2px solid #808080",
                borderBottom: "2px solid #808080",
                background: "#111",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {albumsLoading ? (
                <Hourglass size={layout === "maximized" ? 52 : 38} />
              ) : (
                <>
                  {albumImage && (
                    <img
                      src={albumImage}
                      alt={`${album.title} cover`}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  )}
                  {!album.image && (
                    <div style={{ color: "#cfcfcf", fontFamily: "monospace", fontSize: 12 }}>no cover</div>
                  )}
                </>
              )}
            </div>
          </div>
          <div style={{ textAlign: "center", minHeight: 30 }}>
            <div style={{ fontWeight: 700 }}>{album.title}</div>
            <div>{album.artist}</div>
          </div>
          <style jsx>{`
            .albums-rail-scroll::-webkit-scrollbar {
              display: none;
            }
          `}</style>
        </div>
      )}

      {(id === "about" || id === "contact") && (
        <div style={{ flex: "1 1 auto", minHeight: 0 }}>
          <ScrollView style={{ width: "100%", height: "100%" }}>
            {id === "about" && (
              <>
                <h1>web app created by Matt Rouse</h1>
                <ul>
                  <li>
                    - ui created with{" "}
                    <Anchor href="https://react95.io/" target="_blank">
                      react95
                    </Anchor>
                  </li>
                  <li>
                    - music from{" "}
                    <Anchor href="https://strudel.cc" target="_blank">
                      strudel.cc
                    </Anchor>
                  </li>
                  <li>
                    - built with{" "}
                    <Anchor href="https://nextjs.org/" target="_blank">
                      Next.js
                    </Anchor>{" "}
                    &{" "}
                    <Anchor href="https://react.dev/" target="_blank">
                      React
                    </Anchor>
                  </li>
                  <li>
                    - deployed on{" "}
                    <Anchor href="https://www.digitalocean.com/" target="_blank">
                      DigitalOcean
                    </Anchor>
                  </li>
                  <li>
                    - some help from{" "}
                    <Anchor href="https://chatgpt.com/" target="_blank">
                      Chat GPT
                    </Anchor>
                  </li>
                  <li>
                    - and a lot of help from{" "}
                    <Anchor href="https://chatgpt.com/codex/" target="_blank">
                      Codex
                    </Anchor>
                  </li>
                </ul>
              </>
            )}

            {id === "contact" && (
              <>
                <h1>contact links:</h1>
                <ul>
                  <li>
                    -{" "}
                    <Anchor href="https://t.me/rattmouse" target="_blank">
                      Telegram
                    </Anchor>
                  </li>
                  <li>
                    -{" "}
                    <Anchor href="https://signal.me/#eu/rattmouse.113" target="_blank">
                      Signal
                    </Anchor>
                  </li>
                  <li>
                    -{" "}
                    <Anchor href="mailto:rattmouse@pm.me" target="_blank">
                      rattmouse@pm.me
                    </Anchor>
                  </li>
                </ul>
                <br />
                <h1>social links:</h1>
                <ul>
                  <li>
                    -{" "}
                    <Anchor href="https://instagram.com/ratt.mouse" target="_blank">
                      Instagram
                    </Anchor>
                  </li>
                  <li>
                    -{" "}
                    <Anchor href="https://www.linkedin.com/in/rattmouse/" target="_blank">
                      LinkedIn
                    </Anchor>
                  </li>
                  <li>
                    -{" "}
                    <Anchor href="https://discord.com/channels/@rattmouse" target="_blank">
                      Discord
                    </Anchor>
                  </li>
                </ul>
                <br />
                <h1>other links:</h1>
                <ul>
                  <li>
                    -{" "}
                    <Anchor href="https://linktr.ee/ratt.mouse" target="_blank">
                      linktr.ee
                    </Anchor>
                  </li>
                </ul>
              </>
            )}
          </ScrollView>
        </div>
      )}
    </DesktopWindow>
  );
}
