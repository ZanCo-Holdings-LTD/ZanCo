#!/usr/bin/env node
// Stamps the shared partials into every page, or checks that they already are.
//
//   node scripts/sync-partials.mjs           rewrite pages from partials/
//   node scripts/sync-partials.mjs --check   exit 1 if any page would change
//
// Why this exists: the site is plain HTML with no build step, so the nav,
// footer and the shared part of <head> appear in every page. Hand-copying them
// is how the legal pages ended up with different nav labels and a different
// footer from the home page. The partials/ directory is now the single source
// of truth; the pages carry marker comments and this script fills them in.
//
//   <!-- partial:nav -->
//   ...replaced wholesale...
//   <!-- /partial:nav -->
//
// The Content-Security-Policy comes from _headers (the single source of truth
// for response headers) and is written into the head partial's {{csp_meta}}
// token, minus the frame-ancestors directive that browsers reject in a meta
// tag. The script also refuses inline styles, inline scripts and inline event
// handlers in any page, because the policy blocks them and a page that only
// works on a host that ignores _headers is a page that will break on the day
// the site moves.
//
// No dependencies. Node 18 or later.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const REQUIRED = ["head", "nav", "footer"];

// --- Tokens -----------------------------------------------------------------

function cspFromHeaders() {
  const text = readFileSync(join(root, "_headers"), "utf8");
  const line = text
    .split("\n")
    .find((l) => /^\s*Content-Security-Policy:/i.test(l));
  if (!line) throw new Error("_headers has no Content-Security-Policy line");
  const value = line.replace(/^\s*Content-Security-Policy:\s*/i, "").trim();
  // frame-ancestors is header-only; browsers ignore it in <meta> and warn.
  const meta = value
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !/^frame-ancestors\b/.test(d))
    .join("; ");
  return { header: value, meta };
}

const tokens = { csp_meta: cspFromHeaders().meta };

function fill(template) {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in tokens)) throw new Error(`unknown token {{${k}}}`);
    return tokens[k];
  });
}

// --- Partials ---------------------------------------------------------------

const partials = Object.fromEntries(
  readdirSync(join(root, "partials"))
    .filter((f) => f.endsWith(".html"))
    .map((f) => [
      f.replace(/\.html$/, ""),
      fill(readFileSync(join(root, "partials", f), "utf8")).replace(/\s+$/, ""),
    ]),
);

function indent(block, prefix) {
  return block
    .split("\n")
    .map((l) => (l.trim() ? prefix + l : ""))
    .join("\n");
}

function stamp(html, file) {
  const seen = new Set();
  const out = html.replace(
    /^([ \t]*)<!-- partial:(\w+) -->[\s\S]*?^[ \t]*<!-- \/partial:\2 -->/gm,
    (m, pad, name) => {
      if (!(name in partials)) throw new Error(`${file}: no partial named "${name}"`);
      seen.add(name);
      return `${pad}<!-- partial:${name} -->\n${indent(partials[name], pad)}\n${pad}<!-- /partial:${name} -->`;
    },
  );
  for (const r of REQUIRED) {
    if (!seen.has(r)) throw new Error(`${file}: missing <!-- partial:${r} --> region`);
  }
  return out;
}

// --- CSP lint ---------------------------------------------------------------

function lint(html, file) {
  const problems = [];
  if (/\sstyle\s*=\s*["']/i.test(html)) problems.push("inline style attribute");
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) problems.push("inline event handler");
  if (/<script(?![^>]*\ssrc=)[^>]*>\s*\S/i.test(html)) problems.push("inline <script>");
  if (/href\s*=\s*["']\s*javascript:/i.test(html)) problems.push("javascript: URL");
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (tag.match(/\brel=["']([^"']+)/i) || [])[1] || "";
    if (/\b(stylesheet|preload|modulepreload)\b/i.test(rel) && /\bhref=["']https?:\/\//i.test(tag)) {
      problems.push("cross-origin stylesheet or preload");
    }
  }
  if (/<script[^>]+src=["']https?:\/\//i.test(html)) problems.push("cross-origin script");
  return problems.map((p) => `${file}: ${p} (blocked by the Content-Security-Policy)`);
}

// --- Run --------------------------------------------------------------------

const pages = readdirSync(root).filter((f) => f.endsWith(".html"));
let changed = [];
let errors = [];

for (const file of pages) {
  const before = readFileSync(join(root, file), "utf8");
  let after;
  try {
    after = stamp(before, file);
  } catch (e) {
    errors.push(e.message);
    continue;
  }
  errors.push(...lint(after, file));
  if (after !== before) {
    changed.push(file);
    if (!check) writeFileSync(join(root, file), after);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
if (check) {
  if (changed.length) {
    console.error(`Out of date with partials/: ${changed.join(", ")}\nRun: node scripts/sync-partials.mjs`);
    process.exit(1);
  }
  console.log(`OK: ${pages.length} pages match partials/ and pass the CSP lint.`);
} else {
  console.log(changed.length ? `Updated: ${changed.join(", ")}` : "Nothing to update.");
}
