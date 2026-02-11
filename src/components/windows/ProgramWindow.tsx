"use client";

import React, { useRef } from "react";
import {
  Anchor,
  Button,
  ScrollView,
  Table,
  TableBody,
  TableDataCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TextInput,
} from "react95";
import IssuesTreeView, { IssuesTreeViewHandle } from "@/components/issues/IssuesTreeView";
import DesktopWindow from "@/components/windows/DesktopWindow";
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
  const treeRef = useRef<IssuesTreeViewHandle>(null);

  const title =
    id === "notepad"
      ? "notepad.exe"
      : id === "issues"
        ? "issues.exe"
        : id === "changes"
          ? "changes.exe"
        : "mrwr.dev";

  const normalHeight = id === "welcome" ? 160 : id === "changes" ? 360 : 300;

  const toolbar =
    id === "issues" ? (
      <>
        <Button variant="menu" size="sm" onClick={() => treeRef.current?.expandOpen()}>
          ⚠️
        </Button>
        <Button variant="menu" size="sm" onClick={() => treeRef.current?.expandClosed()}>
          ✅
        </Button>
        <Button variant="menu" size="sm" onClick={() => treeRef.current?.expandAll()}>
          ➕
        </Button>
        <Button variant="menu" size="sm" onClick={() => treeRef.current?.collapseAll()}>
          ➖
        </Button>
      </>
    ) : undefined;

  const visibleChanges = gitChanges;

  return (
    <DesktopWindow
      title={title}
      layout={layout}
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
            <IssuesTreeView ref={treeRef} showFrame={false} />
          </ScrollView>
        </div>
      )}

      {id === "changes" && (
        <div style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, gap: 6 }}>
          <div style={{ flex: "1 1 auto", minHeight: 0 }}>
            <ScrollView style={{ width: "100%", height: "100%" }}>
              {visibleChanges.length === 0 && <div style={{ fontSize: 11 }}>No matching commits.</div>}
              {visibleChanges.length > 0 && (
                <Table style={{ width: "100%", fontSize: 11 }}>
                  <TableHead>
                    <TableRow>
                      <TableHeadCell style={{ width: 130, textAlign: "center", whiteSpace: "nowrap" }}>
                        Date
                      </TableHeadCell>
                      <TableHeadCell style={{ width: 120, textAlign: "center", whiteSpace: "nowrap" }}>
                        Author
                      </TableHeadCell>
                      <TableHeadCell style={{ whiteSpace: "nowrap" }}>Subject</TableHeadCell>
                      <TableHeadCell style={{ width: 72, textAlign: "center", whiteSpace: "nowrap" }}>
                        Hash
                      </TableHeadCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleChanges.map((entry) => (
                      <TableRow key={entry.hash}>
                        <TableDataCell style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                          {entry.date}
                        </TableDataCell>
                        <TableDataCell style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                          {entry.author}
                        </TableDataCell>
                        <TableDataCell style={{ whiteSpace: "nowrap" }}>{entry.subject}</TableDataCell>
                        <TableDataCell style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                          {entry.shortHash}
                        </TableDataCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollView>
          </div>
        </div>
      )}
    </DesktopWindow>
  );
}
