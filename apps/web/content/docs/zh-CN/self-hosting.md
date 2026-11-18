---
title: 部署自己的服务器
description: 启动开源社区版，让成员的 DSH 连接它，并保管好它的数据。
---

社区版以 Apache-2.0 开源：团队、模型、预设、插件、团队助理、审核与版本、用量与预算、网关，以及中继。托管服务的预付费模型不包含在内。DSH Teamwork 手机 App 安装后即可连接你自己的服务器：在登录页选择**使用其他服务器**，输入成员访问的 `APP_URL`（必须是 HTTPS）；服务器无需为此做任何设置。

## 启动实例

需要 Git、Docker 和 Docker Compose：

```sh
git clone https://github.com/dsh-teamwork/dsh-teamwork-platform.git
cd dsh-teamwork-platform
docker compose up -d --build
docker compose logs server
```

服务器监听 3000 端口，SQLite 数据库、生成的密钥和私有插件包都保存在 `data` 卷中。打开它打印出的首个账号链接，然后创建团队。

## 对外提供访问

通过 HTTPS 提供服务，并把 `APP_URL` 设为成员访问的地址。例如在 3000 端口前放一个 Caddy：

```sh
caddy reverse-proxy --from teamwork.example.com --to localhost:3000
```

没有配置 `SMTP_URL` 时，成员使用管理员为其创建的密码登录；配置后，使用邮件验证码和邀请链接。可以通过 `DATABASE_URL` 改用 Postgres 或 MySQL。

## 连接成员

在每位成员的 DSH 中，把 Teamwork 登录界面上的服务器改为你的 `APP_URL`，然后登录。参见[安装插件](/docs/install)。

## 保管数据

把数据库、私有插件包和生成的密钥一起备份，升级时保持密钥不变。完整的运维手册（所有配置项、升级与恢复）见 [Self-hosting the community server](https://github.com/dsh-teamwork/dsh-teamwork-platform/blob/main/docs/ops/self-hosting.md)（英文）。
