"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type Connection,
} from "reactflow";
import {
  modelCatalog,
  type WorkflowGraph,
  type NodeType,
  type LocalAsset,
  type LocalVoice,
} from "@aivideo/contracts";
import {
  ports,
  canConnectWorkflow,
  connectWorkflowInput,
} from "@aivideo/core/workflow";
import { assetOptionLabel } from "@aivideo/core/asset-label";
import RenderField from "./vendor/RenderField.jsx";
import NodeOptionsMenu from "./vendor/NodeOptionsMenu.jsx";
import AudioPlayer from "./vendor/AudioPlayer.jsx";

type Data = WorkflowGraph["nodes"][number]["data"];
const nodeNames: Record<NodeType, string> = {
  "input.text": "文本输入",
  "input.asset": "图片素材",
  "input.voice": "参考声音",
  "generate.image": "生成图片",
  "generate.video": "生成视频",
  "generate.voice": "生成语音",
};
interface EditorContext {
  graph: WorkflowGraph;
  assets: LocalAsset[];
  voices: LocalVoice[];
  voiceURLs: Record<string, string>;
  update: (id: string, change: Partial<Data>) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  connect: (
    target: string,
    handle: string,
    source?: { id: string; handle: string },
  ) => void;
}
const Context = createContext<EditorContext | null>(null);
const portNames: Record<string, string> = {
  prompt: "提示词",
  text: "文本",
  image: "图片",
  video: "视频",
  voice: "声音",
  audio: "音频",
};
function MediaNode({
  id,
  selected,
  inCanvas = true,
}: Pick<NodeProps<Data>, "id" | "selected"> & { inCanvas?: boolean }) {
  const context = useContext(Context)!;
  const node = context.graph.nodes.find((n) => n.id === id)!;
  const kind = node.type.slice(9);
  const models = modelCatalog.filter((m) => m.kind === kind);
  const model = models.find((m) => m.key === node.data.modelKey);
  const setFormValues: Dispatch<SetStateAction<Record<string, string>>> = (
    value,
  ) => {
    const next =
      typeof value === "function" ? value({ prompt: node.data.text }) : value;
    context.update(id, { text: next.prompt ?? "" });
  };
  return (
    <div className={`flow-node ${selected ? "selected" : ""}`}>
      <div className="flow-node-header">
        <strong>
          {!inCanvas &&
            `${context.graph.nodes.findIndex((n) => n.id === id) + 1}. `}
          {node.data.label}
        </strong>
        <NodeOptionsMenu
          nodeId={id}
          onDuplicate={context.duplicate}
          onDelete={() => context.remove(id)}
          downloadUrl={undefined}
          onSetThumbnail={undefined}
          showThumbnailOption={false}
        />
      </div>
      <div className="flow-node-body">
        {Object.entries(ports[node.type].inputs).map(([handle, type]) => (
          <div key={handle} className="flow-port-label">
            {inCanvas && (
              <Handle
                id={handle}
                type="target"
                position={Position.Left}
                style={{ left: -20, background: "#8ba5ff" }}
              />
            )}
            {handle} · {type}
          </div>
        ))}
        <div className="nodrag nowheel">
          {(node.type === "input.text" ||
            node.type.startsWith("generate.")) && (
            <RenderField
              fieldName="prompt"
              meta={{
                type: "string",
                title:
                  node.type === "generate.voice"
                    ? "生成文本（可从连线输入）"
                    : "提示词（可从连线输入）",
                description: "输入文本",
              }}
              idx={0}
              formValues={{ prompt: node.data.text }}
              setFormValues={setFormValues}
              handleChange={(_key: string, value: string) =>
                context.update(id, { text: value })
              }
              data={{
                required: node.type === "input.text" ? ["prompt"] : [],
                onUpload: undefined,
              }}
              modelName="platform"
            />
          )}
          {node.type.startsWith("generate.") && (
            <select
              style={{ marginTop: 10 }}
              aria-label={`${node.data.label}模型`}
              value={node.data.modelKey ?? ""}
              onChange={(e) =>
                context.update(id, {
                  modelKey: e.target.value as Data["modelKey"],
                  parameters: undefined,
                })
              }
            >
              <option value="">选择模型</option>
              {models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          {!!model?.parameters.aspectRatios.length && (
            <label className="flow-parameter">
              画幅
              <select
                aria-label={`${node.data.label}画幅`}
                value={
                  node.data.parameters?.aspectRatio ??
                  model.parameters.aspectRatios[0]
                }
                onChange={(e) =>
                  context.update(id, {
                    parameters: {
                      ...node.data.parameters,
                      aspectRatio: e.target.value as "1:1" | "16:9" | "9:16",
                    },
                  })
                }
              >
                {model.parameters.aspectRatios.map((ratio) => (
                  <option key={ratio}>{ratio}</option>
                ))}
              </select>
            </label>
          )}
          {!!model?.parameters.durationSeconds.length && (
            <label className="flow-parameter">
              时长
              <select
                aria-label={`${node.data.label}时长`}
                value={
                  node.data.parameters?.durationSeconds ??
                  model.parameters.durationSeconds[0]
                }
                onChange={(e) =>
                  context.update(id, {
                    parameters: {
                      ...node.data.parameters,
                      durationSeconds: Number(e.target.value),
                    },
                  })
                }
              >
                {model.parameters.durationSeconds.map((duration) => (
                  <option value={duration} key={duration}>
                    {duration} 秒
                  </option>
                ))}
              </select>
            </label>
          )}
          {node.type === "input.asset" && (
            <select
              aria-label="选择图片素材"
              value={node.data.assetId ?? ""}
              onChange={(e) =>
                context.update(id, { assetId: e.target.value || undefined })
              }
            >
              <option value="">选择图片素材</option>
              {context.assets
                .filter((a) => a.kind === "image")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {assetOptionLabel(a)}
                  </option>
                ))}
            </select>
          )}
          {node.type === "input.voice" && (
            <>
              <select
                aria-label="选择参考声音"
                value={node.data.voiceId ?? ""}
                onChange={(e) =>
                  context.update(id, { voiceId: e.target.value || undefined })
                }
              >
                <option value="">选择参考声音</option>
                {context.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              {node.data.voiceId && context.voiceURLs[node.data.voiceId] && (
                <div style={{ marginTop: 12 }}>
                  <AudioPlayer src={context.voiceURLs[node.data.voiceId]} />
                </div>
              )}
            </>
          )}
        </div>
        {Object.entries(ports[node.type].outputs).map(([handle, type]) => (
          <div key={handle} className="flow-port-label output">
            {handle} · {type}
            {inCanvas && (
              <Handle
                id={handle}
                type="source"
                position={Position.Right}
                style={{ right: -20, background: "#8ba5ff" }}
              />
            )}
          </div>
        ))}
        {!inCanvas && Object.keys(ports[node.type].inputs).length > 0 && (
          <div className="flow-connections">
            {Object.keys(ports[node.type].inputs).map((handle) => {
              const current = context.graph.edges.find(
                (e) => e.target === id && e.targetHandle === handle,
              );
              const base = {
                ...context.graph,
                edges: context.graph.edges.filter(
                  (e) => !(e.target === id && e.targetHandle === handle),
                ),
              };
              const choices = context.graph.nodes.flatMap((source, index) =>
                Object.keys(ports[source.type].outputs)
                  .filter((output) =>
                    canConnectWorkflow(base, {
                      source: source.id,
                      sourceHandle: output,
                      target: id,
                      targetHandle: handle,
                    }),
                  )
                  .map((output) => ({
                    value: JSON.stringify([source.id, output]),
                    label: `${index + 1}. ${source.data.label} · ${portNames[output] ?? output}`,
                  })),
              );
              const value = current
                ? JSON.stringify([current.source, current.sourceHandle])
                : "";
              return (
                <label key={handle}>
                  {portNames[handle] ?? handle}来源
                  <select
                    aria-label={`${node.data.label}的${handle}输入`}
                    value={value}
                    onChange={(event) => {
                      const source = event.target.value
                        ? (JSON.parse(event.target.value) as [string, string])
                        : undefined;
                      context.connect(
                        id,
                        handle,
                        source
                          ? { id: source[0], handle: source[1] }
                          : undefined,
                      );
                    }}
                  >
                    <option value="">不连线（使用节点参数）</option>
                    {current && !choices.some((c) => c.value === value) && (
                      <option value={value}>当前连线无效，请重新选择</option>
                    )}
                    {choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
const nodeTypes = { media: MediaNode };
function subscribeMobile(listener: () => void) {
  const query = window.matchMedia(
    "(max-width: 760px), (max-width: 1000px) and (max-height: 500px)",
  );
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
const mobileSnapshot = () =>
  window.matchMedia(
    "(max-width: 760px), (max-width: 1000px) and (max-height: 500px)",
  ).matches;
const desktopSnapshot = () => false;
export interface WorkflowEditorProps {
  graph: WorkflowGraph;
  onChange: (graph: WorkflowGraph) => void;
  assets: LocalAsset[];
  voices: LocalVoice[];
  voiceURLs: Record<string, string>;
  onSave: () => void;
  saving?: boolean;
  onExport: () => void;
  onValidate: () => void;
  status: string;
  invalid: boolean;
}
export function WorkflowEditor({
  graph,
  onChange,
  assets,
  voices,
  voiceURLs,
  onSave,
  saving,
  onExport,
  onValidate,
  status,
  invalid,
}: WorkflowEditorProps) {
  const mobile = useSyncExternalStore(
    subscribeMobile,
    mobileSnapshot,
    desktopSnapshot,
  );
  const [view, setView] = useState<"canvas" | "list">();
  const listView = (view ?? (mobile ? "list" : "canvas")) === "list";
  const [connectionError, setConnectionError] = useState("");
  // React Flow measurements and selection belong to editor state, not the portable graph.
  const [nodes, setNodes] = useNodesState<Data>(
    graph.nodes.map((n) => ({
      id: n.id,
      type: "media",
      position: n.position,
      data: n.data,
    })),
  );
  const [edges, setEdges] = useEdgesState(graph.edges);
  useEffect(() => {
    setNodes((previous) =>
      graph.nodes.map((n) => ({
        ...previous.find((p) => p.id === n.id),
        id: n.id,
        type: "media",
        position: n.position,
        data: n.data,
      })),
    );
  }, [graph.nodes, setNodes]);
  useEffect(() => {
    setEdges((previous) =>
      graph.edges.map((e) => ({
        ...previous.find((p) => p.id === e.id),
        ...e,
      })),
    );
  }, [graph.edges, setEdges]);
  function update(id: string, change: Partial<Data>) {
    onChange({
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...change } } : n,
      ),
    });
  }
  function remove(id: string) {
    onChange({
      ...graph,
      nodes: graph.nodes.filter((n) => n.id !== id),
      edges: graph.edges.filter((e) => e.source !== id && e.target !== id),
    });
  }
  function duplicate(id: string) {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node || graph.nodes.length >= 20) return;
    onChange({
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          ...node,
          id: crypto.randomUUID(),
          position: { x: node.position.x + 35, y: node.position.y + 65 },
          data: { ...node.data, label: `${node.data.label} 副本` },
        },
      ],
    });
  }
  function add(type: NodeType) {
    if (graph.nodes.length >= 20) return;
    const model = modelCatalog.find((m) => m.kind === type.slice(9));
    onChange({
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: crypto.randomUUID(),
          type,
          position: {
            x: 60 + (graph.nodes.length % 3) * 330,
            y: 60 + Math.floor(graph.nodes.length / 3) * 300,
          },
          data: {
            label: nodeNames[type],
            text: "",
            ...(model ? { modelKey: model.key } : {}),
          },
        },
      ],
    });
  }
  function isValidConnection(c: Connection) {
    return canConnectWorkflow(graph, c);
  }
  function connect(
    target: string,
    handle: string,
    source?: { id: string; handle: string },
  ) {
    try {
      onChange(connectWorkflowInput(graph, target, handle, source));
      setConnectionError("");
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : "更新连线失败",
      );
    }
  }
  return (
    <Context.Provider
      value={{
        graph,
        assets,
        voices,
        voiceURLs,
        update,
        duplicate,
        remove,
        connect,
      }}
    >
      <div className={`workflow-editor ${listView ? "list-mode" : ""}`}>
        <div className="flow-toolbar">
          <input
            aria-label="工作流名称"
            value={graph.name}
            maxLength={100}
            onChange={(e) => onChange({ ...graph, name: e.target.value })}
          />
          <select
            className="input"
            aria-label="添加节点类型"
            style={{ width: 150, padding: 7 }}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) add(e.target.value as NodeType);
              e.target.value = "";
            }}
            disabled={graph.nodes.length >= 20}
          >
            <option value="">＋ 添加节点</option>
            {Object.entries(nodeNames).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
          <button className="action secondary" onClick={onValidate}>
            校验
          </button>
          <button className="action" onClick={onSave} disabled={saving}>
            {saving ? "保存中…" : "保存版本"}
          </button>
          <button className="action subtle" onClick={onExport}>
            导出 JSON
          </button>
        </div>
        <div className="flow-view-toggle" aria-label="工作流编辑方式">
          <button
            className={`action ${listView ? "" : "subtle"}`}
            aria-pressed={listView}
            onClick={() => setView("list")}
          >
            列表编辑
          </button>
          <button
            className={`action ${listView ? "subtle" : ""}`}
            aria-pressed={!listView}
            onClick={() => setView("canvas")}
          >
            画布编辑
          </button>
        </div>
        {listView ? (
          <div className="flow-node-list" aria-label="工作流节点列表">
            <p className="muted">
              逐项编辑参数，通过来源选择器连接节点。执行顺序由连线依赖决定。
            </p>
            {!graph.nodes.length && (
              <p className="description">通过上方“添加节点”开始编辑。</p>
            )}
            {graph.nodes.map((node, index) => (
              <section
                key={node.id}
                aria-label={`节点 ${index + 1}：${node.data.label}`}
              >
                <MediaNode id={node.id} selected={false} inCanvas={false} />
              </section>
            ))}
          </div>
        ) : (
          <div className="flow-canvas" aria-label="工作流画布">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.25}
              maxZoom={1.5}
              onNodesChange={(changes) => {
                const updated = applyNodeChanges(changes, nodes);
                setNodes(updated);
                if (
                  !changes.some(
                    (c) => c.type === "position" || c.type === "remove",
                  )
                )
                  return;
                const ids = new Set(updated.map((n) => n.id));
                onChange({
                  ...graph,
                  nodes: updated.map((n) => ({
                    ...graph.nodes.find((original) => original.id === n.id)!,
                    position: n.position,
                  })),
                  edges: graph.edges.filter(
                    (e) => ids.has(e.source) && ids.has(e.target),
                  ),
                });
              }}
              onEdgesChange={(changes) => {
                const updated = applyEdgeChanges(changes, edges);
                setEdges(updated);
                if (changes.some((c) => c.type === "remove"))
                  onChange({
                    ...graph,
                    edges: updated.map((e) => ({
                      id: e.id,
                      source: e.source,
                      target: e.target,
                      sourceHandle: e.sourceHandle!,
                      targetHandle: e.targetHandle!,
                    })),
                  });
              }}
              isValidConnection={isValidConnection}
              onConnect={(c) => {
                if (isValidConnection(c))
                  onChange({
                    ...graph,
                    edges: [
                      ...graph.edges,
                      {
                        id: crypto.randomUUID(),
                        source: c.source!,
                        target: c.target!,
                        sourceHandle: c.sourceHandle!,
                        targetHandle: c.targetHandle!,
                      },
                    ],
                  });
              }}
            >
              <Background color="#26334b" gap={22} />
              <Controls />
            </ReactFlow>
          </div>
        )}
        {connectionError && (
          <p role="alert" className="error-message">
            {connectionError}
          </p>
        )}
        <div
          className={`flow-status ${invalid ? "error" : ""}`}
          role={invalid ? "alert" : "status"}
        >
          {status ||
            "连接相同类型的端口构建工作流。草稿自动保存在本机，可试运行检查参数与依赖。"}
        </div>
      </div>
    </Context.Provider>
  );
}
