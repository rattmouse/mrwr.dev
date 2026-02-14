"use client";

import React from "react";
import { Hourglass } from "react95";

type MiniImagePopupProps = {
  imageUrl: string | null;
  loading: boolean;
  width: number;
  height: number;
  onDismiss: () => void;
};

export default function MiniImagePopup({ imageUrl, loading, width, height, onDismiss }: MiniImagePopupProps) {
  if (!imageUrl && !loading) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.35)",
        zIndex: 10001,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(event) => {
          event.stopPropagation();
          if (imageUrl) {
            window.open(imageUrl, "_blank", "noopener,noreferrer");
            onDismiss();
          }
        }}
        style={{
          width: width + 8,
          height: height + 8,
          background: "#c0c0c0",
          borderTop: "2px solid #fff",
          borderLeft: "2px solid #fff",
          borderRight: "2px solid #000",
          borderBottom: "2px solid #000",
          boxSizing: "border-box",
          padding: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          cursor: "pointer",
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Image preview thumbnail"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "fill",
              imageRendering: "pixelated",
              background: "#c0c0c0",
            }}
          />
        ) : (
          <Hourglass size={20} />
        )}
      </div>
    </div>
  );
}
