"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  Production,
  ProductionSummary,
  ProductionCommand,
} from "@aivideo/contracts";
import {
  workspaceBackend,
  workspaceRequest,
} from "@aivideo/core/workspace-client";
import { ProjectWorkspace } from "./project-workspace";
export function ProjectsPage() {
  const [backend, setBackend] = useState<string>(),
    [id, setId] = useState<string>(),
    [p, setP] = useState<Production>();
  const [initialView, setInitialView] = useState<{
    episode?: string;
    tab?: string;
    render?: string;
  }>({});
  const [items, setItems] = useState<ProductionSummary[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [q, setQ] = useState("");
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [reload, setReload] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    void workspaceBackend()
      .then(setBackend)
      .catch((e) => setError(e.message));
    const query = new URL(window.location.href).searchParams;
    setId(query.get("project") ?? undefined);
    setInitialView({
      episode: query.get("episode") ?? undefined,
      tab: query.get("tab") ?? undefined,
      render: query.get("render") ?? undefined,
    });
  }, []);
  useEffect(() => {
    if (backend !== "server") return;
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      const read = id
        ? workspaceRequest<{ item: Production }>(`/api/production/${id}`).then(
            (r) => {
              if (active) setP(r.item);
            },
          )
        : workspaceRequest<{ items: ProductionSummary[]; total: number }>(
            `/api/production?offset=${offset}&q=${encodeURIComponent(q)}`,
          ).then((r) => {
            if (active) {
              setItems(r.items);
              setTotal(r.total);
            }
          });
      void read
        .then(() => {
          if (active) setError("");
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [backend, id, q, offset, reload]);
  function open(next?: string) {
    setInitialView({});
    setP(undefined);
    setId(next);
    setError("");
    setNotice("");
    history.replaceState(
      null,
      "",
      next ? `/projects?project=${next}` : "/projects",
    );
  }
  async function perform(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function change(command: ProductionCommand) {
    if (!p) return false;
    return !!(await perform(async () => {
      const result = await workspaceRequest<{ item: Production }>(
        `/api/production/${p.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ revision: p.revision, command }),
        },
      );
      setP(result.item);
      setNotice("已保存");
    }));
  }
  return (
    <section className="page production-page">
      <div className="page-heading">
        <div>
          <h1>{p?.name ?? "短剧项目"}</h1>
          <p className="description">
            整理分集、角色与场景，逐镜头挑选采用版。图片和视频均可使用上传素材。
          </p>
        </div>
        <div className="production-actions">
          {id && (
            <button
              className="action secondary"
              disabled={busy}
              onClick={() => open()}
            >
              返回项目列表
            </button>
          )}
          <button
            className="action subtle"
            disabled={busy || loading}
            onClick={() => setReload((n) => n + 1)}
          >
            刷新项目
          </button>
        </div>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status">
          {notice} · {p && new Date(p.updatedAt).toLocaleTimeString()}
        </p>
      )}
      {!backend ? (
        <p className="loading">读取工作区…</p>
      ) : backend !== "server" ? (
        <div className="empty">
          <h2>短剧项目需要服务端工作区</h2>
          <p>启用已有的 PostgreSQL 与私有文件存储后即可使用，无需模型密钥。</p>
          <Link className="action" href="/settings">
            查看接口配置
          </Link>
        </div>
      ) : id ? (
        p ? (
          <>
            <details className="production-meta">
              <summary>项目说明与管理 · v{p.revision}</summary>
              <form
                key={p.revision}
                className="production-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void change({
                    type: "project.edit",
                    name: String(f.get("name")),
                    description: String(f.get("description")),
                  });
                }}
              >
                <label>
                  项目名称
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={p.name}
                  />
                </label>
                <label>
                  项目说明
                  <textarea
                    name="description"
                    maxLength={4000}
                    defaultValue={p.description}
                  />
                </label>
                <button className="action secondary" disabled={busy}>
                  保存项目说明
                </button>
              </form>
              <button
                className="action subtle"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "删除整个项目、分集、设定和候选关联？素材库文件、工作流和任务会保留。",
                    )
                  )
                    void perform(async () => {
                      await workspaceRequest(`/api/production/${p.id}`, {
                        method: "DELETE",
                        body: JSON.stringify({ revision: p.revision }),
                      });
                      open();
                    });
                }}
              >
                删除项目
              </button>
            </details>
            <ProjectWorkspace
              key={p.id}
              p={p}
              change={change}
              busy={busy}
              initialView={initialView}
            />
          </>
        ) : (
          <p className="loading">
            {loading ? "读取项目…" : "项目暂不可用，请刷新或返回列表。"}
          </p>
        )
      ) : (
        <>
          <form
            className="production-actions production-card"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                const result = await workspaceRequest<{ item: Production }>(
                  "/api/production",
                  {
                    method: "POST",
                    body: JSON.stringify({ id: crypto.randomUUID(), name }),
                  },
                );
                setName("");
                open(result.item.id);
                setP(result.item);
              });
            }}
          >
            <label>
              新项目名称
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：末班地铁"
              />
            </label>
            <button className="action" disabled={busy}>
              创建项目
            </button>
          </form>
          <label>
            搜索项目
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
              placeholder="输入项目名称"
            />
          </label>
          <div className="production-definition-grid">
            {items.map((item) => (
              <article className="production-card" key={item.id}>
                <h2>{item.name}</h2>
                <p className="description">
                  {item.episodes} 集 · {item.shots} 个镜头 · {item.selected}{" "}
                  个已采用
                </p>
                <p>{item.description}</p>
                <button
                  className="action secondary"
                  onClick={() => open(item.id)}
                >
                  打开项目
                </button>
              </article>
            ))}
          </div>
          {!items.length && !loading && (
            <p className="empty">
              {q ? "没有匹配项目" : "创建第一个项目，开始整理分镜和素材。"}
            </p>
          )}
          <div className="production-actions">
            <span>共 {total} 个项目</span>
            <button
              className="action secondary"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((n) => Math.max(0, n - 20))}
            >
              上一页
            </button>
            <button
              className="action secondary"
              disabled={offset + 20 >= total || loading}
              onClick={() => setOffset((n) => n + 20)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </section>
  );
}
