"use client";
import { useState } from "react";
import type {
  Production,
  ProductionCommand,
  ProductionShot,
  DefinitionInput,
  ShotInput,
  LocalVoice,
} from "@aivideo/contracts";
import { AssetPicker } from "./asset-picker";
export type Change = (command: ProductionCommand) => Promise<boolean>;
export function DefinitionForm({
  definition,
  kind,
  voices,
  change,
  close,
}: {
  definition?: Production["definitions"][number];
  kind: "character" | "scene";
  voices: LocalVoice[];
  change: Change;
  close: () => void;
}) {
  const last = definition?.versions.at(-1);
  const [value, setValue] = useState<DefinitionInput>(
    last ?? { name: "", description: "", assetIds: [] },
  );
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  return (
    <form
      className="production-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (uploading) return;
        setBusy(true);
        const ok = await change({
          type: "definition.save",
          id: definition?.id ?? crypto.randomUUID(),
          kind,
          input: {
            name: value.name,
            description: value.description,
            assetIds: value.assetIds,
            ...(value.voiceId ? { voiceId: value.voiceId } : {}),
          },
        });
        setBusy(false);
        if (ok) close();
      }}
    >
      <h3>
        {definition
          ? "新建设定版本"
          : kind === "character"
            ? "新建角色"
            : "新建场景"}
      </h3>
      <label>
        设定名称
        <input
          required
          maxLength={100}
          value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })}
        />
      </label>
      <label>
        设定描述
        <textarea
          maxLength={4000}
          value={value.description}
          onChange={(e) => setValue({ ...value, description: e.target.value })}
          placeholder="外貌、服装或场景布局，供分镜引用"
        />
      </label>
      {kind === "character" && (
        <label>
          绑定声音
          <select
            value={value.voiceId ?? ""}
            onChange={(e) =>
              setValue({ ...value, voiceId: e.target.value || undefined })
            }
          >
            <option value="">暂不绑定</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <AssetPicker
        onUploading={setUploading}
        imagesOnly
        value={value.assetIds}
        onChange={(assetIds) => setValue({ ...value, assetIds })}
      />
      <div className="production-actions">
        <button className="action" disabled={busy || uploading}>
          {busy ? "保存中…" : "保存设定"}
        </button>
        <button
          type="button"
          className="action secondary"
          disabled={busy || uploading}
          onClick={close}
        >
          取消
        </button>
      </div>
    </form>
  );
}
function refValue(ref: { id: string; version: number }) {
  return `${ref.id}:${ref.version}`;
}
function parseRef(value: string) {
  const [id, version] = value.split(":");
  return { id, version: Number(version) };
}
export function ShotForm({
  p,
  episodeId,
  shot,
  change,
  close,
}: {
  p: Production;
  episodeId: string;
  shot?: ProductionShot;
  change: Change;
  close: () => void;
}) {
  const [value, setValue] = useState<ShotInput>(() => ({
    name: shot?.name ?? "",
    description: shot?.description ?? "",
    dialogue: shot?.dialogue ?? "",
    framing: shot?.framing ?? "中景",
    camera: shot?.camera ?? "固定",
    durationSeconds: shot?.durationSeconds ?? 5,
    characters: shot?.characters ?? [],
    scene: shot?.scene,
  }));
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="production-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await change({
          type: "shot.save",
          episodeId,
          shotId: shot?.id ?? crypto.randomUUID(),
          input: value,
        });
        setBusy(false);
        if (ok) close();
      }}
    >
      <h3>{shot ? "编辑分镜" : "新建分镜"}</h3>
      <label>
        镜头名称
        <input
          required
          maxLength={100}
          value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })}
        />
      </label>
      <label>
        画面描述
        <textarea
          maxLength={4000}
          value={value.description}
          onChange={(e) => setValue({ ...value, description: e.target.value })}
        />
      </label>
      <label>
        台词
        <textarea
          maxLength={4000}
          value={value.dialogue}
          onChange={(e) => setValue({ ...value, dialogue: e.target.value })}
        />
      </label>
      <div className="production-form-grid">
        <label>
          景别
          <input
            maxLength={80}
            value={value.framing}
            onChange={(e) => setValue({ ...value, framing: e.target.value })}
          />
        </label>
        <label>
          运镜
          <input
            maxLength={80}
            value={value.camera}
            onChange={(e) => setValue({ ...value, camera: e.target.value })}
          />
        </label>
        <label>
          计划时长（秒）
          <input
            type="number"
            required
            min="0.1"
            max="300"
            step="0.1"
            value={value.durationSeconds}
            onChange={(e) =>
              setValue({ ...value, durationSeconds: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <label>
        场景版本
        <select
          value={value.scene ? refValue(value.scene) : ""}
          onChange={(e) =>
            setValue({
              ...value,
              scene: e.target.value ? parseRef(e.target.value) : undefined,
            })
          }
        >
          <option value="">暂不关联场景</option>
          {p.definitions
            .filter((d) => d.kind === "scene")
            .flatMap((d) =>
              d.versions.map((v) => (
                <option
                  key={`${d.id}:${v.version}`}
                  value={`${d.id}:${v.version}`}
                >
                  {v.name} · v{v.version}
                </option>
              )),
            )}
        </select>
      </label>
      <fieldset>
        <legend>角色版本</legend>
        {p.definitions
          .filter((d) => d.kind === "character")
          .map((d) => (
            <label key={d.id}>
              {d.versions.at(-1)!.name}
              <select
                value={
                  value.characters.find((r) => r.id === d.id)?.version ?? ""
                }
                onChange={(e) =>
                  setValue({
                    ...value,
                    characters: [
                      ...value.characters.filter((r) => r.id !== d.id),
                      ...(e.target.value
                        ? [{ id: d.id, version: Number(e.target.value) }]
                        : []),
                    ],
                  })
                }
              >
                <option value="">不出场</option>
                {d.versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.name} · v{v.version}
                  </option>
                ))}
              </select>
            </label>
          ))}
      </fieldset>
      <p className="description">
        引用固定版本；更新设定库后，可在这里主动选择新版本。修改分镜会保留候选和采用版。
      </p>
      <div className="production-actions">
        <button className="action" disabled={busy}>
          保存分镜
        </button>
        <button
          type="button"
          className="action secondary"
          disabled={busy}
          onClick={close}
        >
          取消
        </button>
      </div>
    </form>
  );
}
export function EpisodeForm({
  episode,
  change,
  close,
}: {
  episode?: Production["episodes"][number];
  change: Change;
  close: () => void;
}) {
  const [name, setName] = useState(episode?.name ?? ""),
    [script, setScript] = useState(episode?.script ?? ""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="production-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await change({
          type: "episode.save",
          id: episode?.id ?? crypto.randomUUID(),
          name,
          script,
        });
        setBusy(false);
        if (ok) close();
      }}
    >
      <h3>{episode ? "编辑分集剧本" : "新建分集"}</h3>
      <label>
        分集名称
        <input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        本集剧本
        <textarea
          rows={6}
          maxLength={50000}
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />
      </label>
      <div className="production-actions">
        <button className="action" disabled={busy}>
          保存分集
        </button>
        <button
          type="button"
          className="action secondary"
          disabled={busy}
          onClick={close}
        >
          取消
        </button>
      </div>
    </form>
  );
}
