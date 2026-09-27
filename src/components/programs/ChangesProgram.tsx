"use client";

import React, { useRef } from "react";
import { Button, ScrollView } from "react95";
import ChangesTreeView, { ChangesTreeViewHandle } from "@/components/changes/ChangesTreeView";
import DesktopWindow from "@/components/windows/DesktopWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";

export default function ChangesProgram(props: ProgramProps) {
  const changesTreeRef = useRef<ChangesTreeViewHandle>(null);

  const toolbar = (
    <>
      <Button variant="menu" size="sm" title="Handmade" onClick={() => changesTreeRef.current?.filterHandmade()}>
        ✋
      </Button>
      <Button variant="menu" size="sm" title="Chat GPT" onClick={() => changesTreeRef.current?.filterChatgpt()}>
        💬
      </Button>
      <Button variant="menu" size="sm" title="Codex" onClick={() => changesTreeRef.current?.filterCodex()}>
        ⚙️
      </Button>
      <Button variant="menu" size="sm" title="Claude" onClick={() => changesTreeRef.current?.filterClaude()}>
        🧹
      </Button>
      <Button variant="menu" size="sm" title="All versions" onClick={() => changesTreeRef.current?.filterAll()}>
        🌐
      </Button>
    </>
  );

  return (
    <DesktopWindow {...windowFrame("changes", props)} toolbar={toolbar}>
      <div style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0 }}>
        <ScrollView style={{ width: "100%", height: "100%" }}>
          <ChangesTreeView ref={changesTreeRef} versions={props.versions} showFrame={false} />
        </ScrollView>
      </div>
    </DesktopWindow>
  );
}
