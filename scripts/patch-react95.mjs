#!/usr/bin/env node
// postinstall: make react95's Slider work on React 19.
//
// react95 4.x's useIsFocusVisible hook (used by Slider) calls
// ReactDOM.findDOMNode(instance), which React 19 removed — rendering a Slider
// throws "findDOMNode is not a function". The hook only ever gets the slider's
// own DOM element, so findDOMNode was an identity call there; this rewrites it
// to use the element directly. Idempotent, and a no-op if react95 is missing
// or a future release no longer has the call.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hookDir = join(root, "node_modules/react95/dist/common/hooks");

const patches = [
  ["useIsFocusVisible.mjs", "const node = findDOMNode(instance);"],
  ["useIsFocusVisible.js", "const node = reactDom.findDOMNode(instance);"],
];

for (const [file, call] of patches) {
  const path = join(hookDir, file);
  if (!existsSync(path)) continue;
  const src = readFileSync(path, "utf8");
  if (!src.includes(call)) continue;
  writeFileSync(
    path,
    src.replace(call, "const node = instance;").replace("import { findDOMNode } from 'react-dom';\n", ""),
  );
  console.log(`patch-react95: ${file} no longer calls findDOMNode`);
}
