"use client";

import React, { useEffect, useState } from "react";
import { Button, Hourglass, Window, WindowContent, WindowHeader } from "react95";

type LowResImageModalProps = {
  imageUrl: string | null;
  onClose: () => void;
  sizeScale?: number;
  forceButtonOnly?: boolean;
  buttonOnlyWidth?: number;
  fakePreviewOnly?: boolean;
  hideTitleBar?: boolean;
};

export default function LowResImageModal({
  imageUrl,
  onClose,
  sizeScale = 1,
  forceButtonOnly = false,
  buttonOnlyWidth,
  fakePreviewOnly = false,
  hideTitleBar = false,
}: LowResImageModalProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compactMode, setCompactMode] = useState(false);
  const [compactExpanded, setCompactExpanded] = useState(false);
  const clampedScale = Math.max(0.5, Math.min(1, sizeScale));
  const showCompactButtonOnly = forceButtonOnly || (compactMode && !compactExpanded);
  const isLoading = imageUrl !== null && previewUrl === null;

  useEffect(() => {
    const updateCompactMode = () => {
      setCompactMode(window.innerWidth < 520 || window.innerHeight < 520);
    };
    updateCompactMode();
    window.addEventListener("resize", updateCompactMode);
    return () => window.removeEventListener("resize", updateCompactMode);
  }, []);

  useEffect(() => {
    if (!imageUrl) {
      setPreviewUrl(null);
      return;
    }
    setCompactExpanded(false);

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";

    img.onload = () => {
      if (cancelled) return;

      try {
        const maxSample = Math.max(48, Math.round(96 * clampedScale));
        const longest = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height, 1);
        const scale = Math.min(1, maxSample / longest);
        const sampleW = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        const sampleH = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));

        const canvas = document.createElement("canvas");
        canvas.width = sampleW;
        canvas.height = sampleH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setPreviewUrl(imageUrl);
          return;
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, sampleW, sampleH);
        setPreviewUrl(canvas.toDataURL("image/webp", 0.72));
      } catch {
        // Fallback when CORS prevents canvas export.
        setPreviewUrl(imageUrl);
      }
    };

    img.onerror = () => {
      if (!cancelled) setPreviewUrl(imageUrl);
    };

    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [clampedScale, imageUrl]);

  if (!imageUrl) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.55)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
    >
      {fakePreviewOnly ? (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            width: `min(82vw, ${Math.max(210, Math.round(420 * clampedScale))}px)`,
            background: "#c0c0c0",
            borderTop: "2px solid #fff",
            borderLeft: "2px solid #fff",
            borderRight: "2px solid #000",
            borderBottom: "2px solid #000",
            padding: 8,
          }}
        >
          {isLoading ? (
            <div
              style={{
                width: "100%",
                height: 110,
                border: "1px solid #808080",
                background: "#c0c0c0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Hourglass size={24} />
            </div>
          ) : (
            <img
              src={previewUrl ?? imageUrl}
              alt="Low-resolution preview"
              onClick={() => window.open(imageUrl, "_blank", "noopener,noreferrer")}
              style={{
                width: "100%",
                height: "auto",
                imageRendering: "pixelated",
                border: "1px solid #808080",
                background: "#000",
                display: "block",
                cursor: "pointer",
              }}
            />
          )}
        </div>
      ) : (
        <Window
          onClick={(event) => event.stopPropagation()}
          style={{
            width: showCompactButtonOnly
              ? forceButtonOnly
                ? Math.max(88, buttonOnlyWidth ?? Math.round(420 * clampedScale))
                : Math.max(140, Math.round(190 * clampedScale))
              : `min(82vw, ${Math.max(210, Math.round(420 * clampedScale))}px)`,
            maxHeight: "85vh",
            display: "flex",
            flexDirection: "column",
          }}
        >
        {!hideTitleBar && (
          <WindowHeader style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{showCompactButtonOnly ? "image preview" : "image preview (low-res)"}</span>
            <Button square size="sm" onClick={onClose} aria-label="Close image preview">
              <span className="close-icon" />
            </Button>
          </WindowHeader>
        )}
        <WindowContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {showCompactButtonOnly ? (
            <Button
              fullWidth
              onClick={() => {
                if (forceButtonOnly) {
                  window.open(imageUrl, "_blank", "noopener,noreferrer");
                  onClose();
                  return;
                }
                setCompactExpanded(true);
              }}
            >
              open preview
            </Button>
          ) : (
            <>
              {isLoading ? (
                <div
                  style={{
                    width: "100%",
                    minHeight: 120,
                    border: "1px solid #808080",
                    background: "#c0c0c0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Hourglass size={24} />
                </div>
              ) : (
                <img
                  src={previewUrl ?? imageUrl}
                  alt="Low-resolution preview"
                  onClick={() => window.open(imageUrl, "_blank", "noopener,noreferrer")}
                  style={{
                    width: "100%",
                    height: "auto",
                    imageRendering: "pixelated",
                    border: "1px solid #808080",
                    background: "#000",
                    cursor: "pointer",
                  }}
                />
              )}
            </>
          )}
        </WindowContent>
        </Window>
      )}
    </div>
  );
}
