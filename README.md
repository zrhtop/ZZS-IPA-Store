# ZZS IPA Store

A self-hosted AltStore Classic source and browser-based IPA management dashboard, powered by GitHub Pages. Simplified Chinese interface.

**Public website:** https://repo.zrh.jp/  
**Management page:** https://repo.zrh.jp/admin/  
**AltStore Classic source:** https://repo.zrh.jp/source.json

> The addresses are available once GitHub Pages is enabled and the custom domain resolves. The source begins with zero apps.

## Enable publishing

1. Go to [Repository Settings → Pages](https://github.com/zrhtop/ZZS-IPA-Store/settings/pages).
2. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, directory **/docs**. Click **Save**.
3. Under **Custom domain**, verify or enter **repo.zrh.jp**, then click **Save**.
4. In Cloudflare DNS for \`zrh.jp\`, use a **CNAME** record:
   - **Name:** \`repo\`
   - **Target:** \`zrhtop.github.io\`
   - **Proxy:** initially **DNS only (grey cloud)** to simplify GitHub Pages HTTPS certificate issuance.
5. Check that **Enforce HTTPS** becomes available, then enable it. DNS and certificate validation can take time.

GitHub Pages hosts the contents of the \`docs/\` folder at the root of this subdomain; \`docs/CNAME\` declares the custom hostname.

## Manage apps

1. Open **https://repo.zrh.jp/admin/** in Safari or any modern browser.
2. [Create a fine-grained GitHub Personal Access Token](https://github.com/settings/personal-access-tokens/new) with:
   - **Resource owner:** \`zrhtop\`
   - **Repository access:** Only select repositories → \`ZZS-IPA-Store\`
   - **Repository permissions:** Contents → **Read and write**
3. Paste the token on the admin page and connect.
4. Choose **Add app**, upload an IPA (up to **40 MiB** for browser direct uploads), or supply an existing **public HTTPS IPA download URL**, then fill/verify app metadata.
5. Click **Upload and publish**. The dashboard writes a new version of \`docs/source.json\` to GitHub. It also uploads small IPA files to \`docs/ipas/\`, and any extractable PNG icon to \`docs/icons/\`.
6. To publish further updates, click **New version** on the existing app. Versions are prepended so AltStore regards the first entry as the latest version.
7. Version history lets you **edit**, **delete**, or **make a historical version latest**. Removing a listing does not delete uploaded IPA binaries.

### Upload larger IPA files

GitHub repository files larger than 50 MiB are discouraged, and using the browser Contents API for them is inefficient. The dashboard deliberately caps direct uploads at 40 MiB.

For larger IPAs, [create a GitHub Release](https://github.com/zrhtop/ZZS-IPA-Store/releases/new), upload the IPA as a release asset, copy its public \`https://github.com/.../releases/download/.../...ipa\` link, and enter the exact IPA size in bytes. The dashboard then publishes the URL without re-uploading the file.

### Metadata and app permissions

The IPA inspector attempts to read \`Payload/*.app/Info.plist\` in either XML or binary property-list format. It fills the name, Bundle ID, \`CFBundleShortVersionString\`, \`CFBundleVersion\`, minimum iOS version, \`NS...UsageDescription\` entries, and a PNG icon if available. It can read embedded \`.xcent\` entitlement files when present.

**Always verify the application and extension signed entitlements manually before publishing.** A standalone plist does not always expose every entitlement used by a signed IPA. AltStore Classic validates an application's actual entitlements and privacy permissions against the source's \`appPermissions\` metadata and may refuse to install it if they differ. If the icon is compiled in \`Assets.car\`, the reader cannot extract it; set a public PNG HTTPS icon URL manually.

An uploaded app must match the Bundle ID declared in the IPA to ensure versions belong to the correct app.

## Security and data model

- All source metadata lives in the public \`docs/source.json\`.
- IPA files and icons uploaded to this repository are **publicly accessible**.
- The admin page is **publicly reachable** but modification requires a GitHub token with repository write permission.
- The token is held **in the current page's JavaScript memory only**. It is **never** saved to localStorage, sessionStorage, or a repository file. Refreshing the page clears it.
- The dashboard checks the current source file SHA to avoid overwriting concurrent changes.
- An IPA may become **orphaned** in \`docs/ipas/\` if upload succeeds but updating \`source.json\` fails. It can be cleaned up manually in GitHub.
- To block unauthenticated visitors from opening the admin UI at all, protect the \`/admin/\` path using an edge access service such as Cloudflare Access. **GitHub Pages itself does not provide an authenticated directory**.
- Only distribute IPA files for which you have permission, and never upload certificates, mobile provisioning secrets, account credentials, or private data.

## AltStore usage

On iPhone, open **AltStore Classic → Sources → +**, paste:

\`\`\`text
https://repo.zrh.jp/source.json
\`\`\`

Then add the source. Adding a source does not remove iOS app signing, installation, or refresh limitations.

## Project files

\`\`\`text
docs/
  CNAME
  .nojekyll
  index.html            Public store
  style.css
  public.js
  icon.svg
  source.json           AltStore Classic JSON
  admin/
    index.html          Protected write access via GitHub token
    admin.css
    app.js
    ipa-reader.js       Client-side IPA ZIP + plist inspection
  ipas/                 Uploaded small IPAs, created on first upload
  icons/                Extracted icons, created when available
\`\`\`

### Source spec

[Official AltStore source format](https://faq.altstore.io/developers/make-a-source) · [Updating apps](https://faq.altstore.io/developers/updating-apps)

This repository does not contain an app-signing service. It serves publicly accessible IPA downloads and metadata to AltStore Classic.
