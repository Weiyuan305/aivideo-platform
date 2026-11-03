# 私有运行快照 · 2026-11-03

源码可正常检出。本目录另存有该次推送的加密备份：`apps/web/.env.local`（包括实际模型密钥）、`.runtime` 中的素材、生成结果、项目运行记录、历史备份，以及平台专属 PostgreSQL 17 集群的在线物理备份。数据库来自 `pg_basebackup`，不是直接复制正在运行的数据库文件。连接套接字和监控锁不需要恢复。依赖和构建缓存不在快照中。

备份为 tar → Zstandard → OpenSSL CMS（AES-256-GCM），按 20 MiB 分片。恢复私钥 `Weiyuan305-aivideo-platform-20261103.pem` 单独保管，不在 Git 历史中。请将私钥另存到自己的安全备份处；只有仓库不能恢复这些文件。

## 恢复到一个新的空目录

需要 OpenSSL 3、zstd、tar、shasum。以下命令在仓库根目录用 Bash 或 Zsh 执行，将 `KEY` 改为自己保管的私钥路径：

```sh
set -euo pipefail
umask 077
KEY=/absolute/path/to/Weiyuan305-aivideo-platform-20261103.pem
DEST=$(mktemp -d)
(cd private-snapshot && shasum -a 256 -c chunks.sha256)
cat private-snapshot/snapshot.part-* | openssl cms -decrypt -binary -inform DER \
  -inkey "$KEY" -out "$DEST/verified.tar.zst"
zstd -dc "$DEST/verified.tar.zst" | tar -xf - -C "$DEST"
pg_verifybackup "$DEST/.runtime/postgres"
printf 'Recovered to: %s\n' "$DEST"
```

先完成解密认证和数据库校验，再使用恢复目录。数据库按 PostgreSQL 17 物理备份恢复，首次启动请用独立目录、端口和套接字，不要覆盖运行中的服务。平台启动配置与依赖安装见仓库根目录 README。
