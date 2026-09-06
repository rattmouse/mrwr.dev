"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Anchor, GroupBox, Hourglass, ScrollView } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import { DocumentWindowId, Layout } from "@/components/windows/windowTypes";

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

type AlbumTilePosition = {
  x: number;
  y: number;
  rot: number;
};

const ALBUM_COVERS: AlbumCover[] = [
  // Fallback when /public/collections/content.json is missing.
];
const EMPTY_ALBUM: AlbumCover = { title: "no albums found", artist: "collections/content.json", image: null };

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

function normalizeAlbumsPayload(payload: unknown): AlbumCover[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      title: typeof entry.title === "string" ? entry.title.trim() : "",
      artist: typeof entry.artist === "string" ? entry.artist.trim() : "",
      image: typeof entry.image === "string" && entry.image.trim() ? entry.image.trim() : null,
    }))
    .filter((entry) => entry.title.length > 0 && entry.artist.length > 0);
}

function buildScatterPositions(count: number, width: number, height: number, iconSize: number): AlbumTilePosition[] {
  const minX = 6;
  const minY = 6;
  const maxX = Math.max(minX, width - iconSize - 6);
  const maxY = Math.max(minY, height - iconSize - 6);
  const rand = (min: number, max: number) => min + Math.random() * Math.max(0, max - min);
  return Array.from({ length: count }, (_, index) => {
    return {
      x: rand(minX, maxX),
      y: rand(minY, maxY),
      rot: rand(-8, 8),
    };
  });
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
    id === "about" ? "about.txt" : id === "contact" ? "contact.txt" : id === "collections" ? "collections.exe" : "projects.txt";
  const titleIcon = id === "collections" ? "../w98_collections_cards.ico" : "../w95_default.ico";
  const album = albums[activeAlbum] ?? ALBUM_COVERS[0] ?? EMPTY_ALBUM;
  const albumSize = layout === "maximized" ? 280 : 144;
  const albumImage = getSizedCover(album.image, layout === "maximized" ? "high" : "low");
  const iconSize = layout === "maximized" ? 58 : 42;
  const shouldCenterSelection = layout === "normal";
  const albumsSceneRef = useRef<HTMLDivElement | null>(null);
  const [albumsSceneSize, setAlbumsSceneSize] = useState({ width: 0, height: 0 });
  const [albumTilePositions, setAlbumTilePositions] = useState<AlbumTilePosition[]>([]);
  const albumTilePositionsRef = useRef<AlbumTilePosition[]>([]);
  const albumTileHomePositionsRef = useRef<AlbumTilePosition[]>([]);
  const albumTileVelocityRef = useRef<number[]>([]);
  const previousActiveAlbumRef = useRef<number>(0);
  const draggingAlbumIndexRef = useRef<number | null>(null);
  const draggingOffsetRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (id !== "collections") return;
    let cancelled = false;
    setAlbumsLoading(true);
    setActiveAlbum(0);

    async function resolveCover(entry: AlbumCover): Promise<AlbumCover> {
      const verifyImage = async (url: string): Promise<boolean> => {
        return new Promise((resolve) => {
          const probe = new Image();
          const timeout = window.setTimeout(() => resolve(false), 7000);
          probe.onload = () => {
            window.clearTimeout(timeout);
            resolve(true);
          };
          probe.onerror = () => {
            window.clearTimeout(timeout);
            resolve(false);
          };
          probe.src = url;
        });
      };

      try {
        if (entry.image) {
          const preferred = getSizedCover(entry.image, "low") ?? entry.image;
          const ok = await verifyImage(preferred);
          return ok ? entry : { ...entry, image: null };
        }

        const query = `releasegroup:"${entry.title}" AND artist:"${entry.artist}"`;
        const url = `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=1`;
        const response = await fetch(url);
        if (!response.ok) return entry;
        const payload = (await response.json()) as { "release-groups"?: Array<{ id?: string }> };
        const releaseGroupId = payload["release-groups"]?.[0]?.id;
        if (!releaseGroupId) return entry;
        const resolvedImage = `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`;
        const ok = await verifyImage(getSizedCover(resolvedImage, "low") ?? resolvedImage);
        if (!ok) return entry;
        return {
          ...entry,
          image: resolvedImage,
        };
      } catch {
        return entry;
      }
    }

    async function loadAlbums() {
      try {
        let sourceAlbums = ALBUM_COVERS;
        try {
          const privateResponse = await fetch("/collections/content.json", { cache: "no-store" });
          if (privateResponse.ok) {
            const privatePayload = (await privateResponse.json()) as unknown;
            const parsedPrivate = normalizeAlbumsPayload(privatePayload);
            if (parsedPrivate.length > 0) {
              sourceAlbums = parsedPrivate;
            }
          }
        } catch {
          // fall through to bundled fallback list
        }

        const shuffled = shuffleAlbums(sourceAlbums);
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
    albumTilePositionsRef.current = albumTilePositions;
  }, [albumTilePositions]);

  useEffect(() => {
    if (id !== "collections") return;
    const node = albumsSceneRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setAlbumsSceneSize({ width: rect.width, height: rect.height });
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [id]);

  const centerTilePosition = useMemo(
    () => ({
      x: Math.max(0, Math.round((albumsSceneSize.width - iconSize) / 2)),
      y: Math.max(0, Math.round((albumsSceneSize.height - iconSize) / 2)),
    }),
    [albumsSceneSize.height, albumsSceneSize.width, iconSize]
  );

  useEffect(() => {
    if (id !== "collections" || albumsLoading || albums.length === 0) return;
    const width = Math.max(1, albumsSceneSize.width);
    const height = Math.max(1, albumsSceneSize.height);
    const scattered = buildScatterPositions(albums.length, width, height, iconSize);
    let nearest = 0;
    let nearestDist = Number.POSITIVE_INFINITY;
    const sceneCenterX = width / 2;
    const sceneCenterY = height / 2;
    scattered.forEach((pos, index) => {
      const iconCenterX = pos.x + iconSize / 2;
      const iconCenterY = pos.y + iconSize / 2;
      const dist = Math.hypot(iconCenterX - sceneCenterX, iconCenterY - sceneCenterY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = index;
      }
    });
    setActiveAlbum(nearest);
    const positioned = scattered.map((pos, index) =>
      shouldCenterSelection && index === nearest
        ? {
            ...pos,
            x: centerTilePosition.x,
            y: centerTilePosition.y,
            rot: 0,
          }
        : pos
    );
    albumTileHomePositionsRef.current = scattered;
    albumTileVelocityRef.current = Array.from({ length: scattered.length }, () => 0);
    previousActiveAlbumRef.current = nearest;
    setAlbumTilePositions(positioned);
  }, [albums, albumsLoading, albumsSceneSize.height, albumsSceneSize.width, centerTilePosition.x, centerTilePosition.y, iconSize, id, shouldCenterSelection]);

  useEffect(() => {
    if (id !== "collections" || albumTilePositions.length === 0 || activeAlbum < 0 || activeAlbum >= albumTilePositions.length) return;
    if (draggingAlbumIndexRef.current === activeAlbum) return;
    setAlbumTilePositions((prev) => {
      const prevActive = previousActiveAlbumRef.current;
      return prev.map((pos, index) => {
        if (index === activeAlbum) {
          if (!shouldCenterSelection) return pos;
          return {
            ...pos,
            x: centerTilePosition.x,
            y: centerTilePosition.y,
            rot: 0,
          };
        }
        if (index === prevActive && prevActive !== activeAlbum) {
          const home = albumTileHomePositionsRef.current[index];
          if (home) {
            return {
              ...pos,
              x: home.x,
              y: home.y,
              rot: home.rot,
            };
          }
        }
        return pos;
      });
    });
    previousActiveAlbumRef.current = activeAlbum;
  }, [activeAlbum, albumTilePositions.length, centerTilePosition.x, centerTilePosition.y, id, shouldCenterSelection]);

  useEffect(() => {
    if (id !== "collections" || layout !== "normal" || albumsLoading || albumTilePositions.length === 0) return;

    let raf = 0;
    const floorY = () => Math.max(6, albumsSceneSize.height - iconSize - 6);
    const GRAVITY = 0.42;
    const BOUNCE = 0.24;
    const STOP_EPS = 0.08;

    const step = () => {
      if (draggingAlbumIndexRef.current !== null) {
        raf = window.requestAnimationFrame(step);
        return;
      }

      const floor = floorY();
      let changed = false;
      setAlbumTilePositions((prev) => {
        const next = prev.map((pos, index) => {
          let vy = albumTileVelocityRef.current[index] ?? 0;
          let y = pos.y;

          if (y < floor || Math.abs(vy) > STOP_EPS) {
            vy += GRAVITY;
            y += vy;
            if (y >= floor) {
              y = floor;
              vy = -vy * BOUNCE;
              if (Math.abs(vy) < STOP_EPS) vy = 0;
            }
            changed = changed || Math.abs(y - pos.y) > 0.01;
          } else if (y !== floor) {
            y = floor;
            vy = 0;
            changed = true;
          }

          albumTileVelocityRef.current[index] = vy;
          const updated = y === pos.y ? pos : { ...pos, y };
          const currentHome = albumTileHomePositionsRef.current[index] ?? updated;
          albumTileHomePositionsRef.current[index] = { ...currentHome, x: updated.x, y: updated.y, rot: updated.rot };
          return updated;
        });
        return changed ? next : prev;
      });

      raf = window.requestAnimationFrame(step);
    };

    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [albumTilePositions.length, albumsLoading, albumsSceneSize.height, iconSize, id, layout]);

  const clampTilePosition = (x: number, y: number) => {
    const minX = 6;
    const minY = 6;
    const maxX = Math.max(minX, albumsSceneSize.width - iconSize - 6);
    const maxY = Math.max(minY, albumsSceneSize.height - iconSize - 6);
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    };
  };

  const isPointerOverSceneBackground = (clientX: number, clientY: number) => {
    const scene = albumsSceneRef.current;
    if (!scene) return false;
    const hit = document.elementFromPoint(clientX, clientY);
    if (!hit || !scene.contains(hit)) return false;
    const onTile = (hit as HTMLElement).closest("[data-collection-album-tile='true']");
    return !onTile;
  };

  const finishAlbumDrag = (index: number, pointerTarget: EventTarget & Element, pointerId: number) => {
    draggingAlbumIndexRef.current = null;
    draggingOffsetRef.current = null;
    try {
      (pointerTarget as Element).releasePointerCapture(pointerId);
    } catch {
      // noop
    }
    const finalPos = albumTilePositionsRef.current[index];
    if (finalPos && index !== activeAlbum) {
      const currentHome = albumTileHomePositionsRef.current[index] ?? { ...finalPos };
      albumTileHomePositionsRef.current[index] = {
        ...currentHome,
        x: finalPos.x,
        y: finalPos.y,
      };
    }
    if (!shouldCenterSelection) return;
    setAlbumTilePositions((prev) =>
      prev.map((pos, tileIndex) =>
        tileIndex === index
          ? {
              ...pos,
              x: centerTilePosition.x,
              y: centerTilePosition.y,
              rot: 0,
            }
          : pos
      )
    );
  };

  const getFallbackScatterPosition = (excludeCenter = true) => {
    const minX = 6;
    const minY = 6;
    const maxX = Math.max(minX, albumsSceneSize.width - iconSize - 6);
    const maxY = Math.max(minY, albumsSceneSize.height - iconSize - 6);
    const centerX = Math.max(1, albumsSceneSize.width) / 2;
    const centerY = Math.max(1, albumsSceneSize.height) / 2;
    const minDist = Math.max(iconSize * 1.1, 54);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const x = minX + Math.random() * Math.max(0, maxX - minX);
      const y = minY + Math.random() * Math.max(0, maxY - minY);
      if (!excludeCenter) return { x, y };
      const tileCenterX = x + iconSize / 2;
      const tileCenterY = y + iconSize / 2;
      if (Math.hypot(tileCenterX - centerX, tileCenterY - centerY) >= minDist) {
        return { x, y };
      }
    }

    return {
      x: minX + Math.random() * Math.max(0, maxX - minX),
      y: minY + Math.random() * Math.max(0, maxY - minY),
    };
  };

  const onAlbumTilePointerDown = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const sceneRect = albumsSceneRef.current?.getBoundingClientRect();
    if (!sceneRect) return;
    const pos = albumTilePositions[index];
    if (!pos) return;
    const prevActive = activeAlbum;

    if (shouldCenterSelection && prevActive !== index) {
      setAlbumTilePositions((prev) =>
        prev.map((tilePos, tileIndex) => {
          if (tileIndex !== prevActive) return tilePos;
          const home = albumTileHomePositionsRef.current[tileIndex];
          if (home) {
            return {
              ...tilePos,
              x: home.x,
              y: home.y,
              rot: home.rot,
            };
          }
          const fallback = getFallbackScatterPosition(true);
          return {
            ...tilePos,
            x: fallback.x,
            y: fallback.y,
            rot: tilePos.rot || 0,
          };
        })
      );
    }
    previousActiveAlbumRef.current = index;
    setActiveAlbum(index);

    draggingAlbumIndexRef.current = index;
    draggingOffsetRef.current = {
      x: event.clientX - sceneRect.left - pos.x,
      y: event.clientY - sceneRect.top - pos.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onAlbumTilePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const draggingIndex = draggingAlbumIndexRef.current;
    const offset = draggingOffsetRef.current;
    const sceneRect = albumsSceneRef.current?.getBoundingClientRect();
    if (draggingIndex === null || !offset || !sceneRect) return;
    const next = clampTilePosition(
      event.clientX - sceneRect.left - offset.x,
      event.clientY - sceneRect.top - offset.y
    );
    setAlbumTilePositions((prev) =>
      {
        const nextPositions = prev.map((pos, index) =>
        index === draggingIndex
          ? {
              ...pos,
              x: next.x,
              y: next.y,
            }
          : pos
        );
        return nextPositions;
      }
    );
    if (draggingIndex !== activeAlbum) {
      const currentHome = albumTileHomePositionsRef.current[draggingIndex] ?? { x: next.x, y: next.y, rot: 0 };
      albumTileHomePositionsRef.current[draggingIndex] = { ...currentHome, x: next.x, y: next.y };
    }

    if (isPointerOverSceneBackground(event.clientX, event.clientY)) {
      finishAlbumDrag(draggingIndex, event.currentTarget, event.pointerId);
    }
  };

  const onAlbumTilePointerUp = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    const draggingIndex = draggingAlbumIndexRef.current;
    if (draggingIndex === null || draggingIndex !== index) return;
    finishAlbumDrag(index, event.currentTarget, event.pointerId);
  };

  return (
    <DesktopWindow
      title={title}
      titleIcon={titleIcon}
      layout={layout}
      normalHeight={id === "collections" ? 280 : 200}
      normalWidth={id === "collections" ? 340 : undefined}
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

      {id === "collections" && (
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
          <GroupBox label="albums.gif" style={{ width: "100%", flex: "1 1 auto", minHeight: 0, padding: 4 }}>
            <div
              ref={albumsSceneRef}
              style={{
                width: "100%",
                height: "100%",
                minHeight: layout === "maximized" ? 280 : 176,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: albumSize,
                  height: albumSize,
                  transform: "translate(-50%, -50%)",
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
                  zIndex: 1,
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

              {!albumsLoading &&
                albums.map((entry, index) => {
                  const miniImage = getSizedCover(entry.image, "low");
                  const isActive = index === activeAlbum;
                  const pos = albumTilePositions[index] ?? { x: 0, y: 0, rot: 0 };
                  return (
                    <div
                      key={`${entry.artist}-${entry.title}`}
                      data-collection-album-tile="true"
                      onPointerDown={(event) => onAlbumTilePointerDown(index, event)}
                      onPointerMove={onAlbumTilePointerMove}
                      onPointerUp={(event) => onAlbumTilePointerUp(index, event)}
                      style={{
                        position: "absolute",
                        left: pos.x,
                        top: pos.y,
                        width: iconSize,
                        height: iconSize,
                        borderTop: "1px solid #fff",
                        borderLeft: "1px solid #fff",
                        borderRight: "1px solid #808080",
                        borderBottom: "1px solid #808080",
                        boxShadow: "1px 1px 0 #00000055",
                        background: miniImage ? "#111" : "#5a5a5a",
                        overflow: "hidden",
                        opacity: isActive ? 1 : 0.8,
                        outline: isActive ? "1px solid #0b5ad4" : "none",
                        transform: `rotate(${pos.rot}deg)`,
                        zIndex: isActive ? 3 : 2,
                        cursor: draggingAlbumIndexRef.current === index ? "grabbing" : "grab",
                        touchAction: "none",
                        userSelect: "none",
                      }}
                      aria-label={entry.title}
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
                  );
                })}
            </div>
          </GroupBox>
          <div style={{ textAlign: "center", minHeight: 30 }}>
            <div style={{ fontWeight: 700 }}>{album.title}</div>
            <div>{album.artist}</div>
          </div>
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
                    <Anchor href="mailto:pm@mrwr.dev" target="_blank">
                      pm@mrwr.dev
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
