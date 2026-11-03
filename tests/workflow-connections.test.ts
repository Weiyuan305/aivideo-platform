import { expect, it } from "vitest";
import {
  createTemplate,
  canConnectWorkflow,
  connectWorkflowInput,
} from "../packages/core/src/workflow";

it("replaces one input source without changing other connections or the original graph", () => {
  const graph = createTemplate("image-video");
  graph.nodes.push({
    id: "reference",
    type: "input.asset",
    position: { x: 0, y: 0 },
    data: { label: "参考图片", text: "", assetId: crypto.randomUUID() },
  });
  const changed = connectWorkflowInput(graph, "video", "image", {
    id: "reference",
    handle: "image",
  });
  expect(changed.edges.filter((e) => e.target === "video")).toMatchObject([
    { source: "reference", sourceHandle: "image", targetHandle: "image" },
  ]);
  expect(changed.edges.find((e) => e.id === "prompt-image")).toEqual(
    graph.edges[0],
  );
  expect(graph.edges[1].source).toBe("image");
  expect(connectWorkflowInput(changed, "video", "image").edges).toEqual([
    graph.edges[0],
  ]);
});

it("rejects incompatible, occupied and self-connected inputs", () => {
  const graph = createTemplate("image-video");
  expect(canConnectWorkflow(graph, graph.edges[0])).toBe(false);
  expect(() =>
    connectWorkflowInput(graph, "video", "image", {
      id: "prompt",
      handle: "text",
    }),
  ).toThrow("连线");
  expect(() =>
    connectWorkflowInput(graph, "image", "image", {
      id: "image",
      handle: "image",
    }),
  ).toThrow("连线");
  expect(graph.edges).toHaveLength(2);
});

it("rejects a cycle even when replacing an existing input", () => {
  const graph = createTemplate("image-video");
  graph.nodes.push({
    ...graph.nodes[1],
    id: "edit",
    data: { ...graph.nodes[1].data, modelKey: "image.flux2.edit.v1" },
  });
  const connected = connectWorkflowInput(graph, "edit", "image", {
    id: "image",
    handle: "image",
  });
  expect(() =>
    connectWorkflowInput(connected, "image", "image", {
      id: "edit",
      handle: "image",
    }),
  ).toThrow("连线");
});
