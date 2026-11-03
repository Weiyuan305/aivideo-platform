import {
  modelCatalog,
  workflowSchema,
  type NodeType,
  type WorkflowGraph,
} from "@aivideo/contracts";

export const ports: Record<
  NodeType,
  { inputs: Record<string, string>; outputs: Record<string, string> }
> = {
  "input.text": { inputs: {}, outputs: { text: "text" } },
  "input.asset": { inputs: {}, outputs: { image: "image" } },
  "input.voice": { inputs: {}, outputs: { voice: "voice" } },
  "generate.image": {
    inputs: { prompt: "text", image: "image" },
    outputs: { image: "image" },
  },
  "generate.video": {
    inputs: { prompt: "text", image: "image" },
    outputs: { video: "video" },
  },
  "generate.voice": {
    inputs: { text: "text", voice: "voice" },
    outputs: { audio: "audio" },
  },
};
export function canConnectWorkflow(
  graph: WorkflowGraph,
  connection: {
    source: string | null;
    target: string | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  },
) {
  const { sourceHandle, targetHandle } = connection;
  const source = graph.nodes.find((n) => n.id === connection.source);
  const target = graph.nodes.find((n) => n.id === connection.target);
  if (
    !source ||
    !target ||
    source.id === target.id ||
    !sourceHandle ||
    !targetHandle
  )
    return false;
  const output = ports[source.type].outputs[sourceHandle];
  if (!output || output !== ports[target.type].inputs[targetHandle])
    return false;
  if (
    graph.edges.some(
      (e) => e.target === target.id && e.targetHandle === targetHandle,
    )
  )
    return false;
  const pending = [target.id],
    seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === source.id) return false;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(
      ...graph.edges.filter((e) => e.source === id).map((e) => e.target),
    );
  }
  return graph.edges.length < 50;
}

/** List editing and canvas connections share the same port and cycle rules. */
export function connectWorkflowInput(
  graph: WorkflowGraph,
  target: string,
  targetHandle: string,
  source?: { id: string; handle: string },
): WorkflowGraph {
  const node = graph.nodes.find((n) => n.id === target);
  if (!node || !ports[node.type].inputs[targetHandle])
    throw new Error("连线目标端口不存在");
  const next = {
    ...graph,
    edges: graph.edges.filter(
      (e) => !(e.target === target && e.targetHandle === targetHandle),
    ),
  };
  if (!source) return next;
  const connection = {
    source: source.id,
    sourceHandle: source.handle,
    target,
    targetHandle,
  };
  if (!canConnectWorkflow(next, connection))
    throw new Error("连线类型不匹配或会形成循环");
  return {
    ...next,
    edges: [...next.edges, { id: crypto.randomUUID(), ...connection }],
  };
}
export function validateWorkflow(raw: unknown) {
  const parsed = workflowSchema.safeParse(raw);
  if (!parsed.success)
    return {
      valid: false,
      errors: parsed.error.issues.map(
        (x) => `${x.path.join(".")}: ${x.message}`,
      ),
      order: [] as string[],
    };
  const graph = parsed.data;
  const errors: string[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!graph.nodes.length) errors.push("请添加至少一个节点");
  if (byId.size !== graph.nodes.length) errors.push("节点 ID 重复");
  if (new Set(graph.edges.map((e) => e.id)).size !== graph.edges.length)
    errors.push("连线 ID 重复");
  const inlets = new Set<string>();
  for (const edge of graph.edges) {
    const source = byId.get(edge.source),
      target = byId.get(edge.target);
    if (!source || !target) {
      errors.push("连线引用不存在的节点");
      continue;
    }
    const output = ports[source.type].outputs[edge.sourceHandle],
      input = ports[target.type].inputs[edge.targetHandle];
    if (!output || !input || output !== input)
      errors.push("连线端口类型不匹配");
    const inlet = `${edge.target}:${edge.targetHandle}`;
    if (inlets.has(inlet)) errors.push("同一输入端口只能连接一个来源");
    inlets.add(inlet);
  }
  const degree = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges)
    if (byId.has(e.source) && byId.has(e.target))
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  const ready = graph.nodes
      .filter((n) => degree.get(n.id) === 0)
      .map((n) => n.id),
    order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const e of graph.edges.filter((e) => e.source === id)) {
      const d = (degree.get(e.target) ?? 0) - 1;
      degree.set(e.target, d);
      if (d === 0) ready.push(e.target);
    }
  }
  if (order.length !== graph.nodes.length)
    errors.push("工作流存在循环，请移除回路");
  for (const node of graph.nodes) {
    if (node.type === "input.text" && !node.data.text.trim())
      errors.push(`${node.data.label}：请输入文本`);
    if (node.type === "input.asset" && !node.data.assetId)
      errors.push(`${node.data.label}：请选择图片素材`);
    if (node.type === "input.voice" && !node.data.voiceId)
      errors.push(`${node.data.label}：请选择声音`);
    if (node.type.startsWith("generate.")) {
      const model = modelCatalog.find((m) => m.key === node.data.modelKey);
      const expected = node.type.slice(9);
      if (!model || model.kind !== expected)
        errors.push(`${node.data.label}：请选择匹配的模型`);
      const promptPort = node.type === "generate.voice" ? "text" : "prompt";
      if (!node.data.text.trim() && !inlets.has(`${node.id}:${promptPort}`))
        errors.push(`${node.data.label}：缺少文本输入`);
      if (
        model?.capability === "image_to_video" &&
        !inlets.has(`${node.id}:image`)
      )
        errors.push(`${node.data.label}：图生视频需要图片连线`);
      if (model?.capability === "image_edit" && !inlets.has(`${node.id}:image`))
        errors.push(`${node.data.label}：图片编辑需要图片连线`);
      if (
        model &&
        ["text_to_image", "text_to_video"].includes(model.capability) &&
        inlets.has(`${node.id}:image`)
      )
        errors.push(
          `${node.data.label}：文生模型不接受图片连线，请选择图片编辑或图生视频模型`,
        );
      if (node.type === "generate.voice" && !inlets.has(`${node.id}:voice`))
        errors.push(`${node.data.label}：需要声音连线`);
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], order };
}

