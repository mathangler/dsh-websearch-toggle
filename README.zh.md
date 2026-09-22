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

## 版本要求

**需要 DSH 0.1.7 或更新。** 0.1.7 换掉了插件暴露设置的方式，本插件也随之改了。
有三件事决定开关能不能用：

1. **插件的设置页就是它的 `Config` schema。** 插件导出 `Config = z.object({...})`，
   设置系统自动把它投影成表单；`apply(ctx, config)` 拿到解析后的 config，而
   `config.enabled.get()` 是**活取值** —— 浏览器写一次，下一个模型步就读得到，不需要
   订阅。旧的 `settings.installSection(...)` / `settings.get(...)` 在 0.1.7 里都不存在。
2. **设置命名空间就是 Loader 条目 id。** 本插件的行是 `cordis.patch.yml` 里的
   `id: websearch-toggle`，所以命名空间就是 `websearch-toggle`，浏览器半边用
   `configForms.get('websearch-toggle')` 取它。**插件自己编的命名空间，它自己的
   浏览器半边是取不到的。**
3. **字段必须标 `.volatile()`。** `SettingsForms.describe()` 会把每个命名空间过一遍
   `volatileForm(schema)`，而它只保留带 `meta.volatile` 的字段、一个都没有时返回
   `undefined` —— 接着 `describe()` 就**整条跳过这个条目**。所以没标 volatile 的
   schema 根本不会产生命名空间，浏览器读到空，开关就一直禁用。`.volatile()` 同时
   表示这个字段是运行时可被用户改的，而不是由组合固定死的。

0.1.7 里选择结果会落到 profile 的 `cordis.patch.yml`，作为该条目的 config 覆盖
（`settings.yaml` 已经不是活动文档了）：

```yaml
- id: websearch-toggle
  name: dsh-websearch-toggle
  config:
    enabled: false
```

有三道检查专门守这些，因为**两次改名仓库里其它测试一个都没发现** —— 宿主启动干净、
bundle 照样返回 HTTP 200，而开关是死的：

```bash
node test/dependency-floor.mjs   # schemastery 的下限版本确实有 .volatile()
node test/service-contract.mjs   # 声明的服务确实都被注册
node test/wiring.test.mjs        # 命名空间、volatile 字段、两个效果
node test/style-parity.mjs       # 开关样式与自带的那个一致
```

**每次升级 DSH 之后，请跑 service-contract 和 wiring。**

## 平台支持

**Windows、macOS、Linux 加载的是同一份字节。** 发布内容里没有任何平台相关的东西：

- 宿主半边是 Cordis 上的纯 JavaScript —— 不调用外部命令、不用 `process.platform`、
  不用 `node:os`、自己也不碰任何路径；
- 浏览器半边是 DOM + CSS，所以在意的是**浏览器**而不是操作系统（不支持
  `corner-shape` 的浏览器直接忽略它，和宿主自带的那个开关表现一致）；
- `cordis.patch.yml` 就是一个两行的 YAML insert；
- 本插件唯一会导致被写入的路径，是平台自己为 profile 的 `cordis.patch.yml`
  选定的那个。

唯一的「面」上的限制与操作系统无关：开关本身活在 **Web UI** 里
（`dsh.client.platform: "web"`）。装到 headless profile 里它没有地方显示，但宿主
侧的效果照样按已存的值生效。

`test/` 下的检查会自己定位已安装的 `@deepseek-ai` 包（见 `test/dsh-install.mjs`），
因此在任何系统、任何工作目录、任何 Node 管理器下都能直接跑。只有
`test/serve-verify.ps1` 是 Windows 风格的本地验证脚本，需要 PowerShell 7
（它在 macOS 和 Linux 上也能跑）。**测试不进包**，所以这些都不影响安装出来的插件。

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
