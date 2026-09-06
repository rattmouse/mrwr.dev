#!/usr/bin/env bash
set -euo pipefail

awk '
function trim(s){ sub(/^[ \t\r\n]+/, "", s); sub(/[ \t\r\n]+$/, "", s); return s }

function unquote(s) {
  s = trim(s)
  if (substr(s,1,1)=="\047" && substr(s,length(s),1)=="\047") return substr(s,2,length(s)-2)
  if (substr(s,1,1)=="\""   && substr(s,length(s),1)=="\"")   return substr(s,2,length(s)-2)
  return s
}

function extract_quoted(text, key,   SQ, tail, quote, i, ch, pat) {
  SQ = sprintf("%c", 39) # single quote
  pat = key "[ \t]*:[ \t]*"
  if (!match(text, pat)) return ""
  tail = trim(substr(text, RSTART + RLENGTH))
  quote = substr(tail, 1, 1)
  if (quote != SQ && quote != "\"") return ""
  for (i = 2; i <= length(tail); i++) {
    ch = substr(tail, i, 1)
    if (ch == quote) return substr(tail, 2, i - 2)
  }
  return ""
}

function extract_number(text, key,   pat, tail) {
  pat = key "[ \t]*:[ \t]*"
  if (!match(text, pat)) return ""
  tail = substr(text, RSTART + RLENGTH)
  if (match(tail, /^[0-9]+/)) return substr(tail, RSTART, RLENGTH)
  return ""
}

function extract_first_quoted(text,   SQ, tail, quote, i, ch) {
  SQ = sprintf("%c", 39)
  if (!match(text, /["\047]/)) return ""
  tail = substr(text, RSTART)
  quote = substr(tail, 1, 1)
  for (i = 2; i <= length(tail); i++) {
    ch = substr(tail, i, 1)
    if (ch == quote) return substr(tail, 2, i - 2)
  }
  return ""
}

function emit_search_line(q, t, d) {
  if (q == "" || t == "") return
  gsub(/\047/, "\\047", q)
  print "- \047" q "\047 @ " t ((d != "") ? " +" d "ms" : "")
}

# Strip journalctl prefix, but DO NOT eat "query:" / "time:" inside the message.
function strip_prefix(s,   p) {
  if (s !~ /^[A-Z][a-z][a-z][[:space:]]+[ 0-9][0-9] [0-9:]{8} /) return s

  p = index(s, "]: ")
  if (p > 0) return substr(s, p + 3)

  # Fallback: strip only up to the FIRST ": " (not greedy)
  p = index(s, ": ")
  if (p > 0) return substr(s, p + 2)

  return s
}

BEGIN { in_obj=0; buf="" }

{
  line = strip_prefix($0)

  # Older direct log lines:
  # search: 'query' @ 2026-...
  # searched: 'query' @ 2026-...
  # - 'query' @ 2026-...
  if (match(line, /^[ \t]*(search|searched)[ \t]*:[ \t]*\047/)) {
    q = extract_quoted(line, "(search|searched)")
    if (match(line, /@[ \t]*[0-9]{4}-[0-9]{2}-[0-9]{2}T[^ \t\r\n]+/)) {
      t = substr(line, RSTART + 1)
      t = trim(substr(t, 1))
      d = ""
      if (match(t, /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[^ \t\r\n]+)/)) {
        ts = substr(t, RSTART, RLENGTH)
        rest = substr(t, RLENGTH + 1)
        if (match(rest, /[ \t]+(\+|Δ|delta_ms=|input_delta_ms=)[ \t]*[0-9]+[ \t]*ms/)) {
          chunk = substr(rest, RSTART, RLENGTH)
          gsub(/.*(\+|Δ|delta_ms=|input_delta_ms=)[ \t]*/, "", chunk)
          gsub(/[ \t]*ms.*/, "", chunk)
          d = chunk
        }
        emit_search_line(q, ts, d)
        next
      }
    }
  }

  if (match(line, /^[ \t]*-[ \t]*\047/)) {
    q = extract_first_quoted(line)
    if (match(line, /@[ \t]*[0-9]{4}-[0-9]{2}-[0-9]{2}T[^ \t\r\n]+/)) {
      t = substr(line, RSTART + 1)
      t = trim(substr(t, 1))
      d = ""
      if (match(t, /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[^ \t\r\n]+)/)) {
        ts = substr(t, RSTART, RLENGTH)
        rest = substr(t, RLENGTH + 1)
        if (match(rest, /[ \t]+(\+|Δ|delta_ms=|input_delta_ms=)[ \t]*[0-9]+[ \t]*ms/)) {
          chunk = substr(rest, RSTART, RLENGTH)
          gsub(/.*(\+|Δ|delta_ms=|input_delta_ms=)[ \t]*/, "", chunk)
          gsub(/[ \t]*ms.*/, "", chunk)
          d = chunk
        }
        emit_search_line(q, ts, d)
        next
      }
    }
  }

  # Multi-line object start
  if (line ~ /^[ \t]*\{[ \t]*$/) { in_obj=1; buf=""; next }

  # Multi-line object end
  if (in_obj && line ~ /^[ \t]*\}[ \t]*$/) {
    q = extract_quoted(buf, "query")
    t = extract_quoted(buf, "at")
    if (t == "") t = extract_quoted(buf, "time")
    d = extract_number(buf, "input_delta_ms")
    if (d == "") d = extract_number(buf, "delta_ms")
    emit_search_line(q, t, d)
    in_obj=0; buf=""; next
  }

  # Single-line object
  if (!in_obj && line ~ /\{[^}]*\}/) {
    q = extract_quoted(line, "query")
    t = extract_quoted(line, "at")
    if (t == "") t = extract_quoted(line, "time")
    d = extract_number(line, "input_delta_ms")
    if (d == "") d = extract_number(line, "delta_ms")
    emit_search_line(q, t, d)
    next
  }

  if (in_obj) buf = buf " " line
}
'
