---
title: 命令
description: 所有 /teamwork 命令，在 DSH 的命令输入框中使用。
---

在 DSH 的命令输入框中输入，而不是在系统终端里。ID 可以通过 `/teamwork list` 查看。

| 命令 | 作用 |
| --- | --- |
| `/teamwork login` | 打开浏览器登录。 |
| `/teamwork authorize <code>` | 用网站上的授权码完成登录。 |
| `/teamwork pin reset` | 清除你自己手机在这台计算机上的 PIN 和锁定。 |
| `/teamwork status` | 查看登录、同步状态和最近的错误。 |
| `/teamwork sync` | 立即刷新团队资源。 |
| `/teamwork list` | 列出团队资源及其 ID。 |
| `/teamwork info [id]` | 查看预设详情及是否就绪。 |
| `/teamwork new <id>` | 用预设新建会话。 |
| `/teamwork use <id>` | 在尚未开始的会话中使用团队资源。 |
| `/teamwork tools` | 查看 DSH 可见的工具名称。 |
| `/teamwork plugins [presetId]` | 检查预设依赖的插件。 |
| `/teamwork install <id>[@<version>]` | 预览插件安装；加上 `confirm` 再次运行即安装。 |
| `/teamwork session [check]` | 查看会话状态；`check` 重新核对团队权限。 |
| `/teamwork continue <instruction>` | 通过就绪检查后发送后续指令。 |
| `/teamwork cancel` | 请求停止当前会话。 |
| `/teamwork retry` | 预览恢复操作；`retry confirm` 执行。 |
| `/teamwork logout` | 退出登录，并从 DSH 中移除团队资源。 |

## 在服务器上：dsh-teamwork

在 DSH 所在的机器上，`dsh-teamwork`（`npm install -g @dsh-teamwork/dsh-teamwork` 安装）可以在终端里完成 Teamwork 面板的操作，不需要浏览器，适合运行在服务器上的 DSH。DSH 必须以同一个用户在这台机器上运行；命令通过 `~/.dsh`（或 `$DSH_HOME`）中的插件目录找到它。支持 Linux 和 macOS。

| 命令 | 作用 |
| --- | --- |
| `dsh-teamwork server [url]` | 查看或设置 Teamwork 服务器；自托管团队先设置这一项。 |
| `dsh-teamwork login` | 打印登录链接，在任意浏览器中打开。 |
| `dsh-teamwork authorize <code>` | 用页面上显示的授权码完成登录。 |
| `dsh-teamwork status` | 查看登录、团队、同步、中继和已配对的设备。 |
| `dsh-teamwork sync` | 立即同步团队配置。 |
| `dsh-teamwork logout` | 退出登录，并移除团队资源。 |
| `dsh-teamwork device pair` | 打印配对码，并在终端里画出手机 App 的配对二维码；浏览器在 My DSH 里输入这个配对码。 |
| `dsh-teamwork device list` | 查看已配对和等待中的设备，以及等待中设备的安全码。 |
| `dsh-teamwork device accept <id>` | 设备显示相同的安全码后确认它；`reject <id>` 拒绝。 |
| `dsh-teamwork device revoke <id>` | 移除一台已配对的设备。 |