/** Browser-local references are checked separately from portable graph structure. */
export function validateReferences(
  graph: WorkflowGraph,
  assets: { id: string; kind: string }[],
  voices: { id: string; assetId: string }[],
) {
  const errors: string[] = [];
  for (const node of graph.nodes) {
    if (
      node.type === "input.asset" &&
      node.data.assetId &&
      !assets.some((a) => a.id === node.data.assetId && a.kind === "image")
    )
      errors.push(`${node.data.label}：图片素材不存在，请重新选择`);
    if (node.type === "input.voice" && node.data.voiceId) {
      const voice = voices.find((v) => v.id === node.data.voiceId);
      if (
        !voice ||
        !assets.some((a) => a.id === voice.assetId && a.kind === "audio")
      )
        errors.push(`${node.data.label}：参考声音不存在，请重新选择`);
    }
  }
  return errors;
}
export function createTemplate(
  kind: "image-video" | "voice" | "blank",
): WorkflowGraph {
  const graph: WorkflowGraph = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name:
      kind === "voice"
        ? "参考声音生成语音"
        : kind === "image-video"
          ? "图片生成视频"
          : "未命名工作流",
    nodes: [],
    edges: [],
  };
  if (kind === "image-video") {
    graph.nodes = [
      {
        id: "prompt",
        type: "input.text",
        position: { x: 0, y: 60 },
        data: { label: "画面提示词", text: "窗边的陶瓷花瓶，自然光" },
      },
      {
        id: "image",
        type: "generate.image",
        position: { x: 350, y: 60 },
        data: {
          label: "生成图片",
          text: "",
          modelKey: "image.agnes-2.5.t2i.v1",
        },
      },
      {
        id: "video",
        type: "generate.video",
        position: { x: 700, y: 60 },
        data: {
          label: "生成视频",
          text: "镜头缓慢推进",
          modelKey: "video.agnes-2.5.i2v.v1",
        },
      },
    ];
    graph.edges = [
      {
        id: "prompt-image",
        source: "prompt",
        sourceHandle: "text",
        target: "image",
        targetHandle: "prompt",
      },
      {
        id: "image-video",
        source: "image",
        sourceHandle: "image",
        target: "video",
        targetHandle: "image",
      },
    ];
  }
  if (kind === "voice") {
    graph.nodes = [
      {
        id: "voice",
        type: "input.voice",
        position: { x: 0, y: 0 },
        data: { label: "参考声音", text: "" },
      },
      {
        id: "text",
        type: "input.text",
        position: { x: 0, y: 250 },
        data: { label: "生成文本", text: "你好，欢迎来到创作工作台。" },
      },
      {
        id: "audio",
        type: "generate.voice",
        position: { x: 360, y: 120 },
        data: {
          label: "生成克隆语音",
          text: "",
          modelKey: "voice.indextts2.clone.v1",
        },
      },
    ];
    graph.edges = [
      {
        id: "voice-audio",
        source: "voice",
        sourceHandle: "voice",
        target: "audio",
        targetHandle: "voice",
      },
      {
        id: "text-audio",
        source: "text",
        sourceHandle: "text",
        target: "audio",
        targetHandle: "text",
      },
    ];
  }
  return graph;
}
export function importWorkflowJSON(text: string): WorkflowGraph {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("工作流 JSON 无法解析，请检查文件内容");
  }
  const parsed = workflowSchema.safeParse(input);
  if (!parsed.success)
    throw new Error("工作流格式无效，仅支持平台 schemaVersion 1");
  return {
    ...parsed.data,
    id: crypto.randomUUID(),
    name: parsed.data.name.slice(0, 95) + " 导入",
  };
}
