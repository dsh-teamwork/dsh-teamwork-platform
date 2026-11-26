---
title: 部署自己的服务器
description: 启动开源社区版，让成员的 DSH 连接它，并保管好它的数据。
---

社区版以 Apache-2.0 开源：团队、模型、预设、插件、团队助理、审核与版本、用量与预算、网关，以及中继。托管服务的预付费模型不包含在内。DSH Teamwork 手机 App 安装后即可连接你自己的服务器：在登录页选择**使用其他服务器**，输入成员访问的 `APP_URL`（必须是 HTTPS）；服务器无需为此做任何设置。

## 启动实例

需要 Git、Docker 和 Docker Compose。克隆仓库后，把成员将要访问的地址写进 `compose.yaml` 旁边的 `.env`：

```sh
git clone https://github.com/dsh-teamwork/dsh-teamwork-platform.git
cd dsh-teamwork-platform
echo 'APP_URL=https://teamwork.example.com' > .env
docker compose up -d --build
docker compose logs server
```

只想在本机试用时可以不写 `.env`，访问 `http://localhost:3000`。服务器监听 3000 端口，SQLite 数据库、生成的密钥和私有插件包都保存在 `data` 卷中。打开它并创建首个账号：在第一个账号创建之前，登录页会把这一步提供给最先访问的人，所以请在公开地址之前完成。然后创建团队。

所有配置项都写在 `.env` 里，每行一个 `NAME=value`。修改后再运行一次 `docker compose up -d`。

## 对外提供访问

在 `APP_URL` 这个地址上通过 HTTPS 提供服务。例如在 3000 端口前放一个 Caddy：

```sh
caddy reverse-proxy --from teamwork.example.com --to localhost:3000
```

Compose 会在所有网卡上以明文 HTTP 发布 3000 端口。反向代理提供 HTTPS 之后，请用防火墙等方式让 3000 端口只对代理开放。

没有配置 `SMTP_URL` 时，成员使用管理员为其创建的密码登录；配置后，使用邮件验证码和邀请链接。可以通过 `DATABASE_URL` 改用 Postgres 或 MySQL。

Compose 默认设置 `ALLOW_PRIVATE_PROVIDERS=true`，管理员可以把团队的模型服务商指向你内网中的机器，包括明文 HTTP 地址。如果实例会被你不信任的人使用，请在 `.env` 中加入 `ALLOW_PRIVATE_PROVIDERS=false`，否则他们团队的管理员可以让服务器去访问你内网中的地址。

## 连接成员

在每位成员的 DSH 中，把 Teamwork 登录界面上的服务器改为你的 `APP_URL`，然后登录。参见[安装插件](/docs/install)。

## 备份与升级

把数据库、私有插件包和生成的密钥一起备份：默认配置下三者都在 `data` 卷里。先停止服务器，让 SQLite 文件处于一致状态，把卷打包成带日期的归档，再启动：

```sh
docker compose stop
docker run --rm -v dsh-teamwork_data:/data -v "$PWD":/backup busybox \
  tar czf /backup/dsh-teamwork-$(date +%F).tar.gz -C /data .
docker compose start
```

升级前先备份，然后在同一目录拉取代码并重新构建。卷和其中的密钥会保留，服务器在提供服务前自动执行数据库迁移：

```sh
git pull
docker compose up -d --build
```

升级时保持密钥不变。完整的运维手册（所有配置项、升级与恢复）见 [Self-hosting the community server](https://github.com/dsh-teamwork/dsh-teamwork-platform/blob/main/docs/ops/self-hosting.md)（英文）。
