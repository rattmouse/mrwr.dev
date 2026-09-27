"use client";

import React, { useRef, useState } from "react";
import { Button, ScrollView } from "react95";
import IssuesTreeView, { IssuesTreeViewHandle } from "@/components/issues/IssuesTreeView";
import DesktopWindow from "@/components/windows/DesktopWindow";
import { programDef } from "@/components/windows/programs";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";

export default function IssuesProgram(props: ProgramProps) {
  const { layout } = props;
  const issuesTreeRef = useRef<IssuesTreeViewHandle>(null);
  // While an issue's picture is up, the window's own buttons stand down.
  const [contentModalOpen, setContentModalOpen] = useState(false);
  const modalButtonOnlyWidth = Math.max(88, Math.round((programDef("issues").size.width ?? 280) * 0.25));

  const toolbar = (
    <>
      <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandOpen()} disabled={contentModalOpen}>
        ⚠️
      </Button>
      <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandClosed()} disabled={contentModalOpen}>
        ✅
      </Button>
      <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandAll()} disabled={contentModalOpen}>
        ➕
      </Button>
      <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.collapseAll()} disabled={contentModalOpen}>
        ➖
      </Button>
    </>
  );

  return (
    <DesktopWindow {...windowFrame("issues", props)} controlsDisabled={contentModalOpen} toolbar={toolbar}>
      <div style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0 }}>
        <ScrollView style={{ width: "100%", height: "100%" }}>
          <IssuesTreeView
            ref={issuesTreeRef}
            showFrame={false}
            onModalOpenChange={setContentModalOpen}
            modalScale={1}
            modalForceButtonOnly={false}
            modalButtonOnlyWidth={modalButtonOnlyWidth}
            modalFakePreviewOnly={false}
            openImagesInNewTab={layout === "normal"}
            modalHideTitleBar={layout === "maximized"}
            reveal={props.issueReveal}
            onRevealed={props.onIssueRevealed}
          />
        </ScrollView>
      </div>
    </DesktopWindow>
  );
}
