# dsh-websearch-toggle

给 DeepSeek Harness 的「**网页搜索**」插件页面加一个真正生效的开关。

打开侧栏的**插件**页面 → **网页搜索**条目 → 开关就在该条目页面的第一行，位于它所
管辖的 API Key、接口地址、单次请求最多搜索次数三个字段之上。卡片不展开时页面上
没有任何控件。

[English](README.md) | 中文

## 开关做什么

**关闭**

- 所有 agent 都不再拿到 `web_search` 工具。工具本身、以及提示模型去用它的那段
  系统提示，都会在下一个模型步的 prompt 组装里被剔除，**对所有会话立即生效**，
  包括已经存在的会话。模型看不到这个工具，自然也不会调用它，也就不会有任何请求
  发往计费的 DeepSeek 搜索接口。
- 翻转开关时已经在派发途中的调用，会被一个全局 tool guard 拒绝，而不是送到
  提供方。

**打开** —— 上两条在下一个模型步全部复原。不需要重启，也不需要新建会话。

## 开关**不**碰什么

- `web_fetch` 和本地抓取提供方照常工作。这是搜索开关，不是断网开关。
- **不修改 profile 里的任何文件。** `web-search-deepseek` 那一行仍然待在 bundle
  给它安排的位置上，所以随时可以翻回去 —— 这正是它和手工去改
  `cordis.patch.yml`、改 agent 预设的区别。
- 你已经保存的接口地址、密钥、次数上限都保留，只是关闭期间不生效。

## 安装

```bash
dsh plugin --profile web add github:mathangler/dsh-websearch-toggle
```

装完需要**重启 `dsh web`** —— bundle 行是启动时组装的，正在运行的服务在重启
之前不会提供这个插件。

面向 DSH `0.1.6-alpha.2`。0.1.x 面向 0.1.5（插件配置当时在「设置」里），0.2.x
面向 0.1.6 引入的侧栏「插件」页面。

### 在这个插件上开发

`github:` 和 `link:` 是互斥的 spec：

```bash
dsh plugin --profile web remove dsh-websearch-toggle
dsh plugin --profile web add link:<本目录的绝对路径>
```

`link:` 是符号链接，改完源码下次启动即生效。已安装的 `github:` 插件要更新，同样
需要 `remove` + `add` —— spec 没变时 pnpm 会跳过解析。

## 状态存放

`<dshHome>/settings.yaml` 里一个布尔值：

```yaml
web-search-toggle:
  enabled: false
```

`dshHome` 取 `$DSH_HOME`，未设置时为 `~/.dsh`。**没有这个键就是开启**，也就是
出厂行为，所以从不写这个键的部署不会丢掉能力。

没有自定义路由，也没有单独的 state 文件。浏览器半边通过平台自己的 settings
Remote 写入这个命名空间，用的是和页面上其它设置表单完全相同的 revision 围栏，
因此浏览器的写入**本身就是提交**，宿主通过自己注册的命名空间得知结果。

## 为什么这么实现

`web_search` 既不是模型特性，也不是平台暴露的开关。agent 预设的 `tool-web` 行
把工具注册进该预设的作用域层，而预设在会话生命周期内是固定的，所以本插件无法
注销它；`ctx.tools.restrict()` 在非作用域上下文里被明确拒绝（"a context-global
restriction would mask every agent"）。可用的接缝因此是组装 waterfall：
`system-prompt/assemble` 的返回值被注册表视为权威，于是把工具和 `tool:web_search`
从中移除，效果等同于 `tool-web` 的 `search: false` —— 但它是实时的、按步可逆的。

浏览器半边就是一次普通的 slot 注册，注册进 `plugins.item`，并且**复用宿主自带的
id `web-search`**：这样它落进那个条目已有的格子，条目保留自己的标题和表单、只在
上方多出一个开关 —— 和 Subagent 条目现有的形态一致。（0.1.x 之所以要靠 DOM 注入，
是因为 0.1.5 没有给第三方留位置；现在页面有了。）

设置 schema 以内联校验器声明，而不用 `@deepseek-ai/schemastery`：本包安装进
`<profile>/node_modules`，模块解析发生在它自己的目录里，而
`settings.installSection` 接受任何 schemastery 兼容的校验器。为这一个字段写四行
校验器，换来的是包零依赖、装在 DSH 放它的任何位置都能跑。

## 测试

```bash
node test/host-core.test.mjs   # 14 —— 状态机与两个投影
node test/wiring.test.mjs      #  9 —— 命名空间注册、组装 waterfall、guard
node test/load.test.mjs        # 12 —— 浏览器半边（假 DOM + 假 React）
```

各文件直接执行，而不是走 `node --test`（后者会为每个文件 spawn 子进程，在受限
沙箱里用不了）。

浏览器半边的测试用的是一个**真的带 state 和 effect** 的 React 替身，并带渲染循环
把它们跑到稳定。如果把 `useState` 写成空操作，所有断言都会"通过"，但通过的原因
完全错误 —— 组件会永远停在「正在读取…」占位符上，而"命名空间没回答就不画开关"
会以错误的理由为真。

## 已知边界

- **开关绑定到宿主自带条目 id `web-search`。** 将来某个版本若改名，注册处需要跟着
  改 id。
- **客户端只是表现层。** 浏览器半边加载失败时开关从页面上消失，但宿主效果仍按
  持久化的值生效。
- 开关作用于当前这个服务进程。用同一个 home 起的第二个服务会读同一个
  `settings.yaml`，但它的组合是在自己启动时确定的。
- 一个与本插件无关的 DSH 行为：已存在的会话可能仍在工具列表里显示 `web_search`，
  但对它的调用会被 guard 拒绝，而不是送到提供方。
