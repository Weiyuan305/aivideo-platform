import { z } from "zod";
import { timelineSchema } from "./timeline";
const id = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const text = z.string().trim().max(4000);
export const definitionInputSchema = z
  .object({
    name,
    description: text.default(""),
    assetIds: z.array(id).max(10).default([]),
    voiceId: id.optional(),
  })
  .strict();
export const definitionVersionSchema = definitionInputSchema.extend({
  version: z.number().int().positive(),
  voiceAssetId: id.optional(),
  createdAt: z.string(),
});
export const definitionRefSchema = z
  .object({ id, version: z.number().int().positive() })
  .strict();
export const shotInputSchema = z
  .object({
    name,
    description: text.default(""),
    dialogue: text.default(""),
    framing: z.string().trim().max(80).default(""),
    camera: z.string().trim().max(80).default(""),
    durationSeconds: z.number().min(0.1).max(300).default(5),
    characters: z.array(definitionRefSchema).max(10).default([]),
    scene: definitionRefSchema.optional(),
  })
  .strict();
export const candidateSchema = z.object({
  id,
  assetId: id,
  label: name,
  createdAt: z.string(),
  sourceJobId: id.optional(),
  basis: shotInputSchema.extend({ revision: z.number().int().positive() }),
});
export const shotSchema = shotInputSchema.extend({
  id,
  revision: z.number().int().positive(),
  candidates: z.array(candidateSchema).max(100),
  selectedCandidateId: id.optional(),
  taskIds: z.array(id).max(100),
  workflowIds: z.array(id).max(100),
});
export const productionSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  name,
  description: text,
  revision: z.number().int().positive(),
  updatedAt: z.string(),
  definitions: z
    .array(
      z.object({
        id,
        kind: z.enum(["character", "scene"]),
        versions: z.array(definitionVersionSchema).min(1).max(100),
      }),
    )
    .max(100),
  episodes: z
    .array(
      z.object({
        id,
        name,
        script: z.string().max(50000),
        shots: z.array(shotSchema).max(100),
        timeline: z
          .object({
            version: z.number().int().positive(),
            draft: timelineSchema,
          })
          .optional(),
      }),
    )
    .max(50),
});
const episode = { episodeId: id };
const shot = { ...episode, shotId: id };
export const productionCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project.edit"), name, description: text }),
  z.object({
    type: z.literal("episode.save"),
    id,
    name,
    script: z.string().max(50000),
  }),
  z.object({ type: z.literal("episode.delete"), ...episode }),
  z.object({
    type: z.literal("timeline.save"),
    ...episode,
    input: timelineSchema,
  }),
  z.object({
    type: z.literal("definition.save"),
    id,
    kind: z.enum(["character", "scene"]),
    input: definitionInputSchema,
  }),
  z.object({ type: z.literal("definition.delete"), id }),
  z.object({ type: z.literal("shot.save"), ...shot, input: shotInputSchema }),
  z.object({ type: z.literal("shot.delete"), ...shot }),
  z.object({
    type: z.literal("shot.order"),
    ...episode,
    ids: z.array(id).max(100),
  }),
  z.object({
    type: z.literal("candidate.add"),
    ...shot,
    id,
    assetId: id,
    label: name,
    sourceJobId: id.optional(),
  }),
  z.object({
    type: z.literal("candidate.select"),
    ...shot,
    candidateId: id.nullable(),
  }),
  z.object({ type: z.literal("candidate.delete"), ...shot, candidateId: id }),
  z.object({ type: z.literal("task.link"), ...shot, taskId: id }),
  z.object({ type: z.literal("task.unlink"), ...shot, taskId: id }),
  z.object({ type: z.literal("workflow.link"), ...shot, workflowId: id }),
  z.object({ type: z.literal("workflow.unlink"), ...shot, workflowId: id }),
]);
export type Production = z.infer<typeof productionSchema>;
export type ProductionCommand = z.infer<typeof productionCommandSchema>;
export type ProductionShot = z.infer<typeof shotSchema>;
export type ShotInput = z.infer<typeof shotInputSchema>;
export type DefinitionInput = z.infer<typeof definitionInputSchema>;
export type DefinitionRef = z.infer<typeof definitionRefSchema>;
export type ProductionSummary = Pick<
  Production,
  "id" | "name" | "description" | "revision" | "updatedAt"
> & { episodes: number; shots: number; selected: number };
export const productionCreateSchema = z.object({ id, name }).strict();
export const productionQuerySchema = z.object({
  q: z.string().max(100),
  offset: z.coerce.number().int().min(0).max(100000),
});
export const productionRevisionSchema = z
  .object({ revision: z.number().int().positive() })
  .strict();
export const productionChangeSchema = productionRevisionSchema.extend({
  command: productionCommandSchema,
});
export const productionIdSchema = id;
