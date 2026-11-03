"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Production, ProductionCommand } from "@aivideo/contracts";
import { definitionVersion } from "@aivideo/core/production";
import { useLocalLibrary } from "@/features/assets/use-local-library";
import { AssetPreview } from "@/features/assets/asset-library";
import { DefinitionForm, EpisodeForm, ShotForm, type Change } from "./forms";
import { TimelineEditor } from "@/features/timeline/timeline-editor";
import { ShotPanel } from "./shot-panel";
export function ProjectWorkspace({
  p,
  change,
  busy,
  initialView,
}: {
  p: Production;
  change: Change;
  busy: boolean;
  initialView: { episode?: string; tab?: string; render?: string };
}) {
  const [tab, setTab] = useState(
      initialView.tab === "timeline" || initialView.tab === "settings"
        ? initialView.tab
        : "shots",
    ),
    [episodeId, setEpisodeId] = useState(
      initialView.episode ?? p.episodes[0]?.id,
    ),
    [renderId, setRenderId] = useState(initialView.render),
    [shotId, setShotId] = useState<string>();
  const [editing, setEditing] = useState<{
    kind: "episode" | "shot" | "character" | "scene";
    id?: string;
  }>();
  const episode = p.episodes.find((e) => e.id === episodeId) ?? p.episodes[0];
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "timeline" && renderId)
      url.searchParams.set("render", renderId);
    else url.searchParams.delete("render");
    url.searchParams.set("project", p.id);
    if (episode) url.searchParams.set("episode", episode.id);
    else url.searchParams.delete("episode");
    url.searchParams.set("tab", tab);
    history.replaceState(history.state, "", url.pathname + url.search);
  }, [p.id, episode?.id, tab, renderId]);
  const shot = episode?.shots.find((s) => s.id === shotId) ?? episode?.shots[0];
  const { voices, assets, error } = useLocalLibrary({
    assetIds: p.definitions.flatMap((d) =>
      d.versions.flatMap((v) => [
        ...v.assetIds,
        ...(v.voiceAssetId ? [v.voiceAssetId] : []),
      ]),
    ),
  });
  async function save(c: ProductionCommand) {
    const ok = await change(c);
    if (ok && c.type === "episode.save") {
      if (episode?.id !== c.id) setRenderId(undefined);
      setEpisodeId(c.id);
    }
    if (ok && c.type === "shot.save") setShotId(c.shotId);
    return ok;
  }
  function move(id: string, direction: number) {
    if (!episode) return;
    const ids = episode.shots.map((s) => s.id),
      from = ids.indexOf(id),
      to = from + direction;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void change({ type: "shot.order", episodeId: episode.id, ids });
  }
  const refName = (ref: { id: string; version: number }) =>
    `${definitionVersion(p, ref).name} v${ref.version}`;
  return (
    <fieldset className="production-workspace" disabled={busy}>
      <nav className="production-tabs" aria-label="项目工作区">
        <button
          className={tab === "shots" ? "action" : "action secondary"}
          onClick={() => {
            setTab("shots");
            setEditing(undefined);
          }}
        >
          分集与分镜
        </button>
        <button
          className={tab === "settings" ? "action" : "action secondary"}
          onClick={() => {
            setTab("settings");
            setEditing(undefined);
          }}
        >
          角色与场景设定库
        </button>
        <button
          className={tab === "timeline" ? "action" : "action secondary"}
          onClick={() => {
            setTab("timeline");
            setEditing(undefined);
          }}
        >
          剪辑与成片
        </button>
      </nav>
      {error && <p role="alert">{error}</p>}
      {tab === "settings" ? (
        <>
          <div className="production-actions">
            <button
              className="action"
              onClick={() => setEditing({ kind: "character" })}
            >
              新建角色
            </button>
            <button
              className="action secondary"
              onClick={() => setEditing({ kind: "scene" })}
            >
              新建场景
            </button>
            <Link className="action subtle" href="/voices">
              管理声音库
            </Link>
          </div>
          <p className="description">
            设定保留每次保存的版本；分镜明确引用某一版本。修改设定不会替换旧镜头。
          </p>
          {(editing?.kind === "character" || editing?.kind === "scene") && (
            <DefinitionForm
              key={`${editing.kind}-${editing.id ?? "new"}`}
              kind={editing.kind}
              definition={p.definitions.find((d) => d.id === editing.id)}
              voices={voices}
              change={save}
              close={() => setEditing(undefined)}
            />
          )}
          <div className="production-definition-grid">
            {p.definitions.map((d) => {
              const v = d.versions.at(-1)!;
              return (
                <article className="production-card" key={d.id}>
                  <h3>
                    {v.name}{" "}
                    <span className="production-badge">
                      {d.kind === "character" ? "角色" : "场景"} · v{v.version}
                    </span>
                  </h3>
                  <p className="production-copy">
                    {v.description || "未填写描述"}
                  </p>
                  <div className="production-assets">
                    {v.assetIds.map((id) => {
                      const a = assets.find((a) => a.id === id);
                      return (
                        <div className="production-thumb" key={id}>
                          {a && <AssetPreview asset={a} />}
                        </div>
                      );
                    })}
                  </div>
                  {v.voiceId && (
                    <p>
                      声音：
                      {voices.find((x) => x.id === v.voiceId)?.name ??
                        "已保存参考声音"}
                    </p>
                  )}
                  <details>
                    <summary>{d.versions.length} 个历史版本</summary>
                    {d.versions.map((v) => (
                      <div key={v.version}>
                        <p>
                          v{v.version} · {v.name} · {v.assetIds.length} 张参考 ·{" "}
                          {new Date(v.createdAt).toLocaleString()}
                          <br />
                          {v.description}
                        </p>
                        <div className="production-assets">
                          {v.assetIds.map((id) => {
                            const a = assets.find((a) => a.id === id);
                            return a ? (
                              <div key={id} className="production-thumb">
                                <AssetPreview asset={a} />
                              </div>
                            ) : null;
                          })}
                        </div>
                        {v.voiceAssetId && (
                          <div>
                            <p>此版本的参考录音</p>
                            {assets
                              .filter((a) => a.id === v.voiceAssetId)
                              .map((a) => (
                                <AssetPreview key={a.id} asset={a} />
                              ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </details>
                  <div className="production-actions">
                    <button
                      className="action secondary"
                      onClick={() => setEditing({ kind: d.kind, id: d.id })}
                    >
                      编辑并保存新版本
                    </button>
                    <button
                      className="action subtle"
                      onClick={() => {
                        if (
                          confirm(
                            "删除此设定及其历史版本？被分镜引用时会阻止删除，素材文件会保留。",
                          )
                        )
                          void change({ type: "definition.delete", id: d.id });
                      }}
                    >
                      删除设定
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {!p.definitions.length && (
            <p className="empty">
              先为角色和场景建立可复用的设定，再在分镜里选择。
            </p>
          )}
        </>
      ) : (
        <>
          <div className="production-actions">
            <label>
              当前分集
              <select
                value={episode?.id ?? ""}
                onChange={(e) => {
                  setEpisodeId(e.target.value);
                  setRenderId(undefined);
                  setShotId(undefined);
                  setEditing(undefined);
                }}
              >
                <option value="" disabled>
                  请选择分集
                </option>
                {p.episodes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="action"
              onClick={() => setEditing({ kind: "episode" })}
            >
              新建分集
            </button>
            {episode && (
              <button
                className="action secondary"
                onClick={() => setEditing({ kind: "episode", id: episode.id })}
              >
                编辑本集剧本
              </button>
            )}
          </div>
          {editing?.kind === "episode" && (
            <EpisodeForm
              key={editing.id ?? "new"}
              episode={p.episodes.find((e) => e.id === editing.id)}
              change={save}
              close={() => setEditing(undefined)}
            />
          )}
          {tab === "timeline" && episode ? (
            <TimelineEditor
              key={episode.id}
              project={p}
              episode={episode}
              change={change}
              initialPreviewId={renderId}
              onPreviewChange={setRenderId}
            />
          ) : episode ? (
            <>
              <div className="production-actions">
                <p className="description">
                  {episode.shots.length} 个分镜 ·{" "}
                  {episode.shots.filter((s) => s.selectedCandidateId).length}{" "}
                  个已采用 · 计划{" "}
                  {episode.shots
                    .reduce((n, s) => n + s.durationSeconds, 0)
                    .toFixed(1)}{" "}
                  秒
                </p>
                <button
                  className="action subtle"
                  onClick={() => {
                    if (
                      confirm("删除本集？需先删除其中的分镜，素材文件会保留。")
                    )
                      void change({
                        type: "episode.delete",
                        episodeId: episode.id,
                      });
                  }}
                >
                  删除本集
                </button>
              </div>
              <details>
                <summary>本集剧本</summary>
                <p className="production-copy">
                  {episode.script || "尚未填写剧本，可以手工编辑。"}
                </p>
              </details>
              <div className="production-layout">
                <aside className="production-shot-list">
                  <button
                    className="action"
                    onClick={() => setEditing({ kind: "shot" })}
                  >
                    新建分镜
                  </button>
                  {episode.shots.map((s, i) => (
                    <article
                      key={s.id}
                      className={shot?.id === s.id ? "selected" : ""}
                    >
                      <button
                        className="production-shot-button"
                        onClick={() => {
                          setShotId(s.id);
                          setEditing(undefined);
                        }}
                      >
                        <strong>
                          {i + 1}. {s.name}
                        </strong>
                        <small>
                          {s.durationSeconds} 秒 ·{" "}
                          {s.selectedCandidateId ? "已有采用版" : "待选片"} ·{" "}
                          {s.candidates.length} 候选
                        </small>
                      </button>
                      <div className="production-actions">
                        <button
                          className="action subtle"
                          aria-label={`上移 ${s.name}`}
                          disabled={i === 0}
                          onClick={() => move(s.id, -1)}
                        >
                          上移
                        </button>
                        <button
                          className="action subtle"
                          aria-label={`下移 ${s.name}`}
                          disabled={i === episode.shots.length - 1}
                          onClick={() => move(s.id, 1)}
                        >
                          下移
                        </button>
                      </div>
                    </article>
                  ))}
                </aside>
                <div className="production-shot-detail">
                  {editing?.kind === "shot" ? (
                    <ShotForm
                      key={editing.id ?? "new"}
                      p={p}
                      episodeId={episode.id}
                      shot={episode.shots.find((s) => s.id === editing.id)}
                      change={save}
                      close={() => setEditing(undefined)}
                    />
                  ) : shot ? (
                    <>
                      <div className="production-actions">
                        <h2>{shot.name}</h2>
                        <button
                          className="action secondary"
                          onClick={() =>
                            setEditing({ kind: "shot", id: shot.id })
                          }
                        >
                          编辑分镜
                        </button>
                        <button
                          className="action subtle"
                          onClick={() => {
                            if (
                              confirm(
                                "删除此分镜及其候选关联？素材、工作流和任务记录会保留。",
                              )
                            )
                              void change({
                                type: "shot.delete",
                                episodeId: episode.id,
                                shotId: shot.id,
                              });
                          }}
                        >
                          删除分镜
                        </button>
                      </div>
                      <p className="production-copy">
                        {shot.description || "未填写画面描述"}
                      </p>
                      <p className="description">
                        {shot.framing} · {shot.camera} · {shot.durationSeconds}{" "}
                        秒 · 分镜 v{shot.revision}
                      </p>
                      <p>
                        角色：
                        {shot.characters.map(refName).join("、") || "未指定"} ·
                        场景：{shot.scene ? refName(shot.scene) : "未指定"}
                      </p>
                      {shot.dialogue && (
                        <p className="production-copy">台词：{shot.dialogue}</p>
                      )}
                      <ShotPanel
                        project={p}
                        key={shot.id}
                        shot={shot}
                        episodeId={episode.id}
                        change={save}
                      />
                    </>
                  ) : (
                    <p className="empty">
                      新建分镜后，可填写镜头内容并上传图片或视频候选。
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="empty">
              先新建一集，再拆分镜头。也可以先到设定库准备角色和场景。
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
