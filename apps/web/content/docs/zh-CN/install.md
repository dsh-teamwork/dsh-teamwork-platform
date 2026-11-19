---
title: 安装插件
description: 在 DSH 桌面版或 DSH CLI 中添加 Teamwork 插件、登录，以及常见安装问题的处理。
---

插件是 npm 包 `@dsh-teamwork/dsh-teamwork`。把它安装到你实际使用的 DSH profile 中，然后在 Teamwork 面板里登录。

## DSH 桌面版

1. 在应用中打开 **Plugins → Add plugin**（插件 → 添加插件）。
2. 输入包名，安装并启用：

   ```text
   @dsh-teamwork/dsh-teamwork
   ```

3. 按提示重启。

桌面版使用自己的 profile，请在应用内安装和更新。CLI 安装不会进入桌面版。

## DSH CLI 与 Web

DSH 用 pnpm 安装插件，所以在运行 DSH 的终端里 `pnpm --version` 必须能用；如果不能，用 `npm install -g pnpm` 安装。pnpm 是 11 或更高版本时，先按 [Linux 服务器](#linux-服务器)第 3 步加上 profile 的两项设置。

安装到你运行的 profile（下例为 `web`，如果名称不同请替换）：

```sh
dsh plugin --profile web add @dsh-teamwork/dsh-teamwork
dsh web
```

如果 web 进程已经在运行，按宿主的提示重新加载或重启。

## Linux 服务器

DSH 也可以运行在没有桌面的服务器上。在 Ubuntu 或 Debian 上，以将要运行 DSH 的用户执行：

1. 安装 Node.js 24 或更高版本：

   ```sh
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. 安装 DSH，以及 DSH 用来安装插件的 pnpm。NodeSource 的 Node.js 把全局包装在系统目录里，所以需要 `sudo`，否则 npm 会以 `EACCES` 中断：

   ```sh
   sudo npm install -g @deepseek-ai/dsh pnpm
   ```

3. 在添加任何插件之前，先让 DSH 的 profile 接受当天发布的版本，并跳过它用不到的依赖构建脚本；否则第 2 步装上的 pnpm（11 或更高版本）会装上旧版本，或者以 `ERR_PNPM_IGNORED_BUILDS` 中断：

   ```sh
   dsh plugin --profile web list
   printf 'minimumReleaseAge: 0\nstrictDepBuilds: false\n' >> ~/.dsh/profiles/web/pnpm-workspace.yaml
   ```

   第一行只是让 DSH 先建好 profile，这样它自己的设置会写在这两行之前。请在第 4 步之前执行：已经尝试添加过插件的 profile 会一直停在它记下的旧版本，直到运行 `dsh plugin --profile web update --latest @dsh-teamwork/dsh-teamwork`。

4. 安装插件，并在 `tmux` 会话中启动 DSH，退出登录后它会继续运行。请在会话要工作的项目目录里启动：会话会在这个目录、或 DSH 已有的工作区里开始。

   ```sh
   dsh plugin --profile web add @dsh-teamwork/dsh-teamwork
   tmux new -s dsh
   cd /path/to/project
   dsh web --no-open
   ```

   按 `Ctrl+B` 再按 `D` 离开会话，`tmux attach -t dsh` 回到会话。

5. 在同一台机器的另一个终端里，安装插件附带的命令 `dsh-teamwork` 和 `dsh-teamwork-audit`。DSH profile 里的那一份不在 `PATH` 上：

   ```sh
   sudo npm install -g @dsh-teamwork/dsh-teamwork
   ```

6. 然后运行 `dsh-teamwork login`，见[命令](/docs/commands#在服务器上-dsh-teamwork)。服务器上不需要浏览器。

插件把文件保存在 `~/.dsh/dsh-teamwork/`（或 `$DSH_HOME/dsh-teamwork/`）中，与从哪个目录启动 DSH 无关。

## 登录

1. 打开 DSH 侧边栏里的 **Teamwork**，选择浏览器登录。也可以在命令输入框运行 `/teamwork login`。
2. 在本网站登录并确认授权。浏览器会把授权码交回 DSH，DSH 随即自动完成登录。
3. 如果无法自动交回，把页面上显示的授权行（`/teamwork authorize <code>`）复制到 DSH。授权码两分钟内有效。

登录后会立即同步团队资源，之后每 60 秒同步一次。

### 选择服务器

插件默认登录 `https://www.dshteamwork.com`。如果要使用其他服务器（例如自托管的服务器），先在 Teamwork 登录界面修改地址。除本机回环地址外必须使用 HTTPS。切换服务器会退出登录，并清除之前服务器的团队资源。

## 更新

用安装时的插件管理器更新：桌面版在应用的 **Plugins** 页面。CLI 更新 profile 时要加 `--latest`，否则 0.10 之后的 0.11 这样的新版本不会被装上。在服务器上还要更新命令，然后重启 DSH：

```sh
dsh plugin --profile web update --latest @dsh-teamwork/dsh-teamwork
sudo npm install -g @dsh-teamwork/dsh-teamwork
```

## 遇到问题

- **已安装，但桌面版里没有：** CLI 的 `web` profile 不属于桌面版，请在应用内安装。
- **版本被拒绝：** 核对 DSH 和插件版本，从 [npm 版本页](https://www.npmjs.com/package/@dsh-teamwork/dsh-teamwork?activeTab=versions)选择兼容的已发布版本。
- **没有选到刚发布的版本：** 部分宿主要求发布后等待一段时间。请指定 npm 已列出的精确版本。
- **仍未解决：** 在 DSH 中运行 `/teamwork status`，去掉令牌和授权码后，把输出附在 [issue](https://github.com/dsh-teamwork/dsh-teamwork/issues) 中。
