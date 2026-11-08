# Releasing the npm package

`packages/mcp` is published to npm as [`1040kit`](https://www.npmjs.com/package/1040kit). The plugins run it with `npx -y 1040kit`, so a release is what users get the next time their assistant starts 1040kit.

The package is a single bundle, `dist/bin.js` (built by `pnpm --filter 1040kit build` with esbuild). The private `@1040kit/engine` is inlined into it. Everything in `dependencies` (the MCP SDK, tesseract.js and its English model, pdf-lib, unpdf, ext-apps, zod, csv-parse) stays a normal npm dependency, because OCR and the widget read files from those packages at run time. The IRS PDFs and field maps ship in `assets/`.

`pnpm --filter 1040kit test:pack` checks the real thing: it packs the tarball, installs it into an empty folder outside the workspace, starts the installed `1040kit` bin over stdio and drives it (tools list, widget, OCR, form filling). CI runs it on every PR.

## One-time setup on npmjs.com (owner)

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): the release workflow authenticates with GitHub's OIDC token, so no npm token is stored in GitHub.

1. Sign in to npmjs.com as `triplerainbow` (the owner of `1040kit`).
2. Open https://www.npmjs.com/package/1040kit/access.
3. Under **Trusted Publisher**, choose **GitHub Actions** and enter:
   - Organization or user: `triple-rainbow`
   - Repository: `1040kit-plugin`
   - Workflow filename: `release.yml`
   - Environment: `npm`
4. Turn on **direct publishing** for this configuration. New trusted publishers can only stage a release by default, and `npm publish` from the workflow then fails with `403 ... OIDC permission denied for this action`.
5. Save. Then, on the same page under **Publishing access**, pick **Require two-factor authentication and disallow tokens**, so only the workflow (or you with 2FA) can publish.

On GitHub, create the `npm` environment (Settings → Environments → New environment, name `npm`). Optionally limit it to tags matching `v*` and add yourself as a required reviewer, so every publish waits for your approval.

## Cutting a release

1. In a PR, bump `version` in `packages/mcp/package.json` and `SERVER_VERSION` in `packages/mcp/src/server.ts` (the pack test fails if they differ). Merge it.
2. Tag the merge commit on `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. The **Release** workflow checks that the tag matches the package version, runs every test, packs and publishes with provenance. Check the result at https://www.npmjs.com/package/1040kit.

`0.1.0` (2026-11-08) is the first working release; `0.0.1` was a README-only placeholder.
