import { spawn } from "node:child_process";
import { join } from "node:path";
export async function pgTool(
  name: "pg_dump" | "pg_restore",
  url: string,
  args: string[],
  bin?: string,
) {
  const u = new URL(url);
  if (!["postgres:", "postgresql:"].includes(u.protocol))
    throw new Error("无效数据库连接");
  // Credentials never enter argv, shell interpolation, browser responses or errors.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGCONNECT_TIMEOUT: "5",
  };
  for (const [key, value] of u.searchParams) {
    if (key === "sslmode") env.PGSSLMODE = value;
    else throw new Error("备份连接只支持 sslmode 查询参数");
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      bin ? join(bin, name) : name,
      ["--no-password", ...args],
      { env, stdio: ["ignore", "ignore", "pipe"] },
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 30 * 60_000);
    // Classify known failures without exposing SQL, identifiers or credentials.
    let diagnostic = "";
    child.stderr.on("data", (chunk) => {
      if (/schema "public" already exists/.test(String(chunk)))
        diagnostic = "：默认 public schema 已存在";
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error(`${name} 无法启动，请检查 PG_BIN_DIR`));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${name} 失败，请检查数据库权限、工具版本和磁盘空间${diagnostic}`,
            ),
          );
    });
  });
}
