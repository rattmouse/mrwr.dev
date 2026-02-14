"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import LowResImageModal from "@/components/common/LowResImageModal";
import MiniImagePopup from "@/components/common/MiniImagePopup";

type UseImagePreviewOptions = {
  openImagesInNewTab?: boolean;
  modalScale?: number;
  modalForceButtonOnly?: boolean;
  modalButtonOnlyWidth?: number;
  modalFakePreviewOnly?: boolean;
  modalHideTitleBar?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type UseImagePreviewResult = {
  openImage: (url: string) => void;
  previewLayer: React.ReactNode;
};

function computeTinySize(srcW: number, srcH: number) {
  const maxW = 74;
  const maxH = 54;
  const scale = Math.min(maxW / Math.max(1, srcW), maxH / Math.max(1, srcH), 1);
  return {
    width: Math.max(20, Math.round(srcW * scale)),
    height: Math.max(20, Math.round(srcH * scale)),
  };
}

export default function useImagePreview({
  openImagesInNewTab = false,
  modalScale = 1,
  modalForceButtonOnly = false,
  modalButtonOnlyWidth,
  modalFakePreviewOnly = false,
  modalHideTitleBar = false,
  onOpenChange,
}: UseImagePreviewOptions): UseImagePreviewResult {
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [tinyModalImageUrl, setTinyModalImageUrl] = useState<string | null>(null);
  const [tinyModalLoading, setTinyModalLoading] = useState(false);
  const [tinyThumbSize, setTinyThumbSize] = useState({ width: 74, height: 54 });

  const dismissTiny = useCallback(() => {
    setTinyModalImageUrl(null);
    setTinyModalLoading(false);
  }, []);

  const openImage = useCallback(
    (url: string) => {
      if (openImagesInNewTab) {
        setTinyModalLoading(true);
        setTinyModalImageUrl(null);
        const img = new Image();
        img.onload = () => {
          const srcW = img.naturalWidth || img.width || 1;
          const srcH = img.naturalHeight || img.height || 1;
          setTinyThumbSize(computeTinySize(srcW, srcH));
          setTinyModalImageUrl(url);
          setTinyModalLoading(false);
        };
        img.onerror = () => {
          setTinyThumbSize({ width: 74, height: 54 });
          setTinyModalImageUrl(url);
          setTinyModalLoading(false);
        };
        img.src = url;
        return;
      }
      setPreviewImageUrl(url);
    },
    [openImagesInNewTab]
  );

  useEffect(() => {
    onOpenChange?.(previewImageUrl !== null || tinyModalImageUrl !== null || tinyModalLoading);
    return () => onOpenChange?.(false);
  }, [onOpenChange, previewImageUrl, tinyModalImageUrl, tinyModalLoading]);

  const previewLayer = useMemo(
    () => (
      <>
        <LowResImageModal
          imageUrl={previewImageUrl}
          onClose={() => setPreviewImageUrl(null)}
          sizeScale={modalScale}
          forceButtonOnly={modalForceButtonOnly}
          buttonOnlyWidth={modalButtonOnlyWidth}
          fakePreviewOnly={modalFakePreviewOnly}
          hideTitleBar={modalHideTitleBar}
        />
        <MiniImagePopup
          imageUrl={tinyModalImageUrl}
          loading={tinyModalLoading}
          width={tinyThumbSize.width}
          height={tinyThumbSize.height}
          onDismiss={dismissTiny}
        />
      </>
    ),
    [
      dismissTiny,
      modalButtonOnlyWidth,
      modalFakePreviewOnly,
      modalForceButtonOnly,
      modalHideTitleBar,
      modalScale,
      previewImageUrl,
      tinyModalImageUrl,
      tinyModalLoading,
      tinyThumbSize.height,
      tinyThumbSize.width,
    ]
  );

  return { openImage, previewLayer };
}
