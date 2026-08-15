# Sandcastle for Agent

通过宿主机 Codex 登录运行 [Sandcastle](https://github.com/mattpocock/sandcastle)
GitHub Issue 工作流。它是一个可直接用 `npx` 执行的补充层，不需要把本仓库
clone 到目标项目，也不要求在目标项目中配置 OpenAI API Key。

## 核心行为

- 固定使用宿主机 `~/.codex/auth.json`。
- 为容器生成独立的 `.sandcastle/codex-config.toml`。
- 可选挂载宿主机 `~/.codex/AGENTS.md`。
- Planner、Implementer、Reviewer、Merger 可分别设置模型和 reasoning effort。
- 只读取带 `ready-for-agent` 标签的 open GitHub Issues。
- 不会在标签缺失时降级为处理全部 open issues。
- 目标仓库不需要安装 `@ai-hero/sandcastle`、Zod 或本包。

## 前置条件

- Node.js 22+
- Git
- Docker
- GitHub CLI (`gh`)
- 已登录并可用的 Codex CLI
- 宿主机存在 `~/.codex/auth.json`

先验证本机 Codex：

```bash
codex login status
test -f ~/.codex/auth.json
```

如果 Codex 只把认证保存在系统 keyring 中，本工具当前不会尝试读取 keyring；请让
Codex 使用文件认证存储，确保 `auth.json` 存在。

## 快速开始

进入任意已有 Git 仓库：

```bash
cd /path/to/existing-repo
npx github:liumingjian/sandcastle-for-agent init
```

发布到 npm 后可使用更短的命令：

```bash
npx sandcastle-for-agent init
```

引导会确认以下内容：

1. 工作流。
2. 阶段模型预设。
3. 是否加载全局 `~/.codex/AGENTS.md`。
4. Docker 容器访问的 Codex provider URL。
5. 是否创建 `ready-for-agent` 标签。
6. 是否立即构建 Docker 镜像。

配置完成后写入 GitHub token：

```bash
cp .sandcastle/.env.example .sandcastle/.env
```

```dotenv
GH_TOKEN=github_pat_xxx
```

建议使用 fine-grained personal access token，并只授予目标仓库：

- Issues: Read and write
- Metadata: Read-only

启动工作流：

```bash
npx github:liumingjian/sandcastle-for-agent run
```

## Issue 入口规则

所有内置 prompt 都使用同一个固定查询：

```bash
gh issue list --state open --label ready-for-agent
```

因此只有同时满足以下条件的 issue 才会进入工作流：

- 状态为 open。
- 带有 `ready-for-agent` 标签。

其他标签、没有标签以及 closed issues 都不会被实现。标签不存在时，`run` 会直接失败
并提示执行 `configure --create-label`。

## 工作流

| 名称 | 阶段 |
| --- | --- |
| `simple-loop` | Implementer |
| `sequential-reviewer` | Implementer, Reviewer |
| `parallel-planner` | Planner, Implementer, Merger |
| `parallel-planner-with-review` | Planner, Implementer, Reviewer, Merger |

默认选择 `parallel-planner-with-review`。

## 模型预设

`balanced` 使用本仓库原来的模型分工：

| 阶段 | 模型 | Reasoning effort |
| --- | --- | --- |
| Planner | `gpt-5.6-sol` | `xhigh` |
| Implementer | `gpt-5.5` | `high` |
| Reviewer | `gpt-5.6-sol` | `xhigh` |
| Merger | `gpt-5.5` | `high` |

`quality` 对所有阶段使用 `gpt-5.6-sol` + `xhigh`。选择 `custom` 时，引导会询问
当前工作流实际使用的每一个阶段。

模型配置保存在 `.sandcastle/for-agent.json`，可以直接审阅和提交到项目仓库。

## 宿主 Codex 映射

每个 Docker sandbox 都会挂载：

```text
.sandcastle/codex-config.toml -> ~/.codex/config.toml  (read-only)
~/.codex/auth.json           -> ~/.codex/auth.json    (read-only)
~/.codex/AGENTS.md           -> ~/.codex/AGENTS.md    (optional, read-only)
```

`.sandcastle/.env` 只允许配置 `GH_TOKEN`。如果其中声明
`OPENAI_API_KEY`、`OPENAI_KEY` 或 `CODEX_API_KEY`，`run` 会拒绝启动。

默认 provider URL 是：

```text
http://host.docker.internal:15721/v1
```

可在初始化时修改，模型与 reasoning effort 不写入 `codex-config.toml`，它们由每个
工作流阶段显式传给 Codex，避免出现两套模型配置。

## 命令

```bash
sandcastle-for-agent init
sandcastle-for-agent configure
sandcastle-for-agent build
sandcastle-for-agent run
```

- `init`：要求目标仓库尚未存在 `.sandcastle`。
- `configure`：用于已有 Sandcastle 配置；会覆盖本工具管理的 Dockerfile、prompt、
  `CODING_STANDARDS.md` 和配置文件，但保留原来的 `main.mts` 作为回退入口。
- `build`：构建配置中指定的 Docker 镜像。
- `run`：执行认证、GitHub 标签、镜像检查后运行所选工作流。

非交互配置示例：

```bash
npx github:liumingjian/sandcastle-for-agent init \
  --workflow parallel-planner-with-review \
  --preset balanced \
  --no-global-agents \
  --create-label \
  --build
```

查看所有参数：

```bash
npx github:liumingjian/sandcastle-for-agent --help
```

## 生成文件

```text
.sandcastle/
├── .env.example
├── .gitignore
├── CODING_STANDARDS.md
├── Dockerfile
├── codex-config.toml
├── for-agent.json
└── *-prompt.md
```

`.sandcastle/.env`、logs、worktrees、patches 和 tools 默认被忽略。

## 本仓库开发

```bash
npm install
npm run check
npm pack --dry-run
```

包使用原生 ESM JavaScript 和 Node.js 测试运行器；通过 GitHub `npx` 安装时不需要额外
构建步骤。
