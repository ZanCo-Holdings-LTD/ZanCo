# ZanCo Holdings LTD, website

The public website for **ZanCo Holdings LTD**, a UK holding company
(Companies House no. 16938121). Live at **[zancoholdings.com](https://zancoholdings.com)**.

Plain HTML, one stylesheet, one small script, two font files. No framework,
no package manager, no build step on the host.

## Layout

```
.
├── index.html             Home: about, portfolio, how we work, contact
├── support.html           Support and FAQ
├── privacy.html           Legal pages. These are legal documents: review
├── terms.html             content changes carefully before publishing.
├── eula.html
├── cookies.html
├── delete-account.html
├── 404.html
├── partials/              THE shared markup: head block, nav, footer
├── scripts/
│   ├── sync-partials.mjs  Stamps partials/ into every page; --check for CI
│   └── make-images.py     Derives every raster image from images/src/
├── css/styles.css         All styles; design tokens in the :root block
├── js/main.js             Mobile nav toggle
├── fonts/                 Inter, self-hosted (variable, latin + latin-ext)
├── images/                Served images. images/src/ holds the masters.
├── _headers               Response headers. The single source of truth for
│                          the security policy (see Security below).
├── _redirects             Hides maintainer files on Netlify / Cloudflare Pages
├── netlify.toml           Netlify config; no build, publish the root
├── robots.txt, sitemap.xml, .well-known/security.txt
└── CNAME                  Custom domain for GitHub Pages
```

## Single source of truth

Every page carries the same nav, footer and shared `<head>` block. They are
written once, in `partials/`, and copied into the pages between marker
comments:

```html
<!-- partial:nav -->
...filled in by the script...
<!-- /partial:nav -->
```

After editing anything in `partials/` or `_headers`, run:

```bash
node scripts/sync-partials.mjs
```

CI runs the same script with `--check` and fails the build if a page has
drifted from the partials, if the Content-Security-Policy meta tag no longer
matches `_headers`, or if a page contains inline styles, inline scripts or
cross-origin assets that the policy would block. Page-specific things (title,
description, canonical URL, Open Graph title) stay in each page's `<head>`.

Images follow the same rule. `images/src/` holds the hand-made masters;
everything else under `images/` is generated:

```bash
python3 scripts/make-images.py   # needs Pillow
```

## Security

The security policy lives in **`_headers`** and nowhere else. Netlify and
Cloudflare Pages read that file directly. GitHub Pages, the current host,
cannot send custom response headers, so on GitHub Pages the only enforced
part is the Content-Security-Policy `<meta>` tag that `sync-partials.mjs`
copies from `_headers` into every page. The remaining headers (HSTS,
X-Frame-Options, Referrer-Policy, Permissions-Policy and the rest) only take
effect once the site is served by a host that reads `_headers`.

The site makes no third-party requests: fonts and images are served from this
domain, and there is no analytics or embedded content.

## Local preview

Paths are root-relative, so serve the folder rather than opening a file:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Deployment

Hosted on **GitHub Pages** from the `main` branch at the domain in `CNAME`.
Every push to `main` redeploys. `.nojekyll` turns off Jekyll so that
`.well-known/` and `_headers` are published as plain files.

`netlify.toml` and `_redirects` are ready for a move to Netlify, which the
other ZanCo sites already use and which would make the full header set live.
