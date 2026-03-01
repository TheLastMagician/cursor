# Cloud Agent System 设计与实践文档

> 构建一个类似 Cursor Agent Cloud 的自主编程代理云平台

---

## 目录

- [1. 产品定义与目标](#1-产品定义与目标)
- [2. 系统架构总览](#2-系统架构总览)
- [3. 核心模块设计](#3-核心模块设计)
  - [3.1 虚拟化与沙箱层](#31-虚拟化与沙箱层)
  - [3.2 VM 生命周期管理](#32-vm-生命周期管理)
  - [3.3 Agent 运行时](#33-agent-运行时)
  - [3.4 工具系统 (Tool System)](#34-工具系统-tool-system)
  - [3.5 多 Agent 编排](#35-多-agent-编排)
  - [3.6 Computer Use 模块](#36-computer-use-模块)
  - [3.7 Secrets 与凭据管理](#37-secrets-与凭据管理)
  - [3.8 Artifacts 与证据系统](#38-artifacts-与证据系统)
  - [3.9 持久化知识系统](#39-持久化知识系统)
- [4. 关键流程设计](#4-关键流程设计)
  - [4.1 任务执行全流程](#41-任务执行全流程)
  - [4.2 环境初始化流程](#42-环境初始化流程)
  - [4.3 测试与验证流程](#43-测试与验证流程)
  - [4.4 调试闭环流程](#44-调试闭环流程)
- [5. 技术选型](#5-技术选型)
- [6. 数据模型设计](#6-数据模型设计)
- [7. API 设计](#7-api-设计)
- [8. 安全设计](#8-安全设计)
- [9. 可观测性设计](#9-可观测性设计)
- [10. 扩展性与性能设计](#10-扩展性与性能设计)
- [11. 实践指南](#11-实践指南)
  - [11.1 MVP 路线图](#111-mvp-路线图)
  - [11.2 工具开发实践](#112-工具开发实践)
  - [11.3 Prompt Engineering 实践](#113-prompt-engineering-实践)
  - [11.4 子代理开发实践](#114-子代理开发实践)
  - [11.5 快照与冷启动优化](#115-快照与冷启动优化)
  - [11.6 成本控制实践](#116-成本控制实践)
- [12. 故障模式与容错设计](#12-故障模式与容错设计)
- [13. 与竞品的差异化思考](#13-与竞品的差异化思考)

---

## 1. 产品定义与目标

### 1.1 产品定位

Cloud Agent 是一个 **自主编程代理云平台**，为开发者提供可以独立完成复杂软件工程任务的 AI Agent。与传统 Copilot（逐行补全）不同，Cloud Agent 能够：

- 在隔离的云端环境中自主运行
- 理解完整代码库上下文
- 执行多步骤开发任务（编码、测试、调试、部署）
- 与真实开发工具交互（终端、浏览器、Git）
- 产出可验证的工作证据

### 1.2 核心价值

| 维度 | 传统 Copilot | Cloud Agent |
|------|-------------|-------------|
| 交互模式 | 同步、逐行 | 异步、自主 |
| 上下文 | 当前文件 | 完整代码库 + 运行时 |
| 能力边界 | 代码补全 | 端到端开发 |
| 验证方式 | 人工 review | 自动测试 + 证据产出 |
| 环境 | 本地 IDE | 隔离云端沙箱 |

### 1.3 设计原则

1. **正确性优先于速度**：Agent 必须验证自己的输出，不能"猜测式编程"
2. **隔离性**：每个任务在独立沙箱中运行，互不干扰
3. **可验证性**：所有工作必须产出可审计的证据（截图、视频、日志）
4. **幂等性**：环境初始化和依赖安装必须可重复执行
5. **最小权限**：Agent 只拥有完成任务所需的最少权限

---

## 2. 系统架构总览

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                      用户层 (User Layer)                     │
│  Web UI / IDE Plugin / API Client                           │
├─────────────────────────────────────────────────────────────┤
│                    网关层 (Gateway Layer)                     │
│  WebSocket Gateway / REST API / Auth / Rate Limiting        │
├─────────────────────────────────────────────────────────────┤
│                  编排层 (Orchestration Layer)                 │
│  Task Scheduler / VM Pool Manager / Agent Lifecycle         │
├─────────────────────────────────────────────────────────────┤
│                  Agent 层 (Agent Runtime Layer)              │
│  LLM Router / Tool Executor / Sub-agent Spawner             │
├─────────────────────────────────────────────────────────────┤
│                  沙箱层 (Sandbox Layer)                       │
│  Firecracker VM / Docker Container / File System            │
├─────────────────────────────────────────────────────────────┤
│                  基础设施层 (Infrastructure Layer)             │
│  Compute Cluster / Object Storage / Secret Vault / Registry │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件关系

```
                         ┌──────────┐
                         │  用户请求  │
                         └────┬─────┘
                              │
                         ┌────▼─────┐
                         │  API GW   │
                         └────┬─────┘
                              │
                    ┌─────────▼──────────┐
                    │   Task Scheduler    │
                    │  (任务调度 & 排队)    │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  VM Pool Manager    │
                    │  (VM 分配 & 快照)    │
                    └─────────┬──────────┘
                              │
               ┌──────────────▼──────────────┐
               │      Firecracker VM          │
               │  ┌────────────────────────┐  │
               │  │    Docker Container     │  │
               │  │  ┌──────────────────┐  │  │
               │  │  │   Agent Runtime   │  │  │
               │  │  │  ┌────────────┐  │  │  │
               │  │  │  │  主 Agent   │  │  │  │
               │  │  │  └──┬───┬───┬─┘  │  │  │
               │  │  │     │   │   │     │  │  │
               │  │  │  ┌──▼┐┌─▼─┐┌▼──┐ │  │  │
               │  │  │  │探索││调试││GUI│ │  │  │
               │  │  │  └───┘└───┘└───┘ │  │  │
               │  │  │   子代理 (Sub-agents) │  │  │
               │  │  └──────────────────┘  │  │
               │  └────────────────────────┘  │
               └──────────────────────────────┘
```

---

## 3. 核心模块设计

### 3.1 虚拟化与沙箱层

#### 3.1.1 为什么选择 Firecracker + Docker 双层隔离

| 方案 | 安全隔离 | 启动速度 | 资源开销 | 快照能力 |
|------|---------|---------|---------|---------|
| 纯 Docker | ❌ 弱 | ✅ <1s | ✅ 低 | ❌ 无 |
| 传统 VM (QEMU) | ✅ 强 | ❌ 10s+ | ❌ 高 | ✅ 有 |
| Firecracker microVM | ✅ 强 | ✅ ~125ms | ✅ 低 | ✅ 有 |
| **Firecracker + Docker** | ✅✅ 双层 | ✅ ~1s | ✅ 中 | ✅ 有 |

选择 Firecracker + Docker 的理由：

- **Firecracker** 提供硬件级隔离（KVM），防止 Agent 逃逸到宿主机
- **Docker** 提供标准化的开发环境封装，便于镜像管理和分发
- 两者结合：安全性 × 易用性 的最佳平衡

#### 3.1.2 沙箱环境规格

```yaml
sandbox_spec:
  vm:
    vcpu: 2-8          # 根据任务复杂度动态分配
    memory: 4-16 GiB
    disk: 20-50 GiB    # 需要容纳代码库 + node_modules 等
    kernel: linux 6.1+
    
  container:
    base_image: ubuntu:24.04
    pre_installed:
      - git, curl, wget, jq
      - nvm (node version manager)
      - python3, pip
      - docker-ce (嵌套 docker)
      - chrome (headless + headed)
      - ripgrep (rg)
      - gh (GitHub CLI, 预认证)
    
  storage_driver: fuse-overlayfs   # 嵌套虚拟化兼容
  iptables: iptables-legacy        # 内核兼容
```

#### 3.1.3 Docker-in-Firecracker 的特殊处理

在 Firecracker VM 内运行 Docker 需要额外适配：

```
问题 1: overlay2 存储驱动不兼容
→ 方案: 使用 fuse-overlayfs
→ 配置: /etc/docker/daemon.json → {"storage-driver": "fuse-overlayfs"}

问题 2: nftables 不兼容
→ 方案: 切换到 iptables-legacy
→ 命令: update-alternatives --set iptables /usr/sbin/iptables-legacy

问题 3: Docker 29+ 的 containerd-snapshotter 与 fuse-overlayfs 冲突
→ 方案: 锁定 Docker 28.x 或显式禁用 containerd-snapshotter
```

### 3.2 VM 生命周期管理

#### 3.2.1 状态机

```
                    ┌──────────┐
          ┌────────►│ Snapshot  │────────┐
          │         └──────────┘        │ restore
    snapshot│                            │
          │         ┌──────────┐        │
          │    ┌───►│ Creating │────┐   │
          │    │    └──────────┘    │   │
          │    │         │ ready    │fail│
          │    │    ┌────▼─────┐   │   │
          │    │    │  Ready    │◄──┘   │
          │    │    └────┬─────┘◄──────┘
          │    │         │ assign_task
          │    │    ┌────▼─────┐
          │    │    │ Running   │
          │    │    └────┬─────┘
          │    │         │
          │    │    ┌────▼─────┐
          └────┼────┤ Completed │
               │    └────┬─────┘
               │         │ timeout/error
               │    ┌────▼─────┐
               └────┤ Recycling │
                    └──────────┘
```

#### 3.2.2 VM Pool 策略

```yaml
pool_config:
  warm_pool:
    min_ready: 10              # 最少保持 10 个预热 VM
    max_ready: 50              # 最多预热 50 个
    replenish_threshold: 0.3   # 低于 30% 时补充
    
  scaling:
    strategy: predictive       # 基于历史流量预测
    scale_up_cooldown: 30s
    scale_down_cooldown: 300s
    
  snapshot:
    enabled: true
    max_age: 24h               # 快照最长保留 24 小时
    per_repo_limit: 3          # 每个仓库最多 3 个快照
    
  recycling:
    max_task_duration: 30min   # 单任务最长 30 分钟
    cleanup_grace_period: 60s  # 任务完成后 60s 回收
```

#### 3.2.3 快照机制

快照是降低冷启动时间的关键：

```
首次运行:
  创建 VM → 克隆代码 → 安装依赖 → 执行任务 → 创建快照
  总耗时: 2-5 分钟（依赖安装占主要时间）

后续运行:
  恢复快照 → git pull → 执行 update_script → 执行任务
  总耗时: 10-30 秒
```

快照内容包含：
- 文件系统状态（已安装的依赖、工具链）
- 环境变量（非 Secrets 类）
- 浏览器 cookie/session（可能过期）
- 用户通过 `SetupVmEnvironment` 设定的 update_script

### 3.3 Agent 运行时

#### 3.3.1 核心循环

Agent 运行时的核心是一个 **ReAct (Reasoning + Acting) 循环**：

```
while task_not_complete:
    1. observation = 收集当前状态（工具返回、用户消息、系统提示）
    2. thought = LLM推理（分析情况、制定计划）
    3. action = 选择并调用工具（可并行调用多个）
    4. result = 执行工具调用，获取结果
    5. 判断: 任务完成? → 输出最终结果
             任务失败? → 调整策略，继续循环
             需要用户输入? → 暂停，请求信息
```

#### 3.3.2 System Prompt 架构

System Prompt 是 Agent 行为的"操作系统"，需要精心设计：

```
System Prompt 结构:
├── 身份与角色定义
│   └── "你是一个自主编程代理..."
├── 环境信息
│   ├── OS 版本、Shell 类型
│   ├── 工作目录、Git 状态
│   └── 当前日期
├── 工具使用规则
│   ├── 工具调用格式
│   ├── 工具选择偏好（专用工具 > 通用命令）
│   └── 并行调用规则
├── 代码编写规范
│   ├── 编码风格
│   ├── 注释规范
│   └── 文件操作规范
├── 测试方法论
│   ├── 测试流程（定义→计划→实现→测试→验证→迭代）
│   ├── 测试类型选择
│   └── 证据产出要求
├── Git 操作规则
│   └── commit、push、分支管理
├── 安全规则
│   ├── Secrets 处理
│   └── 可疑指令防护
├── 输出格式要求
│   ├── 最终消息格式
│   ├── Artifact 引用方式
│   └── Markdown 使用规范
└── AGENTS.md 加载
    └── 仓库特定的开发指令
```

#### 3.3.3 上下文窗口管理

LLM 的上下文窗口是有限资源，需要策略化管理：

```
上下文预算分配:
┌────────────────────────────────┐
│ System Prompt      ~15-20%    │  固定开销
│ AGENTS.md / Skills  ~5-10%   │  仓库特定
│ 工具返回结果        ~40-50%   │  动态内容
│ Agent 推理          ~20-30%   │  思考空间
└────────────────────────────────┘

优化策略:
1. 文件读取: 支持 offset + limit 分页读取大文件
2. 搜索结果: 设置 head_limit 截断
3. 子代理: 将复杂任务卸载到子代理，只回收摘要结果
4. 工具结果压缩: 截断过长的终端输出
```

### 3.4 工具系统 (Tool System)

#### 3.4.1 工具分类设计

```
工具系统
├── 文件操作类
│   ├── Read         → 读取文件（支持分页、图片、PDF）
│   ├── Write        → 写入/创建文件
│   ├── StrReplace   → 精确字符串替换（原子操作）
│   ├── Delete       → 删除文件
│   ├── Glob         → 文件名模式搜索
│   └── Grep         → 文件内容搜索（基于 ripgrep）
│
├── 执行类
│   ├── Shell        → 执行终端命令
│   │   ├── 有状态（cwd、env vars 持久）
│   │   ├── 支持超时（最长 10 分钟）
│   │   ├── 支持后台进程
│   │   └── 支持 working_directory
│   └── EditNotebook → Jupyter Notebook 编辑
│
├── 搜索类
│   ├── Grep         → 代码搜索（ripgrep 后端）
│   ├── Glob         → 文件查找
│   └── WebSearch    → 网络搜索（实时信息）
│
├── 代理类
│   └── Task         → 派生子代理
│       ├── generalPurpose
│       ├── explore
│       ├── debug
│       ├── computerUse
│       ├── videoReview
│       └── vmSetupHelper
│
├── 环境类
│   ├── SetupVmEnvironment  → 设定 VM 启动脚本
│   ├── RecordScreen        → 屏幕录制
│   └── TodoWrite           → 任务管理
│
└── 外部集成类
    ├── ListMcpResources    → MCP 资源发现
    └── FetchMcpResource    → MCP 资源获取
```

#### 3.4.2 工具设计原则

**1. 专用工具优于通用命令**

```
❌ Shell("cat file.txt")          → ✅ Read("file.txt")
❌ Shell("grep -r 'pattern' .")   → ✅ Grep(pattern="pattern")
❌ Shell("sed -i 's/a/b/' file")  → ✅ StrReplace(old="a", new="b")
❌ Shell("find . -name '*.js'")   → ✅ Glob("*.js")
```

为什么：
- 专用工具有更好的错误处理和输出格式化
- 减少命令注入风险
- 输出经过优化，减少上下文消耗
- 提供更好的用户体验（IDE 内展示）

**2. 原子性与幂等性**

```
StrReplace 的设计:
- old_string 必须在文件中唯一（否则失败）
- 通过 replace_all 参数控制是否替换所有实例
- 不修改文件的其他部分
- 保留精确的缩进和空白

Shell 的设计:
- 状态持久化（cwd、env vars 跨调用保留）
- 支持超时防止挂起
- 禁止长期运行的进程（dev server 等）
```

**3. 并行调用支持**

```
独立调用 → 并行执行:
  同时 Read("file_a.txt") + Read("file_b.txt") + Grep("pattern")

依赖调用 → 串行执行:
  先 Write("file.txt") → 然后 Shell("node file.txt")
```

#### 3.4.3 Shell 工具的安全约束

```yaml
shell_constraints:
  # 禁止长期运行进程
  banned_patterns:
    - "npm run dev"      # 开发服务器会永久运行
    - "pnpm dev"
    - "watch "           # watch 命令永久运行
    
  # 超时控制
  default_timeout: 30s
  max_timeout: 600s      # 10 分钟
  
  # 危险操作限制
  restricted:
    - "pkill -f"         # 禁止按名称杀进程（太危险）
    - "rm -rf /"         # 明显的破坏性命令
    
  # 后台进程支持
  background:
    enabled: true        # 通过 is_background 参数
    no_ampersand: true   # 不需要 & 符号
```

### 3.5 多 Agent 编排

#### 3.5.1 编排模型

采用 **Star Topology（星型拓扑）**，主 Agent 作为中心节点：

```
                    ┌──────────┐
            ┌──────►│ explore  │
            │       └──────────┘
            │       ┌──────────┐
            ├──────►│  debug   │◄─── 有状态，自动恢复
            │       └──────────┘
┌──────────┐│       ┌──────────┐
│ 主 Agent  ├┼──────►│computerUse│◄── 有状态，自动恢复
└──────────┘│       └──────────┘
            │       ┌──────────┐
            ├──────►│ general  │
            │       └──────────┘
            │       ┌──────────┐
            └──────►│videoReview│
                    └──────────┘
```

关键设计决策：

| 决策 | 选择 | 理由 |
|------|------|------|
| 拓扑 | 星型 | 简化协调，避免子代理间通信复杂性 |
| 并行度 | 最多 4 个 | 平衡速度与资源消耗 |
| 上下文隔离 | 子代理不共享父上下文 | 减少上下文膨胀，强制明确通信 |
| 有状态子代理 | debug / computerUse | 这两类任务天然需要跨轮次记忆 |
| 结果格式 | 纯文本摘要 | 子代理结果需要主代理转述给用户 |

#### 3.5.2 子代理类型设计

**explore 代理（代码探索专家）**

```yaml
explore_agent:
  purpose: 快速代码库探索和理解
  tools: [Read, Glob, Grep, Shell(readonly)]
  thoroughness_levels:
    quick: 基础搜索，1-2 个查询
    medium: 中等探索，多维度搜索
    very_thorough: 深度分析，跨多个位置和命名约定
  stateful: false
  max_duration: 60s
```

**debug 代理（调试专家）**

```yaml
debug_agent:
  purpose: 假设驱动的 Bug 调试
  workflow:
    1. 分析 Bug 描述，形成假设
    2. 在代码中插入诊断日志（instrumentation）
    3. 返回复现步骤给主代理
    4. 主代理执行复现，返回日志
    5. 分析日志，更新假设
    6. 重复直到找到根因
    7. 提供修复方案
    8. 清理诊断日志
  stateful: true   # 自动恢复上下文
  max_iterations: 10
```

**computerUse 代理（GUI 交互专家）**

```yaml
computer_use_agent:
  purpose: 通过桌面/浏览器进行 GUI 测试
  capabilities:
    - 鼠标点击、拖拽
    - 键盘输入
    - 截屏
    - 页面导航
  browser: Chrome (预装)
  display: 虚拟显示 (Xvfb 或类似)
  stateful: true
  screenshot_format: webp/png
```

#### 3.5.3 子代理通信协议

```
主代理 → 子代理:
{
  "prompt": "详细的任务描述（必须包含完整上下文）",
  "attachments": ["file1.mp4"],  // 可选
  "readonly": false               // 可选
}

子代理 → 主代理:
{
  "result": "任务执行结果的文本摘要",
  "agent_id": "uuid"              // 用于后续 resume
}
```

重要：子代理看不到用户消息和主代理的历史步骤，必须通过 prompt 传递所有必要上下文。

### 3.6 Computer Use 模块

#### 3.6.1 架构

```
┌─────────────────────────────────────┐
│          Computer Use Agent          │
│  ┌───────────┐   ┌───────────────┐ │
│  │ Vision LLM │   │ Action Engine │ │
│  │ (截图理解)  │   │ (操作执行)    │ │
│  └─────┬─────┘   └──────┬────────┘ │
│        │                 │          │
│  ┌─────▼─────────────────▼────────┐ │
│  │     Virtual Display (Xvfb)     │ │
│  │  ┌─────────────────────────┐   │ │
│  │  │    Chrome Browser       │   │ │
│  │  │    Desktop Apps         │   │ │
│  │  └─────────────────────────┘   │ │
│  └────────────────────────────────┘ │
└─────────────────────────────────────┘
```

#### 3.6.2 交互循环

```
1. 截取当前屏幕
2. 将截图发送给 Vision LLM
3. LLM 分析截图，决定下一步操作
4. 执行操作（点击、输入、滚动等）
5. 等待 UI 响应
6. 重复 1-5 直到任务完成
7. 返回最终截图和操作摘要
```

#### 3.6.3 屏幕录制集成

```
RecordScreen 工作流:
  START_RECORDING → 开始捕获屏幕帧
  [执行 GUI 操作]
  SAVE_RECORDING  → 停止捕获，编码为视频，保存到 /opt/cursor/artifacts/
  DISCARD_RECORDING → 丢弃（测试失败时）
```

### 3.7 Secrets 与凭据管理

#### 3.7.1 分层架构

```
┌─────────────────────────────────┐
│         Secret Resolution       │
│                                 │
│  优先级 (高 → 低):              │
│  1. .cursor/environment.json    │
│  2. Personal Secrets (用户级)    │
│  3. Team Secrets (团队级)        │
│  4. Repo Secrets (仓库级)       │
│                                 │
│  同名 Secret: Personal > Team   │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│    注入方式: 环境变量             │
│    存储: 加密存储 (at rest)      │
│    传输: 加密传输 (in transit)   │
│    输出: 自动脱敏 [REDACTED]     │
│    提交: Redacted 类型扫描提交   │
└─────────────────────────────────┘
```

#### 3.7.2 Secret 类型

| 类型 | 加密存储 | 加密传输 | 输出脱敏 | 提交扫描 |
|------|---------|---------|---------|---------|
| Secret | ✅ | ✅ | ❌ | ❌ |
| Redacted Secret | ✅ | ✅ | ✅ | ✅ |

### 3.8 Artifacts 与证据系统

#### 3.8.1 设计哲学

传统 AI Agent 声称"代码正确"但无法证明。Cloud Agent 通过 **Artifacts 系统** 强制产出可验证的证据：

```
Artifacts 目录: /opt/cursor/artifacts/
  ├── screenshot_before.webp        # 修改前截图
  ├── screenshot_after.webp         # 修改后截图
  ├── demo_feature_working.mp4      # 功能演示视频
  ├── test_output.log               # 测试输出日志
  └── build_success.log             # 构建成功日志
```

#### 3.8.2 Artifact 生命周期

```
创建 → 不可变存储 → 自动上传 → 用户可见（Web App 中展示）
        │
        └── 一旦写入，不可编辑或删除
            需要重做时创建新文件（唯一名称）
```

#### 3.8.3 质量标准

```
好的 Artifact:
  ✅ 清晰展示代码变更效果
  ✅ 覆盖 happy path + edge cases
  ✅ 最小数量，最大信息量
  ✅ 描述性命名 (snake_case)

差的 Artifact:
  ❌ 失败的测试截图（应该修复后重试）
  ❌ 无关的设置步骤截图
  ❌ 冗余的相似截图
  ❌ 伪造的示例
```

### 3.9 持久化知识系统

#### 3.9.1 双轨持久化

```
┌─────────────────────────────────────────────┐
│              持久化知识系统                    │
│                                             │
│  轨道 1: update_script (自动执行层)           │
│  ┌─────────────────────────────────────┐    │
│  │ • VM 启动时自动执行                   │    │
│  │ • 仅含依赖刷新命令                    │    │
│  │ • 必须幂等、最小化、低风险             │    │
│  │ • 不含服务启动、迁移、构建             │    │
│  │ • 例: npm install / pip install -r   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  轨道 2: AGENTS.md (知识传承层)              │
│  ┌─────────────────────────────────────┐    │
│  │ • 给未来 Agent 阅读的操作手册         │    │
│  │ • 非显而易见的开发注意事项             │    │
│  │ • 服务启动方式和陷阱                  │    │
│  │ • 环境特殊配置                       │    │
│  │ • 不含一次性安装步骤                  │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

#### 3.9.2 AGENTS.md 设计

```markdown
# AGENTS.md

## 通用开发指南
- 代码风格、分支策略、PR 流程...

## Cursor Cloud specific instructions
- 服务启动方式（非显而易见的部分）
- 环境特殊配置和 gotchas
- 依赖安装的注意事项
- 测试运行的特殊要求
```

---

## 4. 关键流程设计

### 4.1 任务执行全流程

```
用户提交任务
    │
    ▼
┌──────────────────┐
│ 1. 任务接收与解析  │  API Gateway 接收，解析意图
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 2. VM 分配        │  从 warm pool 分配或创建新 VM
└────────┬─────────┘  优先使用该仓库的快照
         │
         ▼
┌──────────────────┐
│ 3. 环境初始化     │  git clone/pull → update_script
└────────┬─────────┘  注入 Secrets → 加载 AGENTS.md
         │
         ▼
┌──────────────────┐
│ 4. Agent 启动     │  加载 System Prompt + 用户消息
└────────┬─────────┘  开始 ReAct 循环
         │
         ▼
┌──────────────────┐
│ 5. 自主工作       │  代码探索 → 实现 → 测试 → 调试
└────────┬─────────┘  可能派生子代理
         │
         ▼
┌──────────────────┐
│ 6. 提交与产出     │  git add → commit → push
└────────┬─────────┘  上传 Artifacts
         │
         ▼
┌──────────────────┐
│ 7. 结果交付       │  返回摘要 + 证据给用户
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 8. VM 回收/快照   │  创建快照 or 回收 VM
└──────────────────┘
```

### 4.2 环境初始化流程

```
┌─────────────────────────────────────────────────┐
│              环境初始化详细流程                     │
│                                                 │
│  Phase 1: 并行发现                               │
│  ┌─────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │产品分析   │ │脚本发现   │ │文档/Hook 搜索   │  │
│  │(子代理)  │ │(子代理)   │ │(搜索工具)       │  │
│  └────┬────┘ └────┬─────┘ └───────┬─────────┘  │
│       │           │               │             │
│       ▼           ▼               ▼             │
│  Phase 2: 分析与规划                              │
│  ┌────────────────────────────────────────────┐  │
│  │ 汇总发现 → 创建 TODO 列表 → 确定依赖安装方案 │  │
│  └───────────────────┬────────────────────────┘  │
│                      │                           │
│  Phase 3: 依赖安装                                │
│  ┌───────────────────▼────────────────────────┐  │
│  │ 安装系统依赖 → 安装项目依赖 → 验证安装结果   │  │
│  └───────────────────┬────────────────────────┘  │
│                      │                           │
│  Phase 4: 服务验证                                │
│  ┌───────────────────▼────────────────────────┐  │
│  │ 启动服务 → 运行测试 → Lint 检查 → 构建验证  │  │
│  └───────────────────┬────────────────────────┘  │
│                      │                           │
│  Phase 5: 产出                                   │
│  ┌───────────────────▼────────────────────────┐  │
│  │ 设定 update_script → 写入 AGENTS.md        │  │
│  │ → Hello World 演示 → 证据 Artifacts        │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 4.3 测试与验证流程

```
┌────────────────┐
│ 1. 定义成功状态  │  "什么能说服一个怀疑论者？"
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ 2. 制定测试计划  │  选择: 自动化 / 手动 / 两者兼有
└───────┬────────┘  确定: 前置条件、步骤、预期结果
        │
        ▼
┌────────────────┐
│ 3. 执行实现     │  编写代码、修改配置
└───────┬────────┘
        │
        ▼
┌────────────────┐     ┌─────────────┐
│ 4. 运行测试     │────►│ 自动化测试   │  单元/集成/系统测试
└───────┬────────┘     ├─────────────┤
        │              │ 终端测试     │  curl、脚本、命令行
        │              ├─────────────┤
        │              │ GUI 测试    │  computerUse 子代理
        │              └─────────────┘
        ▼
┌────────────────┐
│ 5. 验证结果     │  批判性审视：结果是否真正证明了正确性？
└───────┬────────┘
        │
    ┌───▼───┐
    │ 通过？ │
    └───┬───┘
     No │ Yes
    ┌───▼───┐  ┌───────────────┐
    │ 调试   │  │ 产出证据       │
    │ 修复   │  │ 截图/视频/日志 │
    │ 重试   │  └───────────────┘
    └───┬───┘
        │
        └──→ 回到步骤 4
```

### 4.4 调试闭环流程

```
┌─────────────────────────────────────────────────────────────┐
│                    假设驱动的调试闭环                          │
│                                                             │
│   主 Agent                        Debug 子代理               │
│   ┌───────┐                      ┌──────────┐              │
│   │描述Bug│ ────"Bug描述+上下文"──► │分析代码   │              │
│   └───────┘                      │形成假设   │              │
│                                  │插入诊断日志│              │
│                                  └────┬─────┘              │
│                                       │                     │
│   ┌───────────┐    ◄──"复现步骤"──────┘                     │
│   │执行复现    │                                             │
│   │(computerUse│                                            │
│   │ 或 Shell)  │                                             │
│   └────┬──────┘                                             │
│        │                                                    │
│        │ ────"已复现+日志"────►  ┌──────────┐               │
│        │                        │分析日志   │               │
│        │                        │更新假设   │               │
│        │                        │          │               │
│        │                    ┌───┤ 确认根因？├───┐            │
│        │                    │No └──────────┘Yes│            │
│        │                    │                  │            │
│        │                    ▼                  ▼            │
│        │              ┌──────────┐      ┌──────────┐       │
│        │              │追加诊断   │      │提供修复   │       │
│        │ ◄────────────│返回新步骤 │      │方案      │       │
│        │              └──────────┘      └────┬─────┘       │
│        │                                     │             │
│   ┌────▼──────┐                              │             │
│   │应用修复    │◄─────────────────────────────┘             │
│   │验证修复    │                                            │
│   └────┬──────┘                                            │
│        │                                                    │
│        │ ────"已修复，清理日志"──► ┌──────────┐              │
│        │                          │移除诊断  │              │
│        │                          │代码      │              │
│   ┌────▼──────┐                   └──────────┘              │
│   │完成       │                                             │
│   └───────────┘                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. 技术选型

### 5.1 基础设施层

| 组件 | 推荐技术 | 备选 | 选型理由 |
|------|---------|------|---------|
| microVM | **Firecracker** | Cloud Hypervisor, gVisor | AWS 开源、125ms 启动、内存 <5MB |
| 容器运行时 | **Docker** | Podman, containerd | 生态成熟，开发者熟悉 |
| 容器编排 | **Kubernetes** | Nomad | 成熟的调度和扩缩容 |
| 对象存储 | **S3 / MinIO** | GCS, Azure Blob | Artifacts 存储 |
| Secret 管理 | **HashiCorp Vault** | AWS Secrets Manager | 多层密钥管理 |
| 镜像仓库 | **ECR / Harbor** | Docker Hub | 私有镜像管理 |

### 5.2 应用层

| 组件 | 推荐技术 | 选型理由 |
|------|---------|---------|
| API Gateway | **Kong / Envoy** | 高性能、可扩展 |
| 任务队列 | **Redis Streams / NATS** | 低延迟、支持持久化 |
| 实时通信 | **WebSocket** | 双向实时通信 |
| Agent 运行时 | **TypeScript / Python** | LLM SDK 生态丰富 |
| LLM 集成 | **Anthropic API / OpenAI API** | 通过 LLM Router 抽象 |

### 5.3 可观测性

| 组件 | 推荐技术 | 用途 |
|------|---------|------|
| 日志 | **Loki / ELK** | Agent 执行日志 |
| 指标 | **Prometheus + Grafana** | 系统和业务指标 |
| 链路追踪 | **Jaeger / OpenTelemetry** | 跨服务调用追踪 |
| 告警 | **PagerDuty / Alertmanager** | 异常告警 |

---

## 6. 数据模型设计

### 6.1 核心实体

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    User      │────►│   Session   │────►│    Task      │
│  用户        │ 1:N │   会话      │ 1:N │   任务       │
└─────────────┘     └──────┬──────┘     └──────┬──────┘
                           │                    │
                    ┌──────▼──────┐      ┌──────▼──────┐
                    │  Repository │      │   VM        │
                    │  代码仓库    │      │  虚拟机      │
                    └─────────────┘      └──────┬──────┘
                                                │
                                         ┌──────▼──────┐
                                         │  Snapshot    │
                                         │  快照        │
                                         └─────────────┘
```

### 6.2 关键表结构

```sql
-- 任务
CREATE TABLE tasks (
    id            UUID PRIMARY KEY,
    session_id    UUID REFERENCES sessions(id),
    user_id       UUID REFERENCES users(id),
    repo_url      TEXT NOT NULL,
    branch        TEXT NOT NULL,
    prompt        TEXT NOT NULL,
    status        ENUM('queued','running','completed','failed','cancelled'),
    vm_id         UUID REFERENCES vms(id),
    started_at    TIMESTAMP,
    completed_at  TIMESTAMP,
    result        JSONB,           -- 最终结果摘要
    artifacts     JSONB,           -- artifact 文件列表
    token_usage   JSONB,           -- LLM token 消耗
    created_at    TIMESTAMP DEFAULT NOW()
);

-- VM 实例
CREATE TABLE vms (
    id            UUID PRIMARY KEY,
    status        ENUM('creating','ready','running','completed','recycling'),
    spec          JSONB,           -- vcpu, memory, disk
    snapshot_id   UUID REFERENCES snapshots(id),
    repo_url      TEXT,
    update_script TEXT,
    created_at    TIMESTAMP,
    last_used_at  TIMESTAMP
);

-- 快照
CREATE TABLE snapshots (
    id            UUID PRIMARY KEY,
    vm_id         UUID REFERENCES vms(id),
    repo_url      TEXT NOT NULL,
    repo_commit   TEXT,
    size_bytes    BIGINT,
    status        ENUM('creating','ready','expired'),
    created_at    TIMESTAMP,
    expires_at    TIMESTAMP
);

-- Secrets
CREATE TABLE secrets (
    id            UUID PRIMARY KEY,
    owner_id      UUID,            -- user or team
    owner_type    ENUM('personal','team'),
    repo_scope    TEXT,            -- 可选的仓库范围
    name          TEXT NOT NULL,
    encrypted_value BYTEA NOT NULL,
    secret_type   ENUM('secret','redacted'),
    created_at    TIMESTAMP
);

-- 子代理调用
CREATE TABLE subagent_invocations (
    id            UUID PRIMARY KEY,
    task_id       UUID REFERENCES tasks(id),
    parent_agent  UUID,            -- 父代理 ID
    agent_type    TEXT NOT NULL,
    prompt        TEXT NOT NULL,
    result        TEXT,
    status        ENUM('running','completed','failed'),
    token_usage   JSONB,
    created_at    TIMESTAMP,
    completed_at  TIMESTAMP
);
```

---

## 7. API 设计

### 7.1 核心 API

```yaml
# 任务管理
POST   /api/v1/tasks                    # 创建任务
GET    /api/v1/tasks/{id}               # 查询任务状态
DELETE /api/v1/tasks/{id}               # 取消任务
GET    /api/v1/tasks/{id}/artifacts     # 获取 Artifacts
GET    /api/v1/tasks/{id}/logs          # 获取执行日志

# 实时通信
WS     /api/v1/tasks/{id}/stream        # WebSocket 实时流
  Events:
    - agent.thinking        # Agent 思考过程
    - agent.tool_call       # 工具调用
    - agent.tool_result     # 工具结果
    - agent.message         # Agent 消息
    - task.completed        # 任务完成
    - task.blocked          # 任务被阻塞（需要用户输入）

# VM 管理 (内部 API)
POST   /internal/vms                     # 创建 VM
POST   /internal/vms/{id}/snapshot       # 创建快照
POST   /internal/vms/{id}/restore        # 从快照恢复
DELETE /internal/vms/{id}                # 回收 VM

# Secrets 管理
POST   /api/v1/secrets                   # 创建 Secret
GET    /api/v1/secrets                   # 列出 Secrets
DELETE /api/v1/secrets/{id}              # 删除 Secret
```

### 7.2 WebSocket 消息格式

```json
// Agent 思考
{
  "type": "agent.thinking",
  "data": {
    "content": "我需要先分析代码库结构..."
  }
}

// 工具调用
{
  "type": "agent.tool_call",
  "data": {
    "tool": "Shell",
    "parameters": {
      "command": "npm test",
      "description": "Run unit tests"
    }
  }
}

// 任务被阻塞
{
  "type": "task.blocked",
  "data": {
    "reason": "missing_secrets",
    "required_actions": [
      {
        "type": "add_secrets",
        "secrets": ["DATABASE_URL", "API_KEY"]
      }
    ]
  }
}
```

---

## 8. 安全设计

### 8.1 威胁模型

```
┌─────────────────────────────────────────────────────────┐
│                    威胁矩阵                              │
│                                                         │
│  威胁 1: Agent 逃逸                                      │
│  ├── 攻击: Agent 尝试突破沙箱                              │
│  ├── 防护: Firecracker 硬件隔离 + 最小 Linux 内核         │
│  └── 检测: 系统调用审计                                   │
│                                                         │
│  威胁 2: Prompt 注入                                     │
│  ├── 攻击: 恶意代码库/网页中嵌入指令                        │
│  ├── 防护: 工具结果中的指令被标记为不可信                    │
│  └── 检测: 异常行为模式检测                                │
│                                                         │
│  威胁 3: Secret 泄露                                     │
│  ├── 攻击: Agent 输出中包含 Secret 值                     │
│  ├── 防护: 输出自动脱敏 + Redacted 类型扫描提交             │
│  └── 检测: 正则匹配已知 Secret 模式                       │
│                                                         │
│  威胁 4: 资源滥用                                        │
│  ├── 攻击: 无限循环、挖矿、DDoS                           │
│  ├── 防护: 资源配额 + 任务超时 + 网络出口限制               │
│  └── 检测: 资源使用异常告警                                │
│                                                         │
│  威胁 5: 供应链攻击                                       │
│  ├── 攻击: 恶意依赖包执行任意代码                           │
│  ├── 防护: 沙箱隔离 + 网络限制                             │
│  └── 检测: 包安装时的行为监控                              │
└─────────────────────────────────────────────────────────┘
```

### 8.2 安全控制矩阵

| 层级 | 控制措施 | 实现方式 |
|------|---------|---------|
| 网络 | 出口白名单 | iptables 规则，仅允许 Git、npm registry 等 |
| 计算 | 资源配额 | cgroups 限制 CPU、内存、磁盘 IO |
| 进程 | 系统调用过滤 | seccomp 配置文件 |
| 文件 | 路径限制 | 只能访问 /workspace 及白名单路径 |
| 凭据 | 加密 + 脱敏 | Vault 管理 + 输出扫描 |
| 时间 | 执行超时 | 30 分钟硬性上限 |

### 8.3 进程安全规则

```yaml
process_safety:
  # 禁止按名称杀进程（可能杀错关键进程）
  banned_commands:
    - "pkill -f"
    - "killall"
    
  # 进程管理必须使用具体 PID
  allowed:
    - "kill <specific_pid>"
    
  # 禁止交互式命令（会阻塞）
  banned_patterns:
    - 需要 TTY 输入的命令
    - 交互式菜单/确认
    - 密码提示
```

---

## 9. 可观测性设计

### 9.1 指标体系

```yaml
# 系统指标
system_metrics:
  - vm_pool_size{status}           # VM 池大小（按状态）
  - vm_startup_duration_seconds    # VM 启动耗时
  - vm_utilization_ratio           # VM 利用率
  - snapshot_create_duration       # 快照创建耗时
  - snapshot_restore_duration      # 快照恢复耗时

# Agent 指标
agent_metrics:
  - task_duration_seconds          # 任务总耗时
  - task_status_total{status}      # 任务状态计数
  - tool_call_total{tool}          # 工具调用次数
  - tool_call_duration{tool}       # 工具调用耗时
  - subagent_spawn_total{type}     # 子代理创建次数
  - llm_tokens_total{direction}    # LLM token 消耗

# 业务指标
business_metrics:
  - task_success_rate              # 任务成功率
  - user_satisfaction_score        # 用户满意度
  - code_accepted_rate             # 代码被接受率
  - avg_iterations_per_task        # 每任务平均迭代次数
  - cost_per_task_usd              # 每任务成本
```

### 9.2 日志分级

```
Level 1 - 审计日志 (永久保留):
  用户操作、Secret 访问、Git 操作

Level 2 - Agent 日志 (保留 30 天):
  工具调用、LLM 输入/输出、子代理通信

Level 3 - 系统日志 (保留 7 天):
  VM 生命周期、容器事件、网络流量

Level 4 - 调试日志 (保留 24 小时):
  详细的 LLM prompt、工具中间结果
```

---

## 10. 扩展性与性能设计

### 10.1 扩缩容策略

```
┌─────────────────────────────────────────────┐
│              自动扩缩容架构                    │
│                                             │
│  Layer 1: VM Pool 自动补充                   │
│  ┌───────────────────────────────────────┐  │
│  │ 监控 warm pool 水位                    │  │
│  │ 低于阈值 → 预创建 VM                   │  │
│  │ 高于阈值 → 停止创建                    │  │
│  │ 策略: 基于历史流量预测性扩容            │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  Layer 2: 计算节点自动扩缩                   │
│  ┌───────────────────────────────────────┐  │
│  │ K8s HPA / Cluster Autoscaler          │  │
│  │ 根据 VM 密度自动增减物理节点             │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  Layer 3: LLM 请求负载均衡                   │
│  ┌───────────────────────────────────────┐  │
│  │ 多 LLM Provider 路由                   │  │
│  │ 优先级: 速度 / 成本 / 质量 可配置       │  │
│  │ 熔断: 单 Provider 故障自动切换          │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 10.2 冷启动优化

```
优化目标: 用户提交任务到 Agent 开始工作 < 30 秒

优化手段:
1. VM 预热池
   - 维持 N 个已启动的空白 VM
   - 收到任务后立即分配，无需等待启动
   
2. 快照恢复
   - 对频繁使用的仓库保留环境快照
   - 恢复快照 vs 全新安装: 10s vs 2-5min
   
3. 分层镜像
   - Base 镜像: OS + 基础工具 (不常变)
   - Runtime 镜像: Node/Python 特定版本 (偶尔变)
   - Project 镜像: 项目依赖 (快照层)
   
4. 并行初始化
   - VM 启动 ∥ 代码克隆 ∥ Secret 注入
   - 不要串行执行可以并行的步骤

5. 增量更新
   - git pull (增量) 替代 git clone (全量)
   - npm ci 替代 npm install (确定性更好)
```

### 10.3 成本模型

```
单次任务成本构成:
┌────────────────────────┬──────────────┬─────────┐
│ 成本项                  │ 典型值        │ 占比     │
├────────────────────────┼──────────────┼─────────┤
│ LLM API 调用 (主Agent) │ $0.50-5.00   │ 60-70%  │
│ LLM API 调用 (子Agent) │ $0.10-1.00   │ 10-15%  │
│ VM 计算资源             │ $0.05-0.20   │ 5-10%   │
│ 存储 (快照+Artifacts)   │ $0.01-0.05   │ 1-3%    │
│ 网络                   │ $0.01-0.02   │ <1%     │
│ 基础设施管理            │ $0.05-0.10   │ 5-10%   │
├────────────────────────┼──────────────┼─────────┤
│ 总计                   │ $0.72-6.37   │ 100%    │
└────────────────────────┴──────────────┴─────────┘

关键洞察: LLM 调用占绝对主导，优化 token 使用是降本核心
```

---

## 11. 实践指南

### 11.1 MVP 路线图

```
Phase 1: 基础沙箱 (4-6 周)
├── Firecracker VM 管理 (创建、销毁)
├── Docker 容器运行
├── 基础工具系统 (Shell, Read, Write, Grep)
├── 单 Agent ReAct 循环
└── Git 集成 (clone, commit, push)

Phase 2: 完整工具链 (4-6 周)
├── 全部文件操作工具
├── 子代理系统 (explore, generalPurpose)
├── WebSocket 实时流
├── Secrets 管理
└── Artifacts 系统

Phase 3: 高级能力 (6-8 周)
├── Computer Use (GUI 交互)
├── Debug 子代理
├── 屏幕录制
├── VM 快照与恢复
└── update_script + AGENTS.md 持久化

Phase 4: 生产化 (4-6 周)
├── VM Pool 管理与自动扩缩容
├── 可观测性全栈
├── 安全加固
├── 成本优化
└── 多租户隔离
```

### 11.2 工具开发实践

#### 11.2.1 工具接口规范

每个工具应实现统一接口：

```
Tool Interface:
  name: string                  # 工具名称
  description: string           # 给 LLM 的描述（影响调用质量）
  parameters: JSONSchema         # 参数定义
  execute(params) → Result      # 执行逻辑
  validate(params) → Error?     # 参数验证
  sanitize(result) → Result     # 结果清理（脱敏等）
```

#### 11.2.2 工具描述编写原则

工具描述直接影响 LLM 的调用质量：

```
好的描述:
✅ 明确说明工具的用途和适用场景
✅ 包含使用示例
✅ 说明与其他工具的关系（何时用这个 vs 那个）
✅ 列出重要的约束和限制

差的描述:
❌ 过于简短，缺少上下文
❌ 没有区分与相似工具的使用场景
❌ 缺少参数的语义解释
```

#### 11.2.3 工具结果格式化

```
原则:
1. 结构化输出（方便 LLM 解析）
2. 包含足够上下文（减少后续查询）
3. 控制输出大小（避免溢出上下文窗口）
4. 敏感信息脱敏

示例 - Grep 结果:
  - 按文件分组
  - 包含行号
  - 显示匹配上下文 (-A, -B, -C)
  - 截断过长结果并提示总数

示例 - Shell 结果:
  - 包含 exit code
  - 包含 stdout 和 stderr
  - 报告执行耗时
  - 提示状态持久化
```

### 11.3 Prompt Engineering 实践

#### 11.3.1 System Prompt 组织

```
设计要点:

1. 分层结构
   核心规则 → 工具使用规则 → 领域规则 → 格式规则
   
2. 优先级明确
   系统指令 > 用户指令 > AGENTS.md > 默认行为
   
3. 正例 + 反例
   每条规则同时给出"应该做"和"不应该做"的例子
   
4. 可组合
   通过 XML 标签分区，按需组合不同模块
   
5. 避免冲突
   定期审查规则间是否存在矛盾
```

#### 11.3.2 子代理 Prompt 设计

```
关键原则:

1. 自包含
   子代理看不到父上下文，prompt 必须包含所有必要信息
   
2. 明确期望
   清晰说明期望返回什么格式、什么内容
   
3. 范围限定
   明确子代理应该做什么、不应该做什么

4. 上下文传递模板:
   "你正在分析仓库 X 的代码库。
    当前分支: Y
    任务: Z
    已知信息: ...
    请返回: ..."
```

#### 11.3.3 测试方法论的 Prompt 设计

```
核心理念: 不信任自己的代码

嵌入到 System Prompt 中的测试思维:
1. "传统 AI 猜测基于代码，你需要运行时数据"
2. "定义成功状态: 什么能说服怀疑论者？"
3. "不充分的测试: 编译通过 ≠ 代码正确"
4. "批判性验证: 结果是否真正证明了正确性？"
5. "失败是正常的，迭代是期望的"
```

### 11.4 子代理开发实践

#### 11.4.1 子代理类型选择矩阵

```
任务特征                    → 推荐子代理类型
─────────────────────────────────────────
快速查找文件/代码           → explore
复杂多步骤任务              → generalPurpose
可复现 Bug 的调试           → debug
GUI 交互测试               → computerUse
视频内容审查               → videoReview
环境探索/依赖发现           → vmSetupHelper
```

#### 11.4.2 子代理间协作模式

```
模式 1: 扇出-汇总 (Fan-out Gather)
  主Agent 同时派出多个 explore 子代理
  分别搜索不同维度，汇总结果后决策

模式 2: 流水线 (Pipeline)
  explore → 发现问题
  debug → 定位根因
  主Agent → 修复
  computerUse → 验证

模式 3: 迭代 (Iterative)
  debug ←→ 主Agent 反复交互
  直到找到并修复根因
```

### 11.5 快照与冷启动优化

#### 11.5.1 快照策略

```yaml
snapshot_policy:
  # 触发条件
  trigger:
    - 依赖安装完成后（最大收益点）
    - 任务成功完成后
    
  # 失效条件
  invalidation:
    - 仓库 lockfile 变更 (package-lock.json 等)
    - 快照年龄超过 24 小时
    - 用户手动清除
    
  # 存储优化
  storage:
    compression: zstd
    deduplication: block-level
    max_size: 10GB per snapshot
```

#### 11.5.2 update_script 设计原则

```
update_script 是快照恢复后的"热补丁":

✅ 应该做:
  - 依赖刷新 (npm install, pip install -r requirements.txt)
  - 必须幂等
  - 必须快速 (<30s 理想)
  - 必须容错（不依赖未合并 PR 中的文件）

❌ 不应该做:
  - 启动服务 (docker compose up)
  - 运行迁移 (python manage.py migrate)
  - 构建项目 (npm run build)
  - 修改 shell profile (echo >> ~/.bashrc)
  - 设置环境变量 (export FOO=bar)
```

### 11.6 成本控制实践

#### 11.6.1 Token 优化策略

```
1. 工具结果截断
   - 搜索结果: 默认限制 N 条
   - Shell 输出: 截断超长输出
   - 文件读取: 分页读取大文件

2. 子代理卸载
   - 复杂探索任务交给子代理
   - 只回收摘要结果到主上下文

3. 避免重复读取
   - 读取过的文件信息缓存在上下文中
   - 搜索前先判断是否已有足够信息

4. Prompt 精简
   - 移除冗余规则
   - 合并相似指令
   - 按需加载领域规则
```

#### 11.6.2 计算资源优化

```
1. VM 池化
   - 避免冷启动开销
   - 预热池大小基于历史流量预测

2. 快照复用
   - 同仓库不同任务共享环境快照
   - 增量更新代替全量安装

3. 资源动态分配
   - 简单任务: 2 vCPU / 4GB
   - 复杂任务: 8 vCPU / 16GB
   - 基于任务特征自动选择

4. 空闲回收
   - 任务完成后 grace period 保留
   - 超时自动回收
```

---

## 12. 故障模式与容错设计

### 12.1 故障分类与处理

| 故障类型 | 示例 | 检测方式 | 恢复策略 |
|---------|------|---------|---------|
| VM 故障 | 内存溢出、磁盘满 | 心跳检测 | 标记失败，分配新 VM 重试 |
| Agent 死循环 | 无限工具调用 | 迭代计数器 | 超过阈值强制终止 |
| LLM 服务不可用 | API 超时 | HTTP 状态码 | 退避重试 → 切换 Provider |
| 工具执行失败 | Shell 命令失败 | exit code | 返回错误给 Agent 决策 |
| 快照损坏 | 恢复失败 | 健康检查 | 回退到全新 VM |
| 网络中断 | WebSocket 断开 | 心跳超时 | 自动重连 + 状态同步 |

### 12.2 优雅降级

```
完整能力
  │
  ├── LLM Provider A 不可用 → 自动切换 Provider B
  │
  ├── 快照恢复失败 → 回退到全新 VM（慢但可用）
  │
  ├── Computer Use 不可用 → 降级为纯终端测试
  │
  ├── 网络受限 → 使用本地缓存的依赖
  │
  └── 所有 Provider 不可用 → 排队等待恢复
```

---

## 13. 与竞品的差异化思考

### 13.1 市场格局

```
┌──────────────────────────────────────────────────────┐
│                  AI 编程助手演化路径                    │
│                                                      │
│  Stage 1: 代码补全                                    │
│  └── GitHub Copilot, Tabnine, Codeium                │
│                                                      │
│  Stage 2: 对话式编程                                  │
│  └── ChatGPT, Claude (Chat), Cursor (Chat mode)     │
│                                                      │
│  Stage 3: Agentic 编程 (当前阶段)                     │
│  └── Cursor Agent, Devin, Windsurf, Codex            │
│                                                      │
│  Stage 4: 自主编程 (Cloud Agent, 我们在这里)           │
│  └── Cursor Cloud Agent, Devin, Factory, Augment     │
│                                                      │
│  Stage 5: 编程团队 (未来)                              │
│  └── 多 Agent 协作完成大型项目                         │
└──────────────────────────────────────────────────────┘
```

### 13.2 关键差异化方向

```
1. 可验证性
   竞品: "我完成了任务"
   我们: "这是任务完成的视频证据"

2. 环境持久化
   竞品: 每次从零开始
   我们: 快照 + update_script + AGENTS.md 三层持久化

3. 调试深度
   竞品: 基于代码猜测
   我们: 假设驱动 + 运行时诊断 + 迭代闭环

4. 混合测试
   竞品: 仅运行已有测试
   我们: 自动化测试 + GUI 手动测试 + 证据产出

5. 开发者体验
   竞品: 黑盒操作
   我们: 实时流 + 可审计 + 可中断
```

---

## 附录 A: 参考资源

| 资源 | 链接 |
|------|------|
| Firecracker | https://github.com/firecracker-microvm/firecracker |
| Firecracker 快照文档 | https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md |
| Claude Computer Use | https://docs.anthropic.com/en/docs/agents-and-tools/computer-use |
| ReAct 论文 | https://arxiv.org/abs/2210.03629 |
| MCP 协议 | https://modelcontextprotocol.io/ |
| fuse-overlayfs | https://github.com/containers/fuse-overlayfs |

## 附录 B: 术语表

| 术语 | 定义 |
|------|------|
| Agent | 能够自主决策和执行任务的 AI 程序 |
| ReAct | Reasoning + Acting，Agent 的推理-行动循环模式 |
| microVM | 轻量级虚拟机，如 Firecracker |
| Warm Pool | 预启动的 VM 池，用于减少冷启动时间 |
| Snapshot | VM 状态快照，包含内存和磁盘状态 |
| Sub-agent | 由主 Agent 派生的专用子代理 |
| Artifact | Agent 产出的证据文件（截图、视频、日志） |
| update_script | VM 启动时自动执行的依赖刷新脚本 |
| Instrumentation | 调试时插入的诊断代码/日志 |
| Computer Use | 通过视觉模型操作 GUI 的能力 |
