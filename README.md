# ZZS IPA Store

Personal AltStore Classic source and browser-based IPA administration panel.

## URLs
- Site: https://repo.zrh.jp/
- Admin: https://repo.zrh.jp/admin/
- AltStore source: https://repo.zrh.jp/source.json

All static site files live under `docs/`. GitHub Pages must be manually enabled under repository **Settings → Pages → Deploy from a branch → main /docs**. Custom domain: `repo.zrh.jp`, with DNS CNAME `repo → zrhtop.github.io`. Pages setting may require confirming custom domain and HTTPS separately.

## Admin authentication
The admin is a **public static page**, not a private server app. Editing requires an explicitly entered GitHub Fine-grained Personal Access Token scoped to **only this repository**, permission **Contents: Read and write**. The token is retained **only in in-memory JavaScript state**, cleared when refreshing or signing out; it is sent over HTTPS only to `api.github.com`. No token is committed, added to query parameters, stored in localStorage or transmitted to a site backend.

Create token: https://github.com/settings/personal-access-tokens/new

## Publishing an app
1. Open Admin and authenticate.
2. Select **Add app / IPA**.
3. For <=20 MiB IPA select a local file. The client-side parser attempts to read `Payload/*.app/Info.plist` and prefill app name, bundle identifier, version, build number, minimum iOS and privacy permission descriptions. **Signature entitlements cannot reliably be extracted client-side. You MUST independently verify and enter all entitlements**.
4. For large IPAs, manually upload them to this repository's GitHub Releases then paste an **HTTPS direct asset URL**. Fill in size and app details. GitHub Releases web UI is recommended over committing large binaries to Git.
5. Click publish. The admin writes the small IPA to `docs/files/` (when chosen), then automatically updates `docs/source.json` via GitHub Contents API. The latest version is always the first in its versions list.
6. AltStore Classic checks the published source and recognizes new versions after the website deploys.

**Caution**: GitHub Contents API file writes and source update are separate commits, and a failed source update could leave an unreferenced IPA. Removing versions from the source **does not delete binaries**, so you can preserve installed release links; remove unused files manually if needed. For data safety the admin loads the current source SHA and GitHub will reject conflicting source updates made meanwhile.

## Key files
- `docs/index.html` + `docs/public.js`: public catalogue
- `docs/admin/index.html` + `docs/admin/app.js`: admin editor and GitHub REST integration
- `docs/admin/ipa.js`: browser-side IPA ZIP / Info.plist metadata parser
- `docs/source.json`: AltStore Classic JSON feed
- `docs/CNAME`: custom domain
- `docs/files/`: files uploaded directly from the admin

## AltStore permissions
AltStore will verify that `appPermissions.entitlements` and `appPermissions.privacy` accurately represent your IPA. A mistaken list can prevent installations. The admin does not bypass signing, sideload installation counts or certificate expiry.

## Distribution and privacy
Everything published in this public repository or on GitHub Pages is publicly downloadable. Do not distribute IPA files without the right to do so. Avoid exposing private signing keys, profiles or device IDs.