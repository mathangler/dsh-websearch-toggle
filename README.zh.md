# dsh-websearch-toggle

给 DeepSeek Harness 的「**网页搜索**」插件页面加一个真正生效的开关。

打开侧栏的**插件**页面。官方「**网页搜索**」卡片标题那一行的末尾会多出一个开关，
位置与样式和「已安装」分组里每张组合包卡片尾部的开关完全一致。官方卡片、官方
页面、官方字段一个字节都没有改动 —— 本插件只是在渲染之后往那张卡片上追加一个
开关，插件停用时再把它摘掉。

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

**每次 `remove` + `add` 之后都要检查 bundle 列表。** `dsh plugin remove` 会把包从
profile `package.json` 的 `dsh.profile.bundles` 里删掉，而随后的 `add` 不一定把它
加回去 —— 依赖装上了，但那一行从未组合，于是插件什么都不做，浏览器半边却照常被
提供。开关没出现时，先确认 `dsh.profile.bundles` 里有这个包，没有就手动补上。

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

浏览器半边**不注册任何 slot**，而是在渲染后往官方卡片上追加一个开关。原因是
Plugins 页面只提供三个座位（`plugins.item`、`plugins.bundle.config`、
`plugins.row.config`），三者都只能**新增**一张卡片或一个页面，没有任何一个能往
已有条目**内部**放控件。更糟的是 `plugins.item` 自己的目录写着：*"a fresh id is
added beside the shipped entries, while reusing a shipped id puts you in THAT
cell and replaces it."* —— 复用 `web-search` 不是装饰官方卡片，而是**顶掉**它：
本插件早先一个版本就是这么干的，结果把官方网页搜索表单整个删掉了。所以现在的
做法是完全不动官方卡片，渲染后把开关追加进去，插件停用时摘掉。

卡片靠 `li[data-plugin-item="web-search"]` 定位 —— 这是页面自己设置的稳定
`data-` 属性，不是会被哈希的 CSS Module 类名。

### schema 绝不能手写

设置 schema **必须**是真正的 schemastery 对象，这是硬性的：`settings.describe()`
会对每个已注册的 schema 调 `schema.toJSON()` 并把结果发给浏览器，而这**一次调用
就决定了每个官方插件页是否存在**（官方页面只为它在那份列表里看到的命名空间注册）。
所以一个没有 `toJSON()` 的手写校验器不只是描述错了本插件 —— 它会在 `describe()`
里抛异常，把 Shell、Agent 循环、Subagent、网页搜索四个页面从插件页上**全部抹掉**。
本插件早先的 0.2.x 就是这样。现在 schema 从平台自己发布的包里导入，线上格式因此
是真的而不是仿的。

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

- **DOM 追加，不是 slot。** 开关靠官方卡片自己的 `data-plugin-item` 属性定位并
  追加在卡片头部末尾。将来某个版本若改掉那个属性，匹配器需要跟着改。
- **客户端只是表现层。** 浏览器半边加载失败时开关从页面上消失，但宿主效果仍按
  持久化的值生效。
- 开关作用于当前这个服务进程。用同一个 home 起的第二个服务会读同一个
  `settings.yaml`，但它的组合是在自己启动时确定的。
- 一个与本插件无关的 DSH 行为：已存在的会话可能仍在工具列表里显示 `web_search`，
  但对它的调用会被 guard 拒绝，而不是送到提供方。
