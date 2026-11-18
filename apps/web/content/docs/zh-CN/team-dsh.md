---
title: 团队 DSH
description: 在服务器上为团队运行一台 DSH，从安装到成员的第一个会话。
---

团队 DSH 是团队在自己的机器上（通常是一台 Linux 服务器）运行的 DSH，成员通过浏览器或手机 App 在上面工作。它以团队身份登录，从不以个人身份登录，模型调用计入团队。每个成员只能看到自己在上面发起的会话；你作为管理员，可以从它的加密归档中读取所有会话。

整个配置分三方完成，按这个顺序：

1. **你，在控制台**：为这台机器创建 key。
2. **你，在那台机器上**：安装 DSH，把它变成团队 DSH，设置审计密钥，为每个成员生成邀请。
3. **每个成员，在浏览器或手机 App 里**：用邀请加入，设置 PIN。

## 开始之前

- **团队需要已开通团队 DSH。** 自部署的服务器对所有团队都开放。托管服务在安全性经过实际使用验证之前分批开通；没开通时，**团队资产 → 团队 DSH**会说明这一点，并且不提供 key。如需使用请联系客服。
- **你是团队管理员**，并且能以将要运行 DSH 的那个用户登录那台机器的终端。
- **每条命令都有两种写法。** 在 DSH 自己的命令输入框里以 `/teamwork` 开头，例如 `/teamwork share status`；在同一台机器的终端里以 `dsh-teamwork` 开头，例如 `dsh-teamwork share status`。两者作用相同。服务器上没有 DSH 窗口，所以本页都用终端写法；两种写法见[命令](/docs/commands)。

## 1. 在机器上安装 DSH 和插件

