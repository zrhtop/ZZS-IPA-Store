# AGENTS.md：ZZS IPA Store 管理手册（给在本仓库工作的 AI 协作者）

本文件是给 Codex 等 AI 协作者的操作手册：如何安全、正确地管理这个 AltStore 经典版 IPA 源。动手前先通读，尤其是「铁律」和「审批边界」两节。所有规则都来自源主人的决定和以往事故教训，不要自行放宽。

## 1. 项目概况

- 这是一个个人 AltStore Classic 软件源，名为 ZZS IPA Store。
- 网站：https://repo.zrh.jp/ ，源文件：https://repo.zrh.jp/source.json ，导航页：https://repo.zrh.jp/admin/ （公开页面，不是带鉴权的后台，禁止把任何令牌、密钥放进前端、JSON 或仓库文件）。
- 仓库：zrhtop/ZZS-IPA-Store，默认分支 main，托管在 GitHub Pages 上，没有单独服务器，没有 PAT。
- 权威数据是 `docs/source.json`。网站由 `.github/workflows/publish.yml` 构建和部署：推 main 会触发重新同步和部署。
- 当前状态（2026-10-29）：73 款 app，207 条版本记录，其中 17 条是托管在本仓库 Releases 里的版本（口袋猫漫画 com.koudai.manga 全部版本），其余为外链。
- 本仓库有 4 个工作流：publish.yml（Release 同步加部署）、import-source.yml（整源导入）、add-ipa-url.yml（按 IPA 直链上架）、test-add-ipa-url.yml（离线回归测试，推送 source.json 相关改动前必须能跑过仓库 tests/ 下的全部离线测试）。

## 2. 数据模型和铁律

- **身份键是 Bundle ID**（app 的 bundleIdentifier）。同一个 Bundle ID 就是同一个 app，改 Bundle ID 等于换了一个 app。
- **版本键是 (version, buildVersion) 二元组**。`versions[0]` 就是 AltStore 认为的最新版，列表不按日期自动排序，新版本必须插到数组最前面。
- **buildVersion 只能来自真实 IPA 的 CFBundleVersion，或者可信的上游元数据（例如上游 release 标题里明示的 build 号）。禁止编造、推测或沿用上一版的 build 号。** 同理，appPermissions 必须来自真实 IPA，禁止复制其他 app 的权限；sha256 没有实际下载校验过就不要写。
- 版本是否由本仓库 Release 管理，只看它的 downloadURL 是否以 `https://github.com/zrhtop/ZZS-IPA-Store/releases/download/` 开头。删除某个 Release 时只应清掉这类版本，外链版本保留。
- `docs/release_notes_overrides.json` 目前只有 WrapPin 一条，而且只有 sync_releases.py 读取它；改它不等于改 source.json，线上不会变。
- 应用数量没有硬上限（源主人 2026-10-24 明确取消）。整源导入仍有单 app 只读前 60 个版本、上游源 JSON 上限 64 MiB 的限制，不要混淆。
- source.json 的序列化格式必须保持：`json.dumps(..., ensure_ascii=False, indent=2)` 再加结尾换行。这样 diff 才干净，不会出现整文件重排。
- 不强推 main，不绕过分支保护。所有改动走分支加 PR 再合并（见第 6 节的协作约定）。

## 3. 三条上架路径

1. **本地 IPA 走本仓库 Release**：新建 GitHub Release，发布前附恰好一个 .ipa（可附文件名含 icon 的 .png 图标），Tag 唯一，建议格式 `bundleid-v版本-bBuild`。必须 Publish（不能存草稿）。附件后补不一定触发同步，必要时手动运行 publish.yml。同步后自动生成的 developerName 默认是 “ZZS”、描述默认是整篇 Release body，都是模板值，上架后必须核实并改成真实作者和精简文案。
2. **IPA 直链（有上游链接时优先）**：运行 add-ipa-url.yml，先用 preview_only=true 核对摘要再正式运行。existing_mode 默认 skip；只有替换同版本地址时才用 replace，且 replace 必须经源主人确认。
3. **整源导入**：运行 import-source.yml 并先 preview。add-only 模式跳过已有 Bundle ID；merge-versions 只在版本列表尾部追加、不置顶，所以导入后必须人工检查 versions[0] 是否仍为最新版。

publish.yml 的关键机制（2026-10-28 起，提交 16109f3）：Release 事件只跑一个 relay 任务，把工作流以 workflow_dispatch 形式在 main 上重新触发，真正的构建和部署跳过 Release 事件本身。原因：Release 事件使用的是该 Tag 提交快照里的工作流文件。所以给旧 Tag 补发 Release 时跑的仍是旧工作流，不要困惑。

## 4. 验证 IPA 元数据的方法

给任何新版本或新 app 录入数据前，必须从 IPA 本体核实元数据，不能只信文件名或网页文字：

