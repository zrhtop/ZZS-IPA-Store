# ZZS IPA Store

使用 **GitHub Pages** 托管的 AltStore Classic 软件源与 IPA 管理面板，无需 Cloudflare Worker、D1、服务器、npm 或 GitHub Actions。

- 首页：**https://repo.zrh.jp/**
- 软件源：**https://repo.zrh.jp/source.json**
- 管理后台：**https://repo.zrh.jp/admin/**
- 代码仓库：[zrhtop/ZZS-IPA-Store](https://github.com/zrhtop/ZZS-IPA-Store)

## 初次使用（只需 GitHub）

1. 检查仓库 **Settings → Pages**：选择 **Deploy from a branch**、**main /docs**；Custom domain 填写 **repo.zrh.jp**。保留 GitHub Pages 已生效的 DNS CNAME：**repo → zrhtop.github.io**。
2. 在 GitHub 创建 [Fine-grained Personal Access Token](https://github.com/settings/personal-access-tokens/new)：
   - Resource owner：**zrhtop**
   - Repository access：**Only select repositories → ZZS-IPA-Store**
   - Repository permissions：**Contents → Read and write**
   - 尽量设置合理的到期日。**不要向任何人透露 Token。**
3. 在 **https://repo.zrh.jp/admin/** 第一次打开时，创建本机管理员账户。默认填入的用户名是 **zzsadmin**；密码需自行设置，**10–12 位**，同时包括大写字母、小写字母和数字。为了安全，**不存在写在公开代码里的默认密码**。
4. 将 GitHub Token 粘贴一次，点击创建账户。网站先验证 GitHub 仓库权限，再用 PBKDF2-SHA256 和 AES-256-GCM 加密 Token，存到 **当前浏览器的 localStorage**。
5. 以后在同一浏览器只需要输入账号密码，即可解锁 Token 进入应用管理后台。刷新或退出登录后，**明文 Token 不会自动保持在内存里**。

### 修改密码、更换设备或重设令牌

登录后点击 **账号设置**，可修改用户名和密码，或下载包含**加密 Token**的 JSON 备份。第二台设备打开管理后台，点击 **导入加密账户备份**，使用原密码解锁。也可以在每台设备分别绑定 GitHub Token。

**注意：浏览器本地账户不是同步账户。** 在另一台设备直接输入同一用户名和密码、但没有导入加密备份或绑定 GitHub Token，无法登录。清除浏览器站点数据也会删除该设备的本地账户配置；GitHub 软件源和应用数据不受影响。

## 功能

- IPA 上传：直接上传不超过 **20 MiB** 的 IPA 到 \`docs/ipas/\`。更大的 IPA 可以先放到 [GitHub Releases](https://github.com/zrhtop/ZZS-IPA-Store/releases/new)，再通过其**公开 HTTPS 下载链接**发布。
- 应用和版本：添加应用、编辑资料、增删历史版本、设置最新版，自动维护 \`docs/source.json\`。
- 元数据：尽力解析 \`Payload/*.app/Info.plist\` 的应用名称、Bundle ID、版本、最低 iOS 版本、隐私权限说明和可读取的 PNG 图标。
- 版本更新：AltStore 使用 \`versions\` 数组**第一条**作为最新版。修改源文件后，GitHub Pages 生效可能需要短暂时间。
- 编辑防冲突：修改前检查 GitHub 文件 SHA，避免直接覆盖已发生的更新。

### 安全边界（务必了解）

**GitHub Pages 不能给某个目录增加真正的服务器登录验证。**

- \`/admin/\` 的 HTML/CSS/JS 及整个 **Public** GitHub 仓库，仍然对互联网公开。页面里的账号密码只用于**本地解锁已加密的 GitHub Token**。
- 别人在自己的浏览器访问 \`/admin/\` 时也可能看到“首次配置账户”页面，但**没有对本仓库拥有写入权限的 GitHub Token，就不能修改软件源**。
- GitHub API 会独立验证 Token。你的登录密码**不是** GitHub Token，也不会生成额外的仓库权限。
- 加密备份一旦外泄，有被离线猜解密码的风险。请使用不可预测的 10–12 位密码，不要把加密备份上传到公开仓库。
- 不要使用以前在公开聊天记录中出现过的初始密码。该版本**不会**部署任何已公开的默认密码。
- GitHub Pages 适合公开软件源，不适合分发保密 IPA。已经上传到 \`docs/ipas/\` 的文件是公开可访问的。
- IPA 里的代码签名 Entitlements 可能不能仅通过 Info.plist 完整读取；上传前需要人工检查 \`appPermissions\`，否则 AltStore 可能拒绝安装。

如需真正让未登录者连 \`/admin/\` 页面源代码都无法读取，必须使用带服务器验证的服务（例如 Cloudflare Access/Worker 或专用后端），这无法由公开 GitHub Pages 单独实现。

## AltStore Classic

在 iPhone 打开 AltStore Classic → Sources → **+**，输入：

\`\`\`text
https://repo.zrh.jp/source.json
\`\`\`

此站点只管理 IPA 下载和软件源元数据，不提供 iOS 应用签名、绕过签名限制或应用自动刷新服务。

## 文件结构

\`\`\`text
docs/
  CNAME             repo.zrh.jp
  .nojekyll
  index.html        公开应用展示
  style.css
  public.js
  icon.svg
  source.json       AltStore Classic JSON
  admin/
    index.html      账号设置与登录
    admin.css
    app.js          GitHub 读写及管理 UI
    vault.js        PBKDF2 + AES-256-GCM 本地加密账户
    ipa-reader.js   IPA ZIP / plist 元数据解析
  ipas/             上传 IPA 时创建
  icons/            提取图标时创建
\`\`\`

格式说明：[AltStore 官方 Source 文档](https://faq.altstore.io/developers/make-a-source)。
