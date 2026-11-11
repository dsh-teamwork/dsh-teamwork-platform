#!/usr/bin/env node
// Holds the repository's documents to the parts of the documentation standard
// (CLAUDE.md, "Documentation") that a machine can check:
//
//   layout   — docs/ holds README.md, design.md and the categories, nothing else;
//              docs/brand/ holds source artwork and no document;
//              the repository root holds no prose beyond README, CLAUDE, AGENTS, CHANGELOG
//   names    — documents are lowercase kebab-case with no date in the name
//   header   — every document opens with its title and the status line
//   history  — no version line and no revision-history section in any document
//   index    — every document is reachable from docs/README.md
//   links    — every relative markdown link resolves to a tracked file
//   privacy  — a reference to a privacy-policy section ("privacy §6", "privacy policy,
//              section 4") names a numbered heading docs/legal/privacy.md has
//   changelog — CHANGELOG.md exists, its entries are dated and newest first,
//              each says What and Upgrade, and at most one compacted
//              "Before YYYY-MM-DD" section closes it
//
// A repository may hold a second documentation tree: a top-level directory with
// its own docs/README.md (a closed edition kept beside an open one, say). Each
// such tree is held to the same rules as the root, with its own index, prose and
// changelog; only the root keeps docs/design.md, the one visual system. The
// published legal pages are required in a tree only where something publishes
// them — a tracked pull-legal.mjs inside that tree.
//
// Kept verbatim across the sibling repositories; seed is its source. It reads the
// tracked tree only (git ls-files), so a generated or ignored file can neither
// satisfy a link nor fail one, and the answer is the same locally and in CI.
//
//   node scripts/lint-docs.mjs          # exit 0 clean, 1 findings

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";

const CATEGORIES = ["prd", "tech", "adr", "ops", "legal", "brand"];
const DOCS_ROOT_FILES = ["README.md", "design.md"];
const ROOT_PROSE = ["README.md", "CLAUDE.md", "AGENTS.md", "CHANGELOG.md"];
const STATUS = /^> \*\*Status:\*\* (Draft|Plan|Current|Archived|Superseded by \S.*?)(?: — .+)? · \*\*Updated:\*\* \d{4}-\d{2}-\d{2}$/;
const ADR_STATUS = /^> \*\*Status:\*\* (Proposed|Accepted|Superseded by \S.*?)(?: — .+)? · \*\*Date:\*\* \d{4}-\d{2}-\d{2}$/;
const VERSION_LINE = /^\s*(\*\*Version\*\*|\*\*Version:\*\*|Version:)/;
const HISTORY_HEADING = /^#{1,6}\s+(?:[\d.§]+\s+)?(revision history|document history|version history|changelog|how this document changed)\s*$/i;

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0")
  .filter(Boolean);
const trackedSet = new Set(tracked);
const trackedDirs = new Set();
for (const f of tracked) for (let d = posix.dirname(f); d !== "."; d = posix.dirname(d)) trackedDirs.add(d);
const exists = (p) => p === "" || p === "." || trackedSet.has(p) || trackedDirs.has(p);

const findings = [];
const read = (f) => readFileSync(f, "utf8");
const report = (file, line, rule, detail) => findings.push({ file, line, rule, detail });

// The relative links of a markdown file, resolved against its own directory.
function linksOf(file) {
  const out = [];
  let fence = false;
  read(file).split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) return;
    for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) continue;
      let path;
      try {
        path = decodeURI(target.split("#")[0]);
      } catch {
        path = target.split("#")[0];
      }
      out.push({ line: i + 1, target, resolved: posix.normalize(posix.join(posix.dirname(file), path)).replace(/\/$/, "") });
    }
  });
  return out;
}

// The root tree, then every top-level directory that keeps its own docs/README.md.
const NESTED = [...new Set(tracked.filter((f) => /^[^/]+\/docs\/README\.md$/.test(f)).map((f) => `${f.split("/")[0]}/`))].sort();
const TREES = ["", ...NESTED];
// A file belongs to the deepest tree whose directory holds it.
const treeOf = (f) => NESTED.find((t) => f.startsWith(t)) ?? "";
let documents = 0;

