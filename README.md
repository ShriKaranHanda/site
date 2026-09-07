# Karan's Corner

Start locally with `node scripts/serve-local.mjs`, then open http://127.0.0.1:8000.

## Favicons

Requires Node.js 22.22.2 or newer. Run `npm ci` once to install the image validators.
Download icons for the links on Around, Past and Press:

```sh
node scripts/sync-favicons.mjs
git add images/favicons
git commit -m "chore: refresh favicons"
```

The browser loads these committed PNG files from this site. Downloads use Icon Horse,
with three attempts per domain. ICO and SVG images are decoded and normalized to 32px PNGs. HTTP errors, non-image responses, corrupt images and
timeouts fail the command. If any download fails, existing icons stay untouched.

Past's project links use a `data-favicon` key because they share a domain. For these
links the downloader follows the actual page URL and discovers its declared icon,
including redirects. The icon URL does not need to be maintained manually.

Enable the versioned hook once per clone:

```sh
git config core.hooksPath .githooks
```

Every push targeting `main` downloads and validates all required icons and compares
them to the exact commit being pushed. A missing, changed or failed icon blocks the
push. Refresh and commit the icons before retrying. Other branches and branch
deletions do not run the check. The hook never changes files or creates commits.

This is a local Git hook, so it must be enabled in each clone; Git's `--no-verify`
can bypass it. Nothing here pushes or deploys automatically.

Run the offline checks with `node --test scripts/tests/*.test.mjs`.
