# Sandcastle for Agent

一个自动循环处理 GitHub Issue 的工具，适用于 Codex 和 Claude Code。

## 使用说明

1. 克隆当前项目到本地并进入 `codex` 目录。

   ```bash
   git clone https://github.com/liumingjian/sandcastle-for-agent.git
   cd sandcastle-for-agent/codex
   ```

2. 安装 Sandcastle 开发依赖。

   ```bash
   npm install --save-dev @ai-hero/sandcastle
   ```

3. 安装 Zod 模块。

   ```bash
   npm install zod
   ```

4. 构建 Docker 镜像。

   ```bash
   npx sandcastle docker build-image
   ```

5. 运行自动循环脚本。

   ```bash
   npx tsx .sandcastle/main.mts
   ```