- 需要的字段：CFBundleIdentifier、CFBundleShortVersionString、CFBundleVersion、MinimumOSVersion、文件真实字节数、Info.plist 中的 NS*UsageDescription 隐私条目（用于 appPermissions.privacy；entitlements 单独从签名提取，取不到就记空数组，不要编造）。
- 推荐用 HTTP Range 请求只读 ZIP 中央目录并定位 `Payload/*.app/Info.plist` 解压读取，避免整包下载（整包动辄几百 MB）。注意一个 IPA 里可能有多个 .app，只认 Payload 顶层的主 app。
- 已知陷阱：个别上游 IPA 的 plist 本身就是错的（例如 OldOS 的 IPA 里 Bundle ID 写的是作者另一个 app 的）。录入时按 IPA 实际值录，并在描述里注明，不要“修正”成你以为对的值。

## 5. 日常操作流程

### 5.1 给现有 app 加新版本

1. 确认新版本下载链接可达，读 IPA 的 plist 核对 Bundle ID 与源中该 app 一致。
2. 新记录字段：version、buildVersion 取 plist 值；date 用上游 release 的发布日期（YYYY-MM-DD）；size 用文件真实字节数；minOSVersion 取 plist 值；localizedDescription 用上游 release 说明的精简版（可精简，不要整篇复制冗长原文，更不要编造内容）。
3. 插入 versions[0]，其余记录不动。提交前跑仓库离线测试，确认 JSON 可解析、Bundle ID 全局唯一。

### 5.2 新增 app

- 字段齐全：name、bundleIdentifier、developerName（真实作者，不要写 ZZS 冒充）、localizedDescription、iconURL（确认链接可访问）、category（现有取值只有 other 和 utilities）、versions、appPermissions、subtitle（可选）。
- Bundle ID 已存在于源中就是重复添加，先停下来向源主人确认。

### 5.3 下架和死链

- 链接最终返回 404 才是确认死链。先复核再下架：整款 app 只剩死链时整款下架；只是旧版本死链时只删该条记录。
- catbox.moe 的链接从某些网络（例如云主机的出口网络）完全不可达，连接失败不等于死链，必须换一个网络路径（例如浏览器）确认后才能下架。

### 5.4 上游更新巡检

- 对每个有 GitHub 外链的 app：用 GitHub API 拉它上游仓库的 releases，把源里的 downloadURL 和 release assets 对照。资产文件名带版本号时可用“文件名形状”（把数字替换为占位符）匹配同一 app 的新文件。
- WuXu1/WuXu1.github.io 的 “Latest” 是活频道：文件原地替换、Release 发布时间永远是 2023 年，判断新旧要看 asset 的 updated_at 和文件名形状，不要看 release 日期。
- “同 URL 文件被替换”的情况，只有读出新文件的 build 或大小真的变了才算更新。
- 候选版本必须按第 4 节方法读 plist 复核后才能报告或录入。

## 6. 审批边界（源主人的硬性规则）

- **可以自主做**：只读巡检、preview、本地测试、起草 PR、写差异报告。
- **必须逐次得到源主人确认才能做**：正式上架新 app 或新来源、批量导入、把 PR 合并到 main 或直推 main、替换同版本 IPA 地址、修改作者署名或图标来源。
- **必须得到源主人明确同意才能做**：删除 Release、下架版本或整款 app、回滚 source.json、改 Pages、DNS 或权限设置。
- 这些边界对“帮忙顺手做掉”没有例外：发现问题先报告，等确认后再动手。

## 7. 当前各 app 的特殊情况（2026-10-29）

- WrapPin 位于 apps[0]，指向 suversal/WrapPin 上游；它的版本说明覆盖在 release_notes_overrides.json 里维护。
- 口袋猫漫画（com.koudai.manga）走本仓库 Releases 同步（路径 1），版本发布在另一个仓库 zrhtop/KoudaiManga 的 CI 里完成，不要从外部上游给它找更新。
- OldOS（bundleIdentifier 为 com.zurac.BudgetBuddy，zzanehip/The-OldOS-Project）：源主人决定只加当前版本（上游 release 2.0_8，plist 记录为 version 1.0 / build 15），**不做自动维护**。原因：作者每个 release 都换 Bundle ID（历史上出现过 com.zurac.OldOS、com.zurac.OldOSSL2、com.zrc.BudgetingBuddy、com.zurac.BudgetBuddy），新版无法覆盖升级。巡检时跳过它的上游更新检查，但死链检查照常覆盖。
- NeoStation iOS（TarbleFR/RewindBox）：上游已经改名 RewindBox 并删除了旧 release，资产改名为 RewindBox-BuildNNN.ipa；当前源中是 build 530。注意它家新 Tag（例如 0.0.10）可能不带 IPA 资产，没有 .ipa 的 release 不是可安装版本。
- SpotC++、SpotveeC、SpotilifeC：源里没有 GitHub 上游链接，无法自动巡检上游更新。
- 全源目前有 12 条版本记录缺 buildVersion，全部是 catbox 链接（从云网络验证不了 plist，但已通过浏览器确认链接存活）。在没有读到真实 plist 之前，不要给它们补 build 号。

## 8. 多个 AI 协作者共管的约定

- Muse（Meta 的个人助手）也在管理这个源：它每三天 10:00（Australia/Adelaide）跑一次只读巡检（死链加
...[truncated 673 chars]