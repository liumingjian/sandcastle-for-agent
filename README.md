# Sandcastle for Agent

基于 [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle) 定制的 GitHub Issue 自动处理工具，分别提供 Codex 和 Claude Code 两套运行配置。

两套配置都会复用宿主机上已有的 Agent 授权信息，不需要在项目中保存 Codex 或 Claude Code 的认证凭证。项目只需要配置用于访问 GitHub Issue 的 `GH_TOKEN`。

## 前置条件

- Node.js 22+
- Docker
- npm
- 已在宿主机完成 Codex 或 Claude Code 的登录与配置

克隆项目：

```bash
git clone https://github.com/liumingjian/sandcastle-for-agent.git
cd sandcastle-for-agent
```

## 配置 GH_TOKEN

建议使用 GitHub 的 [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)，并遵循最小权限原则。

创建 token 时配置：

1. `Resource owner`：选择目标仓库所属的用户或组织。
2. `Repository access`：只选择需要由 Sandcastle 处理 Issue 的仓库。
3. `Repository permissions`：
   - `Issues`：`Read and write`
   - `Metadata`：`Read-only`
4. `Expiration`：设置合理的过期时间，不建议创建永久 token。

如果仓库属于组织，token 可能需要组织管理员审批。在审批完成前，它可能只能访问公开资源。

进入准备使用的目录，将示例文件复制为 `.env`：

```bash
cd codex
# 或：cd claudecode

cp .sandcastle/.env.example .sandcastle/.env
```

编辑 `.sandcastle/.env`：

```dotenv
GH_TOKEN=github_pat_xxx
```

`.sandcastle/.env` 已被 Git 忽略，不要把 token 写入 README、提交记录或其他受版本控制的文件。如果 token 泄露，应立即在 GitHub 中撤销并重新创建。

如果宿主机安装了 GitHub CLI，可以在当前目录验证 token：

```bash
set -a
source .sandcastle/.env
set +a
gh auth status
```

## 使用 Codex

Codex 配置会复用宿主机的 `~/.codex/auth.json` 和用户级配置，无需在 `.sandcastle/.env` 中提供 OpenAI API key。

先确认宿主机 Codex 已登录：

```bash
codex login status
```

安装依赖：

```bash
cd codex
npm install --save-dev @ai-hero/sandcastle tsx
npm install zod
```

按照上一节创建 `codex/.sandcastle/.env` 并配置 `GH_TOKEN`，然后构建和运行：

```bash
npx sandcastle docker build-image
npx tsx .sandcastle/main.mts
```

Codex 的容器专用模型配置位于 `.sandcastle/codex-config.toml`。其中访问宿主机服务的地址应使用 `host.docker.internal`，不能使用容器自身的 `127.0.0.1`。

## 使用 Claude Code

Claude Code 配置会读取宿主机的 `~/.claude/settings.json`，无需在 `.sandcastle/.env` 中提供 `CLAUDE_CODE_OAUTH_TOKEN` 或 `ANTHROPIC_API_KEY`。

先确认宿主机配置文件存在，并且 Claude Code 可以正常使用：

```bash
test -f ~/.claude/settings.json
claude auth status
```

安装依赖：

```bash
cd claudecode
npm install
```

按照前面的说明创建 `claudecode/.sandcastle/.env` 并配置 `GH_TOKEN`，然后构建和运行：

```bash
npx sandcastle docker build-image
npx tsx .sandcastle/main.mts
```

启动沙箱时，Claude Code 配置中的 `127.0.0.1`、`localhost` 和 `[::1]` 会自动转换为 `host.docker.internal`，以便容器访问宿主机上的代理或 API 服务。

## 运行流程

Codex 和 Claude Code 使用相同的编排流程：

1. Planner 分析尚未关闭的 GitHub Issues，并选择当前未被依赖阻塞的任务。
2. Implementer 在独立分支和沙箱中实现任务。
3. Reviewer 检查产生的提交。
4. Merger 合并完成的分支。
5. 外层循环继续处理新解除阻塞的 Issue，直到没有可执行任务或达到最大迭代次数。

运行前请根据项目实际情况检查 `.sandcastle/` 下的 prompt、模型名称、最大迭代次数和编码规范。