按照[安装 → Linux 服务器](/docs/install#linux-服务器)操作：安装 Node.js 24 和 DSH，把插件装进 DSH 的 `web` profile，在 `tmux` 里用 `dsh web --no-open` 启动 DSH，再用 npm 安装 `dsh-teamwork` 命令。

**在成员要工作的项目文件夹里启动 DSH。** 成员的会话从这个文件夹开始，或者从 DSH 已有的某个工作区开始；两者都没有时，成员会看到“机器上没有可用的项目文件夹”。

确认命令能连上正在运行的 DSH：

```sh
dsh-teamwork share status
```

它应该显示 `This DSH is not a Team DSH`。如果显示 `No running DSH with the Teamwork plugin`，说明 DSH 不是以当前用户运行的，或者启动时用了另一个 `DSH_HOME`。

不要在这台机器上运行 `dsh-teamwork login`：团队 DSH 用 key 登录，而不是以你的身份登录。

## 2. 为机器创建 key

在团队控制台打开**团队资产 → 团队 DSH**，给机器起个名字（例如 `构建机`），选择**创建 key**。页面会以命令的形式显示 key，只显示这一次，请复制下来：服务器不保留可读副本，之后要再看到 key 只能**更换 key**。

## 3. 把机器变成团队 DSH

在机器上运行这条命令，把开头的 `/teamwork` 换成 `dsh-teamwork`：

```sh
dsh-teamwork share enable dshh_…
```

它会打印团队 DSH 的名称和所属团队。第一台使用 key 的机器会绑定它，同一个 key 在其他机器上会被拒绝。控制台里这台机器的“机器”一栏会变成**已绑定**。

此后机器会自己以团队身份登录，重启后也一样：DSH 或服务器重启时不需要再运行任何命令。

## 4. 设置审计密钥

团队 DSH 在拿到团队的**审计密钥**之前不会接纳任何成员。它会把成员在上面做的一切加密到这把密钥，上传到服务器；服务器保存它，却无法读取。

**在你自己的电脑上**生成密钥，不要在服务器上：

```sh
npm install -g @dsh-teamwork/dsh-teamwork
dsh-teamwork-audit keygen
```

它会在当前文件夹写出 `audit-key.json`，并打印一行 `/teamwork share audit-key <public key>`。在机器上运行它的终端写法：

```sh
dsh-teamwork share audit-key <public key>
```

把 `audit-key.json` 存在安全的地方，只由你保管。**丢失的密钥无法找回**，持有它的人可以读取所有成员的会话。

## 5. 选择谁可以访问

回到**团队资产 → 团队 DSH**，在这台机器那一行选择**访问**：**团队所有成员**，或**仅以下成员**。把某人移出名单会立即断开他的配对。

## 6. 为每个成员生成邀请

在机器上，为名单上的每个成员运行：

```sh
dsh-teamwork share invite bob@example.com
```

它会打印一个链接 `dshteamwork://join?…`。每个链接只属于这个成员，只能用一次，一天后过期，只能配对一个浏览器或一部手机：成员两样都要用时，需要两个邀请。**请亲自交给对方**，当面或通过团队信任的渠道；Teamwork 服务器从不经手它。

`dsh-teamwork share members` 会列出名单上的人，以及每人已配对的设备。

## 7. 成员加入

把链接连同下面这段说明发给成员：

- **在浏览器里**：在团队控制台打开**工作区 → 团队 DSH**，选择**用邀请加入**，粘贴完整链接，选择**加入**。请使用最新版 Chrome、Edge、Firefox 或 Safari，并且不要用无痕模式。
- **在手机 App 里**：在手机上打开链接，App 会接着完成。

然后成员设置四位数的 PIN（以后回来时机器会再次询问），就可以发起会话。他们只能看到自己在上面发起的会话。每个浏览器只需加入一次，密钥保存在浏览器自己的存储中：清除网站数据后需要重新索取邀请。

如果想直接发一个页面给成员，可以用[在团队中工作](/docs/members#在团队-dsh-上工作)，那是成员这一侧的说明。

## 8. 确认一切正常

在机器上运行：

```sh
dsh-teamwork status
```

它应该显示 `Signed in: as this Team DSH` 和 `Relay: connected`；只有 relay 连接着，成员才能连上这台机器。`dsh-teamwork share status` 还会显示审计密钥，以及服务器返回的错误。机器运行期间，控制台里的**最近换取 token** 大约每小时更新一次。

## 日常维护

| 情况 | 做法 |
| --- | --- |
| 成员 PIN 输错次数过多 | `dsh-teamwork share unlock <email>`；对方下次连接时重新设置 PIN。 |
| 成员换了手机，或清除了浏览器数据 | 再运行一次 `dsh-teamwork share invite <email>`。 |
| 某人不该再访问 | 在控制台的**访问**里把他移出；他的配对立即断开。 |
| key 可能泄露 | 在控制台**更换 key**，然后在同一台机器上运行 `dsh-teamwork share enable <新 key>`。旧 key 立即失效。 |
| 换到另一台机器 | 在控制台**删除**它，再新建一个；key 始终属于第一台使用它的机器。 |
| 不再共享这台机器 | 在机器上运行 `dsh-teamwork share disable`，并在控制台**删除**。 |
| 更新插件 | 见[安装 → 更新](/docs/install#更新)，然后重启 DSH。 |

在控制台同一页的**审计归档**中下载归档，在你自己的电脑上打开：

```sh
dsh-teamwork-audit read shared-archive-….ndjson --key audit-key.json
```

它还会指出缺失或被改动的部分。

## 遇到问题

- **成员看到机器离线。** 在机器上运行 `dsh-teamwork status`。如果显示 `Relay: off`，把插件更新到 0.11.2 或更高版本并重启 DSH；更早的版本重启后 relay 不会自动连上。
- **`share enable` 被拒绝。** 团队没开通团队 DSH 时，请联系客服。key 已在另一台机器上用过时，为这台机器新建一个。被更换或删除的 key 不再有效。
- **成员看到“机器上没有可用的项目文件夹”。** 在成员要工作的文件夹里重启 DSH（第 1 步）。
- **`share invite` 说成员不在访问名单上。** 先在**访问**里加上他（第 5 步）。
- **成员的邀请被拒绝。** 邀请已用过、已过期，或者不属于他：为他重新运行 `share invite`。
- **成员完全无法加入。** 确认 `dsh-teamwork share status` 显示了审计密钥（第 4 步）。
