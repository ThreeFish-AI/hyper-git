# Track4: VS Code 扩展发布策略 + CI/CD 流水线蓝图

> 复刻目标:把"IDEA Git 工具窗口 + Commit 窗口"的 VS Code 扩展,从源码可靠、安全、自动化地交付到所有目标编辑器用户(原生 VS Code、Cursor、Windsurf、Gitpod、VSCodium/Code-OSS)。
> 所有事实论断均附 GitHub 路径或官方文档 URL;不确定项标注"待核实"。

---

## 1. 发布前置清单(Manifest + Publisher + 凭证)

### 1.1 `package.json` 必填 / 推荐字段(逐字段说明)

依据 [Publishing Extensions 官方文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension):

| 字段 | 必填性 | 说明与依据 |
|---|---|---|
| `name` | **必填** | 扩展唯一短名。Marketplace 要求扩展名全局唯一,重名报 `ERROR The extension 'name' already exists`。 |
| `publisher` | **必填** | 与 Marketplace Publisher ID 一致;OpenVSX 中即"命名空间 (namespace)"。 |
| `version` | **必填** | **仅支持 `major.minor.patch`**,不支持 semver 预发布标签(`-beta` 等)。 |
| `engines.vscode` | **必填** | 兼容性闸门。`^1.85.0` 表 ≥1.85 全可用;pre-release 须 `>= 1.63.0`。 |
| `main` / `browser` | 视情况 | 扩展入口;`browser` 用于 web 扩展(平台特定扩展同时跑浏览器须 target `web`)。 |
| `icon` | 强烈推荐 | 相对路径指向 **≥128×128 PNG**(禁止 SVG)。 |
| `repository` | 推荐 | 公开 GitHub URL;`vsce` 据此自动改写 README 相对链接与图片地址。 |
| `license` | 推荐 | 项目已 MIT,填 `"MIT"` 并附 `LICENSE` 文件。 |
| `categories` / `keywords` | 推荐 | 分类 + 标签,**keywords 上限 30**。 |
| `README.md` / `CHANGELOG.md` | 推荐 | Marketplace 卡片正文 + 版本历史 tab。 |
| `galleryBanner.color` / `pricing` / `sponsor` | 可选 | 横幅色 / `Free`/`Trial`(`vsce>=2.10.0`) / 赞助链接(`vsce>=2.9.1`)。 |
| `scripts.vscode:prepublish` | 推荐 | 打包前钩子,通常 `"npm run compile"`。 |

**安全硬约束**(违规即拒绝发布):
- `icon` 不可为 SVG;`badges` 不可为 SVG(除非来自可信徽章提供方);
- `README.md` / `CHANGELOG.md` 图片 URL **必须 https**,且不得为 SVG。

### 1.2 Publisher 与凭证

