# ZanCo Holdings LTD — Website

The public website for **ZanCo Holdings LTD**, a UK-registered technology holding
company (Companies House No. 16938121). Live at **[zancoholdings.com](https://zancoholdings.com)**.

This is a static site — plain HTML, CSS, and a small amount of vanilla
JavaScript. There is no build step, framework, or package manager.

## Structure

```
.
├── index.html            # Homepage (about, portfolio, philosophy, contact)
├── privacy.html          # Legal & support pages
├── terms.html
├── eula.html
├── cookies.html
├── delete-account.html
├── support.html
├── css/
│   └── styles.css        # All styles; design tokens live in the :root block
├── js/
│   └── main.js           # Mobile nav toggle
├── images/               # favicon and logos
└── CNAME                 # Custom domain for GitHub Pages
```

## Local preview

No tooling required — open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Deployment

The site is hosted on **GitHub Pages**, served from the `main` branch at the
custom domain in `CNAME`. Every push to `main` triggers an automatic redeploy —
there is no separate build or release step.

## Editing notes

- Design tokens (colour, type scale, spacing, radii) are centralised in the
  `:root` block at the top of `css/styles.css`.
- The legal pages (`privacy`, `terms`, `eula`, `cookies`, `delete-account`) are
  legal documents — review content changes carefully before publishing.
