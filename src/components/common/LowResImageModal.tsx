"use client";

import React, { useEffect, useState } from "react";
import { Button, Window, WindowContent, WindowHeader } from "react95";

type LowResImageModalProps = {
  imageUrl: string | null;
  onClose: () => void;
};

export default function LowResImageModal({ imageUrl, onClose }: LowResImageModalProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setPreviewUrl(null);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";

    img.onload = () => {
      if (cancelled) return;

      try {
        const maxSample = 96;
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
  }, [imageUrl]);

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
      <Window
        onClick={(event) => event.stopPropagation()}
        style={{ width: "min(82vw, 420px)", maxHeight: "85vh", display: "flex", flexDirection: "column" }}
      >
        <WindowHeader style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>image preview (low-res)</span>
          <Button square size="sm" onClick={onClose} aria-label="Close image preview">
            <span className="close-icon" />
          </Button>
        </WindowHeader>
        <WindowContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <img
            src={previewUrl ?? imageUrl}
            alt="Low-resolution preview"
            style={{
              width: "100%",
              height: "auto",
              imageRendering: "pixelated",
              border: "1px solid #808080",
              background: "#000",
            }}
          />
          <a href={imageUrl} target="_blank" rel="noreferrer">
            open original
          </a>
        </WindowContent>
      </Window>
    </div>
  );
}