**VS Code Marketplace**(后端为 Azure DevOps,见 [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token)):
1. 创建 Azure DevOps 组织;
2. 创建 PAT —— **Organization 选 `All accessible organizations`**(选错单一组织是常见失败),**Scopes = Marketplace → Manage**;
3. [Marketplace publisher 管理页](https://marketplace.visualstudio.com/manage/publishers/) → Create publisher(ID 创建后**不可改**);
4. `vsce login <publisher id>` 验证。

**OpenVSX**(依据 [eclipse/openvsx cli/README.md](https://github.com/eclipse/openvsx/blob/master/cli/README.md) 与 [Publishing Extensions Wiki](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions)):
1. [open-vsx.org](https://open-vsx.org/) 用 Eclipse/GitHub OAuth 登录,生成 access token;
2. `ovsx create-namespace <name>`(name = `publisher`)—— **首次发布前必须先建 namespace**;
3. token 通过 `--pat` 或环境变量 `OVSX_PAT` 提供;`ovsx login <name>` 本地存储(keytar + 文件 fallback)。

> **关键安全循证**:`create-namespace` **不自动授予独占发布权**,初始时任何人都能在该 namespace 发布;**必须额外 claim ownership** 才能 exclusive(原话见 [cli/README.md](https://github.com/eclipse/openvsx/blob/master/cli/README.md))。

> **循证更新**:官方现已推荐用 **Microsoft Entra ID + 工作负载身份联邦 (Workload Identity Federation) + 托管标识** 替代长效 PAT(`vsce publish --azure-credential`,需 `vsce>=2.26.1`),消除泄露风险。详见 [Secure automated publishing 章节](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#_secure-automated-publishing-to-visual-studio-marketplace)。GitHub Actions 原生不支持 Azure 托管标识,但可用 **GitHub OIDC → Entra 联邦凭证**等效方案(待核实 GA 状态)。

### 1.3 `.vscodeignore` 与依赖锁定
- 创建 `.vscodeignore` 排除运行时不需要文件(`**/*.ts`、`**/*.map`、测试源、`.github/`);`devDependencies` 自动排除。
- **关键提醒**:Windows 上打包**丢失 POSIX 可执行位**,部分 `node_modules` 依赖失效;**应在 Linux/macOS 打包**([FAQ](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#_common-questions))。

---

## 2. 发布渠道决策

### 2.1 两市场本质差异

| 维度 | VS Code Marketplace (`vsce`) | OpenVSX (`ovsx`) |
|---|---|---|
| 治理 | 微软专有(Azure DevOps) | Eclipse 基金会,厂商中立开源(EPL) |
| 覆盖编辑器 | 原生 VS Code / Insiders | **Cursor、Windsurf、AWS Kiro、Gitpod、VSCodium、Code-OSS、Theia** |
| 自托管 | 不支持 | 可自建 registry |
| 来源 | [code.visualstudio.com](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) | [eclipse/openvsx](https://github.com/eclipse/openvsx)、[open-vsx.org](https://open-vsx.org/) |

### 2.2 Cursor / Windsurf 等 AI IDE 市场归属(决定性循证)

- **Cursor 使用 Open VSX registry,而非 VS Code Marketplace**。来源:[Cursor 论坛官方回复](https://forum.cursor.com/t/cursor-marketplace-installs-offers-outdated-version-of-open-vsx-extension-despite-latest-version-being-available-upstream/159718)、[安全研究 mazinahmed.net](https://mazinahmed.net/blog/publishing-malicious-vscode-extensions/)(明确指出 OpenVSX 驱动 Cursor/Windsurf/Kiro 等 AI IDE)、[devclass 报道](https://www.devclass.com/development/2025/04/08/vs-code-extension-marketplace-wars-cursor-users-hit-roadblocks/1629343)。
- 后果:**只**发 Marketplace 时,Cursor/Windsurf 用户**装不到**(除非手动 `.vsix`)。

### 2.3 决策:**双市场同时发布**

理由(契合本项目"未来引入 AI Agent 自主代理能力"的受众):
1. **AI 受众主战场在 OpenVSX**:Cursor/Windsurf 用户是 AI 提交/AI 代码审查的核心早期采用者,却只能从 OpenVSX 安装;
2. **Marketplace 是事实主流**:原生 VS Code 基数最大,pre-release/平台包/verified publisher 等特性更完善;
3. **边际成本低**:`ovsx` 与 `vsce` CLI 几乎同构,同一 VSIX 可直接 `ovsx publish`,CI 仅追加一个 step;
4. **抢注风险**:OpenVSX namespace 默认非排他,**务必 `create-namespace` 后立即 claim ownership**([cli/README.md](https://github.com/eclipse/openvsx/blob/master/cli/README.md))。

> 已有成熟 Action 一键双发:`HaaLeo/publish-vs-code-extension`(支持 vsce + ovsx,见 [GitHub Marketplace Action](https://github.com/marketplace/actions/publish-vs-code-extension))——符合 AGENTS.md"复用驱动,优先组合而非重复造轮子"。

---

## 3. CI/CD 流水线蓝图

### 3.1 总体架构

```
[ push/PR ] ──▶ lint ──▶ build ──▶ test 矩阵(ubuntu/macos/windows) ──▶ package vsix ──▶ upload artifact
                                                                              │
                                          ┌───────────────────────────────────┤
[ tag v* ] ───────────────────────────────┤                                   │
                                          ├─▶ github-release(.vsix 附 Release) │ ← 与 publish 解耦,无审批门
                                          └─▶ publish(vsce + ovsx, production 审批门)
```

### 3.2 `.github/workflows/ci.yml`(骨架)

依据 [Continuous Integration 官方文档](https://code.visualstudio.com/api/working-with-extensions/continuous-integration):

```yaml
name: CI
on:
  push:
    branches: [main, master]
    tags: ['v*']
  pull_request:

permissions:
  contents: read           # 最小权限:默认只读

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }   # 本项目统一 pnpm(AGENTS.md)
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint && pnpm run compile
      - run: xvfb-run -a pnpm test                  # Linux 需 xvfb 包装 Electron
        if: runner.os == 'Linux'
      - run: pnpm test
        if: runner.os != 'Linux'

  package:
    needs: test
    runs-on: ubuntu-latest        # 必须 Linux 打包,保 POSIX 文件属性
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm dlx @vscode/vsce package
      - uses: actions/upload-artifact@v4
        with: { name: vsix, path: '*.vsix' }

  publish:
    needs: package
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    environment: production       # 加审批门 + secret 隔离
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with: { name: vsix }
      - run: pnpm dlx @vscode/vsce publish --packagePath *.vsix
        env: { VSCE_PAT: ${{ secrets.VSCE_PAT }} }
      - run: pnpm dlx ovsx publish *.vsix
        env: { OVSX_PAT: ${{ secrets.OVSX_PAT }} }
```

**核心要点**(均循证):
- **`xvfb-run -a npm test`** 仅 Linux 需要(Electron 需 X server),官方原话见 [CI 文档 GitHub Actions 节](https://code.visualstudio.com/api/working-with-extensions/continuous-integration#_github-actions);Linux 另需 `libasound2 libgbm1 libgtk-3-0 libnss3`([GitLab CI 节](https://code.visualstudio.com/api/working-with-extensions/continuous-integration#_gitlab-ci))。
- **PAT 作为 GitHub encrypted secret**,`vsce`/`ovsx` 默认读环境变量,命令行不明文。
- **发布条件**:`startsWith(github.ref, 'refs/tags/v')`,打 tag 才发布。
- **平台特定扩展**:若引入 native node 模块(git 二进制),需 `vsce package --target win32-x64 win32-arm64 linux-x64 darwin-arm64 ...`,每 target 产独立 vsix;`--target` 自 `vsce 1.99.0` 支持([Platform-specific extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#_platform-specific-extensions))。纯 TS 初期**无需**,降本。

### 3.2.1 GitHub Release 附带 `.vsix`（已实现，本仓 `ci.yml` 现状）

§3.2 骨架仅把 vsix 上传为 **Actions artifact** + 发双市场,**不会**把 `.vsix` 附到 GitHub Release;而 README 指引用户「从 Releases 下载 `.vsix` 手动安装」。为闭合此缺口,本仓在 `ci.yml` 增设独立 `github-release` job:

```yaml
  github-release:
    name: GitHub Release (.vsix)
    needs: package                                   # 复用 package job 的 vsix artifact,不重复构建
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions:
      contents: write                                # 仅本 job 提权;顶层保持 contents: read
    steps:
      - uses: actions/download-artifact@v4
        with: { name: vsix }
      - uses: softprops/action-gh-release@v2
        with:
          files: '*.vsix'
          prerelease: ${{ contains(github.ref_name, 'rc') }}   # 与 publish 的 --pre-release 判定一致
          generate_release_notes: true
          fail_on_unmatched_files: true              # vsix 缺失即显式失败,杜绝空资产 Release
```

设计要点(契合 AGENTS.md「正交分解 / 最小干预」):
- **解耦**:`needs: package` 而非 `needs: publish`,且不挂 `environment: production` → 即便市场 publish 待审批或失败,带 `.vsix` 的 Release 仍照常产出;反之「仅出 GitHub Release、暂不发市场」时,不审批 production 即可,无需改动 publish job;
- **最小权限**:仅 `github-release` 提权 `contents: write`,顶层 `permissions: contents: read` 不动;
- **复用**:消费 `package` job 既有的 `vsix` artifact,零重复打包。

### 3.3 关键 Action 版本
- `actions/checkout@v4`、`actions/setup-node@v4`、`actions/upload-artifact@v4`、`actions/download-artifact@v4`;
- `@vscode/test-electron`(或新版 VS Code Test CLI)驱动集成测试;
- 第三方:`HaaLeo/publish-vs-code-extension`(双发)、`github/codeql-action`(SAST)。

---

## 4. 版本与发布治理

### 4.1 SemVer(Marketplace 特殊约束)
- 仅支持 `major.minor.patch`,**不支持 semver 预发布后缀**([官方原话](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#_pre-release-extensions))。
- 版本号不可重发;pre-release 与 release 版本号必须互异。

### 4.2 Pre-release 通道(odd/even 约定)
官方推荐([同上](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#_pre-release-extensions)):
- **release 用 偶数 minor**:`1.2.*`、`1.4.*`;
- **pre-release 用 奇数 minor**:`1.3.*`、`1.5.*`;
- `vsce publish --pre-release`,需 `engines.vscode >= 1.63.0`;
- VS Code 自动更新到最高版本,故发 release 前应先发更高 pre-release,避免 pre-release 用户回滚。

### 4.3 CHANGELOG 维护
- `CHANGELOG.md` 放根目录,Marketplace 自动渲染独立 tab;
- 建议 [Keep a Changelog](https://keepachangelog.com/) 格式,配合 Conventional Commits 自动生成;
- 图片必须 https、非 SVG。

### 4.4 回滚方案 —— 版本不可撤销是核心约束

| 操作 | 效果 | 可逆性 |
|---|---|---|
| `vsce unpublish <id>` | **整个扩展下架**,保留统计但失去自动更新来源 | 重发需重新积累 |
| 删除**单个版本**(管理页 More Actions → Reports → Delete this version) | 删该版本 | **不可逆**,**不可删最新版本**,**版本号永久不可复用** |
| 覆盖同版本号发布 | Marketplace **拒绝重复版本** | 不支持 |

**官方推荐对策**(综合 [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#_removing-specific-extension-versions)、[vsce issue #846](https://github.com/microsoft/vscode-vsce/issues/846)、[Stack Overflow](https://stackoverflow.com/questions/69342687/ive-published-a-wrong-version-number-to-vscode-marketplace-best-way-to-handle)):
1. **首选**:立即发更高版本号的修复版(`1.2.3` 坏→发 `1.2.4`),自动更新推送修复;
2. **次选**:最新版本严重缺陷时,先删该版本(管理页),再发修复版(注意该版本号永久作废);
3. **回滚演练**:CI 保证 tag→发布 < 10 min,这是唯一可靠回滚路径;
4. **绝不用 `unpublish` 回滚**:丢失统计与信用([Reddit 踩坑](https://www.reddit.com/r/vscode/comments/1idwar5/i_made_a_terrible_mistake_unpublishing_my/));
5. **Deprecate 替代删除**:可申请标记 deprecated,UI 显示删除线但不失信用([deprecate 流程](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#_deprecating-extensions))。

OpenVSX 删除策略相对宽松,但为双市场一致,统一遵循"出新版本即回滚"。

---

## 5. 风险与规避(逐条)

### 5.1 PAT 泄露(最高危)
- **风险**:PAT 进 commit/日志,攻击者可投毒发布恶意扩展(供应链攻击)。先例:Eclipse 曾因泄露的 OpenVSX token 紧急吊销([安全报道](https://www.informationsecurity.com.tw/article/article_detail.aspx?aid=12417))。
- **规避**:
  1. PAT 仅存 GitHub **encrypted secrets**,绝不入仓;
  2. PAT **短过期**(90 天)+ 最小 scope(Marketplace Manage);
  3. 优先迁移 **Entra 托管标识 + OIDC 联邦**(消除长效 secret);
  4. CI `permissions: contents: read`,publish job 用 `environment: production` 加审批门;
  5. 所有 action **pin 到完整 commit SHA**,防 tag 篡改([OpenSSF](https://openssf.org/blog/2024/08/12/mitigating-attack-vectors-in-github-workflows/));
  6. 启用 secret scanning + push protection。

### 5.2 版本/发布不可撤销
- **风险**:误发坏版本无法"静默删除",已安装用户已收到坏更新。
- **规避**:见 §4.4,以"快速补丁版本"为唯一回滚范式;发布前必过 3 平台测试门;pre-release 通道吸收 AI Agent 等高风险不稳定特性。

### 5.3 CI 多平台测试成本
- **风险**:`ubuntu×macos×windows` 计费累积;Windows/macOS runner 倍率高。
- **规避**:
  1. PR 仅跑 `ubuntu-latest` 单格快速门;
  2. main 与 tag 跑完整矩阵;
  3. 纯 TS 无原生依赖时省去 platform-specific 打包,只产通用 vsix;
  4. `fail-fast: false` 保留全量失败信号(熵减);
  5. Linux 用 `xvfb-run -a` 而非常驻进程。

### 5.4 供应链与遥测合规
- **供应链**:Dependabot security updates + `pnpm audit` step + CodeQL([GitHub Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use));考虑 SBOM(`syft`/`cyclonedx`)随 Release 附带。
- **遥测**:未来引入 AI Agent(调外部 LLM),**必须**提供 `telemetry.enableTelemetry` 开关,默认关闭;遵守 [VS Code telemetry API](https://code.visualstudio.com/api/extension-capabilities/common-capabilities)(最新隐私 API 细节待核实)。
- **许可证**:项目已 MIT,填 `"license": "MIT"` 并保留 `LICENSE` 文件。

---

## 关键来源索引

- [Publishing Extensions — VS Code 官方](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Continuous Integration — VS Code 官方](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
- [microsoft/vscode-vsce](https://github.com/microsoft/vscode-vsce) / [microsoft/vscode-test](https://github.com/microsoft/vscode-test)
- [eclipse/openvsx — cli/README.md](https://github.com/eclipse/openvsx/blob/master/cli/README.md) / [Publishing Extensions Wiki](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions) / [open-vsx.org](https://open-vsx.org/)
- [Cursor 使用 OpenVSX(官方论坛)](https://forum.cursor.com/t/cursor-marketplace-installs-offers-outdated-version-of-open-vsx-extension-despite-latest-version-being-available-upstream/159718) / [OpenVSX 驱动 AI IDE 安全分析](https://mazinahmed.net/blog/publishing-malicious-vscode-extensions/)
- [GitHub Actions 安全(OpenSSF)](https://openssf.org/blog/2024/08/12/mitigating-attack-vectors-in-github-workflows/) / [GitHub Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [Publish VS Code Extension Action(双发)](https://github.com/marketplace/actions/publish-vs-code-extension)
- [vsce 版本不可删 issue #846](https://github.com/microsoft/vscode-vsce/issues/846) / [版本回滚 SO](https://stackoverflow.com/questions/69342687/ive-published-a-wrong-version-number-to-vscode-marketplace-best-way-to-handle)

---

## 下一步最佳行动建议(Next Best Action)

1. **先落地 §3.2 `ci.yml` 的 test+package+artifact 三 job**:验证 3 平台通过率与 `xvfb` 集成,暂不接 publish(零风险)。
2. **同步创建 Publisher + OpenVSX namespace**:立即 `ovsx create-namespace` 并 **claim ownership**,防止命名空间抢注。
3. **PAT 治理决策点**:评估是否一步到位上 Entra 托管标识(消除 PAT),还是先用 secret + 短过期 PAT 过渡——决定 publish job 认证实现。
4. **pre-release 路线**:AI Agent 自主代理属高风险新特性,建议首版即建立 `odd minor` pre-release 通道(如 `0.3.x`)吸收早期 Cursor/Windsurf 反馈,稳定后升 `0.4.x` release。

> 风险提示:`engines.vscode` 下限、是否需 native git 二进制(影响 platform-specific)、与 Cursor 不支持 API 的兼容边界,需在扩展架构 Track 协同确定,反向影响本流水线的矩阵与打包策略。


############################################################