for (const T of TREES) {
  const owned = tracked.filter((f) => treeOf(f) === T);
  const D = `${T}docs/`;
  const docs = owned.filter((f) => f.startsWith(D));
  const docsMd = docs.filter((f) => f.endsWith(".md"));
  const rootProse = (f) => f.startsWith(T) && !f.slice(T.length).includes("/") && ROOT_PROSE.includes(f.slice(T.length));
  documents += docsMd.length;

  // layout
  if (!trackedSet.has(`${D}README.md`)) report(`${D}README.md`, 0, "layout", "the index is missing");
  if (T === "" && !trackedSet.has("docs/design.md")) report("docs/design.md", 0, "layout", "the visual system is missing");
  const publishesLegal = owned.some((f) => posix.basename(f) === "pull-legal.mjs");
  for (const name of ["privacy.md", "terms.md"]) {
    const f = `${D}legal/${name}`;
    if (!trackedSet.has(f)) {
      if (publishesLegal) report(f, 0, "layout", `the published legal pages are rendered from ${D}legal/`);
    } else if (!/^([_*])Last updated: [A-Z][a-z]+ \d{1,2}, \d{4}\1$/m.test(read(f))) {
      report(f, 0, "header", "a legal page carries its own line: _Last updated: Month D, YYYY_");
    }
  }
  for (const f of docs) {
    const parts = f.slice(T.length).split("/");
    if (parts.length === 2 && !(T === "" ? DOCS_ROOT_FILES : ["README.md"]).includes(parts[1])) {
      report(f, 0, "layout", T === "" ? "only README.md and design.md sit at the top of docs/" : `only README.md sits at the top of ${D}`);
    } else if (parts.length > 2 && !CATEGORIES.includes(parts[1])) {
      report(f, 0, "layout", `${D}${parts[1]}/ is not a category (${CATEGORIES.join(", ")})`);
    } else if (parts[1] === "brand" && f.endsWith(".md")) {
      report(f, 0, "layout", `${D}brand/ holds source artwork; what it means is docs/design.md`);
    }
  }
  for (const f of owned) {
    const rest = f.slice(T.length);
    if (!rest.includes("/") && rest.endsWith(".md") && !ROOT_PROSE.includes(rest)) {
      report(f, 0, "layout", `${T || "the root"} holds no prose beyond ${ROOT_PROSE.join(", ")}`);
    }
  }

  // names
  for (const f of docs) {
    const parts = f.slice(D.length).split("/");
    const name = parts.pop();
    for (const dir of parts) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(dir)) report(f, 0, "names", `directory "${dir}" is not lowercase kebab-case`);
    }
    if (!name.endsWith(".md") || name === "README.md") continue;
    const stem = name.slice(0, -3);
    const isAdr = parts[0] === "adr";
    const bare = isAdr ? stem.replace(/^\d{4}-/, "") : stem;
    if (isAdr && !/^\d{4}-/.test(stem)) report(f, 0, "names", "an ADR is named NNNN-kebab-title.md");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(bare)) report(f, 0, "names", "not lowercase kebab-case");
    else if (/(^|-)(19|20)\d{2}(-\d{2})?(-|$)|(^|-)v\d+(-|$)/.test(bare)) report(f, 0, "names", "a date or version in the name");
  }

  // header
  for (const f of docsMd) {
    if (posix.basename(f) === "README.md" || f.startsWith(`${D}legal/`)) continue;
    const lines = read(f).split("\n");
    const title = lines.findIndex((l) => l.trim() !== "");
    if (title < 0 || !/^# \S/.test(lines[title])) {
      report(f, title + 1, "header", "the first line is not the title (# …)");
      continue;
    }
    let next = title + 1;
    while (next < lines.length && lines[next].trim() === "") next++;
    const adr = f.startsWith(`${D}adr/`);
    if (!(adr ? ADR_STATUS : STATUS).test(lines[next] ?? "")) {
      const want = adr
        ? "> **Status:** Proposed|Accepted|Superseded by … · **Date:** YYYY-MM-DD"
        : "> **Status:** Draft|Plan|Current|Superseded by …|Archived · **Updated:** YYYY-MM-DD";
      report(f, next + 1, "header", `expected ${want}`);
    }
  }

  // history
  for (const f of [...docsMd, ...owned.filter((t) => rootProse(t) && !t.endsWith("CHANGELOG.md"))]) {
    let fence = false;
    read(f).split("\n").forEach((line, i) => {
      if (/^\s*```/.test(line)) fence = !fence;
      if (fence) return;
      if (VERSION_LINE.test(line)) report(f, i + 1, "history", "a version line — git is the history");
      if (HISTORY_HEADING.test(line)) report(f, i + 1, "history", "a revision-history section — git is the history");
    });
  }

  // the index: every document reached from the tree's docs/README.md
  if (trackedSet.has(`${D}README.md`)) {
    const reached = new Set([`${D}README.md`]);
    const queue = [`${D}README.md`];
    while (queue.length) {
      for (const l of linksOf(queue.shift())) {
        if (!l.resolved.startsWith(D)) continue;
        const target = trackedSet.has(l.resolved) ? l.resolved : trackedSet.has(`${l.resolved}/README.md`) ? `${l.resolved}/README.md` : null;
        if (!target || reached.has(target)) continue;
        reached.add(target);
        if (posix.basename(target) === "README.md") queue.push(target);
      }
    }
    for (const f of docsMd) {
      if (!reached.has(f)) report(f, 0, "index", `not reachable from ${D}README.md`);
    }
  }

  // changelog
  const CL = `${T}CHANGELOG.md`;
  if (!trackedSet.has(CL)) {
    report(CL, 0, "changelog", `missing: ${T || "the root"} keeps a dated record of every key change`);
  } else {
    const lines = read(CL).split("\n");
    const first = lines.findIndex((l) => l.trim() !== "");
    if (lines[first] !== "# Changelog") report(CL, first + 1, "changelog", "the first line is # Changelog");
    const entries = [];
    let fence = false;
    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) fence = !fence;
      if (fence) return;
      if (line.startsWith("## ")) entries.push({ line: i + 1, heading: line, body: [] });
      else entries.at(-1)?.body.push(line);
    });
    let previous = null;
    entries.forEach((entry, i) => {
      const dated = /^## (\d{4}-\d{2}-\d{2}) — \S/.exec(entry.heading);
      const before = /^## Before (\d{4}-\d{2}-\d{2})$/.exec(entry.heading);
      if (!dated && !before) {
        report(CL, entry.line, "changelog", "a section is `## YYYY-MM-DD — what changed` or `## Before YYYY-MM-DD`");
        return;
      }
      if (before && i !== entries.length - 1) report(CL, entry.line, "changelog", "the compacted Before section is the last one");
      const date = (dated ?? before)[1];
      if (previous && date > previous) report(CL, entry.line, "changelog", `${date} is newer than the entry above it`);
      previous = date;
      if (dated) {
        for (const field of ["What", "Upgrade"]) {
          if (!entry.body.some((l) => l.startsWith(`- **${field}:**`))) {
            report(CL, entry.line, "changelog", `the entry has no "- **${field}:**" line`);
          }
        }
      }
    });
  }

  // privacy: the tree's code and documents cite its policy's sections by number
  const P = `${D}legal/privacy.md`;
  const policy = trackedSet.has(P) ? read(P) : "";
  const sections = new Set([...policy.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1])));
  const SECTION_REF = /privacy(?:\.md|\s+policy|\s+page)?[^\n]{0,60}?(?:§|sections?\s+)(\d+)/gi;
  if (sections.size) {
    for (const f of owned.filter((f) => /\.(ts|tsx|md|mdx|mjs|js|go|json|sh|ya?ml)$/.test(f))) {
      if (f === CL || f.includes("/generated/") || f.includes("node_modules/")) continue;
      if (!existsSync(f)) continue; // pnpm rename deletes files without staging the deletion
      read(f).split("\n").forEach((text, i) => {
        for (const m of text.matchAll(SECTION_REF)) {
          if (!sections.has(Number(m[1]))) report(f, i + 1, "privacy", `${P} has no section ${m[1]}`);
        }
      });
    }
  }
}

// links: every relative markdown link in the repository resolves
for (const f of tracked.filter((t) => /\.mdx?$/.test(t))) {
  for (const l of linksOf(f)) {
    if (l.resolved.startsWith("..") || !exists(l.resolved)) report(f, l.line, "links", `${l.target} does not resolve`);
  }
}

for (const { file, line, rule, detail } of findings) console.log(`${file}${line ? `:${line}` : ""}  ${rule}  ${detail}`);
if (findings.length) {
  console.error(`\n${findings.length} finding(s). The rules are the "Documentation" section of CLAUDE.md.`);
  process.exit(1);
}
console.log(`Docs OK — ${documents} documents${NESTED.length ? ` in ${TREES.length} trees` : ""}.`);
