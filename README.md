# ZZS IPA Store

AltStore Classic 的个人 IPA 软件源，托管于 GitHub Pages，采用 **GitHub 原生登录 + Releases + Actions** 管理方式。

**无需创建或粘贴 GitHub Personal Access Token。无需 Cloudflare Worker、D1、单独服务器或第二套用户名密码。**

| 用途 | 地址 |
| --- | --- |
| 公开网站 | https://repo.zrh.jp/ |
| AltStore 软件源 | https://repo.zrh.jp/source.json |
| 管理入口 | https://repo.zrh.jp/admin/ |
| GitHub 发布 IPA | https://github.com/zrhtop/ZZS-IPA-Store/releases/new |
| 管理已发布版本 | https://github.com/zrhtop/ZZS-IPA-Store/releases |
| 检查 Actions | https://github.com/zrhtop/ZZS-IPA-Store/actions/workflows/publish.yml |

## 一次性开启自动发布

1. 打开仓库 [Settings → Pages](https://github.com/zrhtop/ZZS-IPA-Store/settings/pages)。
2. 在 **Build and deployment → Source** 选择 **GitHub Actions**（不再选择旧的 **Deploy from a branch**）。
3. 保留自定义域名 **repo.zrh.jp** 和 GitHub Pages 的 HTTPS 配置。
4. 工作流文件 \`.github/workflows/publish.yml\` 已在仓库中。以后推送代码、发布/修改/删除 Release 或在 Actions 手动运行，都会尝试同步并部署网站。
5. 必要时，打开 [Actions → Publish ZZS IPA Store](https://github.com/zrhtop/ZZS-IPA-Store/actions/workflows/publish.yml) → **Run workflow** 进行初次部署。

GitHub Actions 提供**自动且短期有效的 \`GITHUB_TOKEN\`**，它由 GitHub 自动生成，与您自己创建、复制或手动保存 Personal Access Token 不同。这个令牌只在工作流中使用，访客浏览器和网站源代码中没有令牌。

如果自动提交 \`docs/source.json\` 被 GitHub 阻止，检查仓库 Settings → Actions → General → Workflow permissions，或是否存在分支保护；工作流显式申请了 \`contents: write\`。不要为了解决此问题建立具有所有仓库权限的 PAT。

## 一键导入其他 AltStore Classic 软件源（无需个人 Token）

已在管理入口的 **「把其他 AltStore 软件源导入进来」** 区域提供跳转，也可直接打开 [Import AltStore Source 工作流](https://github.com/zrhtop/ZZS-IPA-Store/actions/workflows/import-source.yml)。

1. 登录对该 GitHub 仓库有**写入权限**的 GitHub 账号。
2. 打开 [Actions → Import AltStore Source](https://github.com/zrhtop/ZZS-IPA-Store/actions/workflows/import-source.yml)，点击 **Run workflow**。
3. 在 `source_url` 粘贴原软件源的完整 HTTPS `source.json` 地址（支持标准 JSON 和 JSON5）。
4. 默认 `add-only` **只添加不存在的 Bundle ID**，不会覆盖已有应用；选 `merge-versions` 可给已有应用添加尚未出现过的历史版本。已有版本展示顺序不改变。
5. `bundle_ids` 留空则导入全部；填写 `com.example.app,com.example.other` 则只导入这几个应用。
6. 勾选 **permission_confirm**，确认有权导入并遵守原项目的许可条款。可勾选 `preview_only` 先预览数量、不修改任何文件。
7. 点击 **Run workflow**。Actions 将检验格式、处理重复项、更新 `docs/source.json` 并直接部署 GitHub Pages。之后在网站和 AltStore 中查看结果。

**只导入元数据和原始 HTTPS IPA 下载链接，不会复制、下载或重新托管第三方 IPA。** 因此无需额外存储空间，但原地址失效时导入的应用也无法下载。会尽量保留原开发者名称、应用图标、截图、权限和历史版本信息。GitHub Release 生成的 IPA 和手动导入的软件源条目可以同时存在。

为避免无意导入受限制内容，工具默认跳过部分不兼容的 PAL 专用、Patreon 受限和 NSFW 软件源内容，拒绝非 HTTPS 下载链接。每次最多导入 150 个应用，每个应用最多导入 60 个版本。如果 IPA 真实签名权限和原始源的 `appPermissions` 不一致，AltStore 仍可能拒绝安装。

**版权/授权：** 公共可下载并不意味着允许重新分发。导入之前确认应用开发者的许可，保留原作者信息，并遵守上游软件源的使用条款。

## 发布 IPA（直接使用 GitHub 账号）

1. 打开 [管理入口](https://repo.zrh.jp/admin/) 并点击 **使用 GitHub 登录并发布 IPA**。
2. 如果尚未登录，GitHub 会要求登录。只有拥有 \`zrhtop/ZZS-IPA-Store\` **写入权限**的 GitHub 用户能发布。
3. 打开 **Create a new release**。创建唯一的 **Tag**，例如 \`com.example.app-v1.0.0\`。填写 Release title（用于查看）和可选的更新说明。
4. 在 Release **Attachments** 上传 **恰好一个 .ipa 文件**。也可额外上传一张文件名含 \`icon\` 的 PNG 图片（例如 \`app-icon.png\`），让新应用使用对应图标。
5. 点击 **Publish release**（不要只点 Save draft）。此时 GitHub Actions 会自动下载 IPA、读取 \`Payload/*.app/Info.plist\`、从 \`CFBundleIdentifier\` 识别应用、用 \`CFBundleShortVersionString\` 和 \`CFBundleVersion\` 识别版本，并将其写入 \`docs/source.json\`。
6. 工作流完成后，可在 https://repo.zrh.jp/ 查看应用，AltStore 软件源保持地址 https://repo.zrh.jp/source.json 不变。

同一 Bundle ID 的新版本会被插在历史版本前面，供 AltStore Classic 判断更新。Release 的唯一 Tag 与 IPA 内部的 Bundle ID / Version 不需要相同，但内部字段必须正确。

**请在发布 Release 之前附加 IPA。** 如果后面才上传或替换附件，可能不会触发新的工作流：进入 [Actions 工作流](https://github.com/zrhtop/ZZS-IPA-Store/actions/workflows/publish.yml) 点击 **Run workflow** 进行手动同步即可。

## 修改、下架与手工编辑

- **更新版本**：创建新的 Release，上传相同 Bundle ID、较新版本号的 IPA。
- **修改 Release 更新说明**：编辑 GitHub Release，工作流会再次处理发布记录。
- **下架版本**：删除相应 Release，工作流会重新生成其管理的版本数据。
- **修改应用名称、介绍、开发者、类别或图标**：登录 GitHub 编辑 [docs/source.json](https://github.com/zrhtop/ZZS-IPA-Store/edit/main/docs/source.json)。对已有应用的展示字段，自动同步通常会保留手动修改的值。
- **查看发布失败原因**：检查 [Actions 执行记录](https://github.com/zrhtop/ZZS-IPA-Store/actions/workflows/publish.yml)。
- **手工更新图片**：可在 Release 附件中传入包含 \`icon\` 的 PNG，或者直接编辑已有应用的 \`iconURL\`。

自动同步会保留非本仓库 Release 管理的版本记录。删除仅用于 Release 的版本后，该版本记录会被移除；GitHub Release 下载链接也将失效。

## IPA 权限特别提醒

GitHub Actions 自动提取应用名称、Bundle ID、版本、最低 iOS 版本、Info.plist 的 Privacy UsageDescription，以及部分可见的 \`.xcent\` 权限文件。**IPA 的真实代码签名 Entitlements 不一定以独立文件存在**，所以脚本**不能保证完整提取全部权限**。

AltStore Classic 可能根据实际签名权限校验 \`appPermissions\`；对于安装失败的应用，需要自行检查签名包里的主应用和扩展的权限，然后手动编辑 \`docs/source.json\` 对应的 \`appPermissions.entitlements\` / \`appPermissions.privacy\`。不能为了绕过验证随意填写虚假权限。

## 安全边界

- \`repo.zrh.jp/admin/\` **只是公开的管理入口页面**，不是受服务器保护的私人网页。只有有仓库权限的 GitHub 账号才能在 GitHub 上创建、编辑和删除 Release。
- GitHub Pages 是公共静态网站，因此**不能单独实现一个安全的私人用户名/密码数据库**。
- 源文件、Release 附件及网站内容公开，勿上传需保密的 IPA、个人身份信息或凭据。
- 不需要先前的浏览器本地密码仓库；本项目已删除老的 \`vault.js\` 和个人 Token 登录管理代码。
- 尽可能只在你有授权分发的情况下发布 IPA。

## 目录

\`\`\`
.github/workflows/publish.yml      Release 自动同步 + GitHub Pages 部署
scripts/sync_releases.py           Python IPA / Info.plist 解析和 JSON 自动构建
docs/
  CNAME                           repo.zrh.jp
  source.json                     AltStore Classic 源数据
  index.html                      公开软件商店
  style.css
  public.js
  icon.svg
  admin/
    index.html                    纯 GitHub 管理入口
    admin.css
    admin.js
\`\`\`

[AltStore 官方软件源格式](https://faq.altstore.io/developers/make-a-source) | [GitHub Actions 官方 GITHUB_TOKEN 说明](https://docs.github.com/en/actions/concepts/security/github_token)
