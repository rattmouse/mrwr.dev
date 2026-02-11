"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  Anchor,
  Button,
  ScrollView,
  TextInput,
} from "react95";
import IssuesTreeView, { IssuesTreeViewHandle } from "@/components/issues/IssuesTreeView";
import ChangesTreeView, { ChangesTreeViewHandle } from "@/components/changes/ChangesTreeView";
import DesktopWindow from "@/components/windows/DesktopWindow";
import StrudelReplWindow, { StrudelReplHandle } from "@/components/windows/StrudelReplWindow";
import { Layout, ProgramWindowId } from "@/components/windows/windowTypes";
import { GitChangeEntry } from "@/lib/gitChanges.types";

type ProgramWindowProps = {
  id: ProgramWindowId;
  layout: Layout;
  gitChanges: GitChangeEntry[];
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onToggleMaximize: () => void;
};

export default function ProgramWindow({
  id,
  layout,
  gitChanges,
  onClose,
  onMinimize,
  onRestore,
  onToggleMaximize,
}: ProgramWindowProps) {
  const issuesTreeRef = useRef<IssuesTreeViewHandle>(null);
  const changesTreeRef = useRef<ChangesTreeViewHandle>(null);
  const strudelRef = useRef<StrudelReplHandle>(null);
  const [strudelPlaying, setStrudelPlaying] = useState(false);

  const title =
    id === "notepad"
      ? "notepad.exe"
      : id === "issues"
        ? "issues.exe"
        : id === "changes"
          ? "changes.exe"
          : id === "osci"
            ? "strudel.cc"
        : "mrwr.dev";

  const normalHeight = id === "welcome" ? 160 : id === "changes" ? 360 : id === "osci" ? 220 : 300;
  const normalWidth = id === "changes" ? 320 : undefined;

  const toolbar =
    id === "issues" ? (
      <>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandOpen()}>
          ⚠️
        </Button>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandClosed()}>
          ✅
        </Button>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandAll()}>
          ➕
        </Button>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.collapseAll()}>
          ➖
        </Button>
      </>
    ) : id === "changes" ? (
      <>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.expandFeatures()}>
          ✨
        </Button>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.expandFixes()}>
          🛠️
        </Button>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.expandDocs()}>
          📝
        </Button>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.expandOther()}>
          📦
        </Button>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.expandAll()}>
          ➕
        </Button>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.collapseAll()}>
          ➖
        </Button>
      </>
    ) : id === "osci" ? (
      <>
        <Button
          variant="menu"
          size="sm"
          active={strudelPlaying}
          aria-label="Play"
          title="Play"
          onClick={() => void strudelRef.current?.play()}
        >
          Play
        </Button>
        <Button
          variant="menu"
          size="sm"
          active={!strudelPlaying}
          aria-label="Stop"
          title="Stop"
          onClick={() => void strudelRef.current?.stop()}
        >
          Stop
        </Button>
        <Button
          variant="menu"
          size="sm"
          aria-label="Update"
          title="Update"
          onClick={() => void strudelRef.current?.update()}
        >
          Update
        </Button>
        <Button
          variant="menu"
          size="sm"
          aria-label="Help"
          title="Help"
          onClick={() => window.open("https://strudel.cc/workshop/getting-started/", "_blank", "noopener,noreferrer")}
        >
          Help
        </Button>
      </>
    ) : undefined;

  return (
    <DesktopWindow
      title={title}
      layout={layout}
      normalWidth={normalWidth}
      normalHeight={normalHeight}
      onClose={onClose}
      onMinimize={onMinimize}
      onRestore={onRestore}
      onToggleMaximize={onToggleMaximize}
      toolbar={toolbar}
    >
      {id === "welcome" && (
        <div>
          coming soon…
          <br />
          you can help:
          <ul>
            <li>- found a bug? let me know!</li>
            <li>- type brief description in search bar</li>
            <li>
              - buy me a{" "}
              <Anchor href="https://buymeacoffee.com/rattmouse" target="_blank">
                ☕
              </Anchor>
            </li>
          </ul>
        </div>
      )}

      {id === "notepad" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, width: "100%", minWidth: 0 }}>
          <TextInput
            multiline
            style={{
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
              minWidth: 0,
              minHeight: 0,
            }}
          />
        </div>
      )}

      {id === "issues" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0 }}>
          <ScrollView style={{ width: "100%", height: "100%" }}>
            <IssuesTreeView ref={issuesTreeRef} showFrame={false} />
          </ScrollView>
        </div>
      )}

      {id === "changes" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0 }}>
          <ScrollView style={{ width: "100%", height: "100%" }}>
            <ChangesTreeView ref={changesTreeRef} entries={gitChanges} showFrame={false} />
          </ScrollView>
        </div>
      )}

      {id === "osci" && <StrudelReplWindow ref={strudelRef} onPlayingChange={setStrudelPlaying} />}
    </DesktopWindow>
  );
}
