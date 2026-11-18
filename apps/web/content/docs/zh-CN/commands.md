---
title: 命令
description: 所有 /teamwork 命令，在 DSH 的命令输入框中使用。
---

在 DSH 的命令输入框中输入，而不是在系统终端里。ID 可以通过 `/teamwork list` 查看。

| 命令 | 作用 |
| --- | --- |
| `/teamwork login` | 打开浏览器登录。 |
| `/teamwork authorize <code>` | 用网站上的授权码完成登录。 |
| `/teamwork share enable <key>` | 用**共享 DSH**里的 key 把这台 DSH 设为团队的共享 DSH。 |
| `/teamwork share disable` | 关闭共享模式并删除 key。 |
| `/teamwork share status` | 查看共享 DSH 的名称、团队和 token。 |
| `/teamwork share invite <email>` | 生成一次性链接，让名单中一位成员的设备配对到这台共享 DSH。 |
| `/teamwork share members` | 查看可访问这台共享 DSH 的成员及其设备。 |
| `/teamwork share unlock <email>` | 清除某个成员在这台共享 DSH 上的 PIN 和锁定。 |
| `/teamwork share audit-key <key>` | 把这台共享 DSH 的归档加密到 `dsh-teamwork-audit keygen` 打印的密钥；设置之后才会接纳成员。 |
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

在共享 DSH 所在的机器上，随插件安装的 `dsh-teamwork` 可以在终端里执行 `share` 系列命令，不需要浏览器。DSH 必须以同一个用户在这台机器上运行；它通过 `~/.dsh`（或 `$DSH_HOME`）中的插件目录找到这台 DSH。支持 Linux 和 macOS。

| 命令 | 作用 |
| --- | --- |
| `dsh-teamwork server [url]` | 查看或设置 Teamwork 服务器；自托管团队在 `enable` 之前设置。 |
| `dsh-teamwork share enable <key>` | 用**共享 DSH**里的 key 把这台 DSH 设为团队的共享 DSH。 |
| `dsh-teamwork share audit-key <key>` | 把归档加密到 `dsh-teamwork-audit keygen` 打印的密钥。 |
| `dsh-teamwork share status` | 查看名称、团队、审计密钥和错误。 |
| `dsh-teamwork share members` | 查看可访问的成员、他们的设备和锁定状态。 |
| `dsh-teamwork share invite <email>` | 生成一次性链接，让名单中一位成员配对设备。 |
| `dsh-teamwork share unlock <email>` | 清除某个成员的 PIN 和锁定。 |
| `dsh-teamwork share disable` | 关闭共享模式并删除 key。 |

