"use client";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConfigurationStatus } from "@aivideo/contracts";
export function LoginForm() {
  const [configured, setConfigured] = useState(false),
    [serverMode, setServerMode] = useState(false),
    [mode, setMode] = useState<"login" | "register">("login"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: ConfigurationStatus) => {
        setServerMode(c.workspaceBackend === "server");
        setConfigured(
          c.services.find((s) => s.id === "database")?.configured ?? false,
        );
      })
      .catch(() => setMessage("无法读取账号服务状态"));
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!configured) return;
    setBusy(true);
    setMessage("");
    const fields = new FormData(e.currentTarget);
    try {
      const input = {
        email: String(fields.get("email")),
        password: String(fields.get("password")),
        name: String(fields.get("name") || ""),
      };
      const result =
        mode === "login"
          ? await authClient.signIn.email(input)
          : await authClient.signUp.email(input);
      setMessage(
        result.error
          ? result.error.message || "账号服务暂不可用"
          : serverMode
            ? "登录成功。进入工作台即可使用该账号的任务、素材、声音和工作流。"
            : "登录成功。当前使用浏览器本地工作区；启用服务端工作区后创作数据才会归属账号。",
      );
    } catch {
      setMessage("账号服务暂不可用，请检查数据库配置和迁移");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page">
      <div className="panel login-panel">
        <h1>{mode === "login" ? "登录账号" : "创建账号"}</h1>
        <p className="description">
          {serverMode
            ? "登录后使用账号所属的任务、素材、声音和工作流。原浏览器本地数据会保留，不会自动迁移。"
            : "账号服务采用 Better Auth 与 PostgreSQL，当前本地工作区可直接使用。"}
        </p>
        {!configured && (
          <div className="notice" style={{ marginTop: 20 }}>
            账号服务尚未配置。可先使用图片、视频、声音和工作流的本地编辑功能。
          </div>
        )}
        <form onSubmit={(e) => void submit(e)}>
          {mode === "register" && (
            <div className="field">
              <Label htmlFor="name">名称</Label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                required
                maxLength={100}
              />
            </div>
          )}
          <div className="field">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="field">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              name="password"
              type="password"
              minLength={8}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
            />
          </div>
          <button className="action" disabled={!configured || busy}>
            {busy ? "提交中…" : mode === "login" ? "登录" : "注册"}
          </button>
          {message && (
            <p role="status" className="description">
              {message}
            </p>
          )}
        </form>
        <button
          className="action subtle"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "切换到注册" : "返回登录"}
        </button>
      </div>
    </section>
  );
}
