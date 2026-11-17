---
title: 命令
description: 所有 /teamwork 命令，在 DSH 的命令输入框中使用。
---

在 DSH 的命令输入框中输入，而不是在系统终端里。ID 可以通过 `/teamwork list` 查看。

| 命令 | 作用 |
| --- | --- |
| `/teamwork login` | 打开浏览器登录。 |
| `/teamwork authorize <code>` | 用网站上的授权码完成登录。 |
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
