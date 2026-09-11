# dsh-websearch-toggle

给 DeepSeek Harness 的「**网页搜索**」插件卡片加一个真正生效的开关。

开关就放在配置本身所在的地方：展开 **设置 → 插件 → 插件配置 → 网页搜索**，
它的第一行就是这个开关。**收起的卡片上没有任何控件**，关闭时只有整体变灰的
观感。

[English](README.md) | 中文

## 开关做什么

**关闭**

- 所有 agent 都不再拿到 `web_search` 工具。工具本身、以及提示模型去用它的那段
  系统提示，都会在下一个模型步的 prompt 组装里被剔除，**对所有会话立即生效**，
  包括已经存在的会话。模型看不到这个工具，自然也不会调用它，也就不会有任何请求
  发往计费的 DeepSeek 搜索接口。
- 翻转开关时已经在派发途中的调用，会被一个全局 tool guard 拒绝，而不是送到
  提供方。
- 卡片变灰：API Key、接口地址、单次请求最多搜索次数三个控件一起变淡并且不再接受
  输入，一眼就能看出这份配置已经失效。

**打开** —— 上一条在下一个模型步全部复原。不需要重启，也不需要新建会话。

## 开关**不**碰什么

- `web_fetch` 和本地抓取提供方照常工作。这是搜索开关，不是断网开关。
- **不修改 profile 里的任何文件。** `web-search-deepseek` 那一行仍然待在 bundle
  给它安排的位置上；开关是进程内的效果，所以随时可以翻回去。这正是它和手工去改
  `cordis.patch.yml`、改 agent 预设的区别。
- 你已经保存的接口地址、密钥、次数上限都保留，只是关闭期间不生效。

## 安装

```bash
dsh plugin --profile web add github:mathangler/dsh-websearch-toggle
```

装完需要**重启 `dsh web`** —— bundle 行是启动时组装的，正在运行的服务在重启
之前不会提供这个开关。

面向 DSH `0.1.5-rc.1`。受限网络下 `github.com` 对 `git` 可能不可达，但安装走的是
`codeload.github.com`，通常没问题。

### 在这个插件上开发

`github:` 和 `link:` 是互斥的 spec。要在本地检出上开发，换掉安装方式：

```bash
dsh plugin --profile web remove dsh-websearch-toggle
dsh plugin --profile web add link:<本目录的绝对路径>
```

`link:` 是符号链接，改完源码下次启动即生效；`file:` 是复制。已安装的 `github:`
插件要更新，同样需要 `remove` + `add` —— spec 没变时 pnpm 会跳过解析。

## 状态存放

`<dshHome>/websearch-toggle.json` 里一个持久化的布尔值：

```json
{
  "enabled": true
}
```

`dshHome` 取 `$DSH_HOME`，未设置时为 `~/.dsh`。文件原子写入，启动时读一次，
浏览器询问时再读一次。它**刻意不是**一个注册的 settings 命名空间：注册命名空间
需要 `@deepseek-ai/schemastery` 的 schema，而本包是以链接方式装进 profile 的，
模块解析发生在它自己的目录而不是 profile 目录 —— 这也是它的宿主半边只 import
`node:` 内置模块的原因。

文件不存在或读不出来一律按**开启**处理，也就是维持出厂行为：一个坏掉的 state
文件绝不该悄悄地把能力删掉。

## 为什么这么实现

`web_search` 既不是模型特性，也不是平台暴露的开关。agent 预设的 `tool-web` 行
把工具注册进该预设的作用域层，而预设在会话生命周期内是固定的，所以第三方插件
无法注销它。`ctx.tools.restrict()` 在非作用域上下文里被明确拒绝（"a
context-global restriction would mask every agent"）。可用的接缝因此是组装
waterfall：`system-prompt/assemble` 的返回值被注册表视为权威，于是把工具和
`tool:web_search` 从中移除，效果等同于 `tool-web` 的 `search: false` —— 但它是
实时的、按步可逆的。

浏览器半边用 `MutationObserver` 把这一行注入卡片的展开态 body。以
`web-search-deepseek` 为 key 再注册一张 `settings.plugin.item` 卡片，只会在真
卡片旁边多出**第二张卡片**，而不是卡内控件；另一个 bundle 也够不到那张卡片的
React 树。注入发生在 mutation 回调内、同步执行，因此这一行和卡片 body 在同一帧
出现。

## 测试

```bash
node test/host-core.test.mjs   # 14 —— 状态机与两个投影
node test/route.test.mjs       # 10 —— HTTP 路由、信封、信任围栏
node test/load.test.mjs        # 18 —— 浏览器半边（假 DOM）
pwsh -File test/e2e-serve.ps1  # 在 :3099 起一个临时 `dsh web`
```

`test/e2e-serve.ps1` 验证单测验证不了的部分：宿主半边启动后 stderr 为空、
`/plugins/??dsh-websearch-toggle/client.js` 提供的是本次构建的符号、路由对已认证
调用返回 200 + 信封、写入真正落盘，而同一路由对未认证调用返回 401、对非 POST
返回 405。

各测试文件是直接执行的，而不是走 `node --test`（后者会为每个文件 spawn 子进程）。

## 已知边界

- **开关依赖宿主卡片的形状。** 它靠标题文字（`网页搜索` / `Web search`）和结构
  （`li` → `button[aria-expanded]` → `div`）定位，从不依赖宿主那些带哈希的类名。
  将来某个版本若改了卡片标题或重构了 `PluginCard`，需要重新核对这两个匹配器。
- **客户端只是表现层。** 浏览器半边加载失败时开关消失，但宿主效果仍按持久化的值
  生效。
- 开关作用于当前这个服务进程。用同一个 home 起的第二个服务会读同一个状态文件，
  但它的组合是在自己启动时确定的。
