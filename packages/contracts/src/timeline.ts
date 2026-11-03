import { z } from "zod";
const id = z.string().uuid();
const frame = z.number().int().min(0).max(18000);
const duration = z.number().int().min(1).max(18000);
export const transitionSchema = z
  .object({
    kind: z.enum(["crossfade", "wipe"]),
    duration: z.number().int().min(1).max(90),
  })
  .strict();
export const captionStyleSchema = z
  .object({
    fontSize: z.number().int().min(20).max(80),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    backgroundOpacity: z.number().min(0).max(1),
    position: z.enum(["top", "center", "bottom"]),
    align: z.enum(["left", "center", "right"]),
    bold: z.boolean(),
  })
  .strict();
export const timelineClipSchema = z
  .object({
    id,
    assetId: id,
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["image", "video"]),
    sourceIn: frame,
    duration,
    volume: z.number().min(0).max(1),
    shotId: id.optional(),
    candidateId: id.optional(),
    transition: transitionSchema.optional(),
  })
  .strict();
export const timelineAudioSchema = z
  .object({
    id,
    assetId: id,
    name: z.string().trim().min(1).max(200),
    clipId: id.optional(),
    start: frame,
    sourceIn: frame,
    duration,
    volume: z.number().min(0).max(1),
  })
  .strict();
export const timelineCaptionSchema = z
  .object({
    id,
    clipId: id.optional(),
    start: frame,
    duration,
    text: z.string().trim().min(1).max(300),
    style: captionStyleSchema.optional(),
  })
  .strict();
export const timelineSchema = z
  .object({
    fps: z.literal(30),
    format: z.enum(["landscape", "portrait", "square"]),
    clips: z.array(timelineClipSchema).max(100),
    audio: z.array(timelineAudioSchema).max(20),
    captions: z.array(timelineCaptionSchema).max(200),
  })
  .strict();
export const renderSnapshotSchema = z
  .object({
    projectId: id,
    episodeId: id,
    projectName: z.string().max(100),
    episodeName: z.string().max(100),
    version: z.number().int().positive(),
    timeline: timelineSchema,
  })
  .strict();
export const renderSubmissionSchema = z
  .object({
    episodeId: id,
    version: z.number().int().positive(),
    idempotencyKey: id,
  })
  .strict();
export type Timeline = z.infer<typeof timelineSchema>;
export type TimelineClip = z.infer<typeof timelineClipSchema>;
export type TimelineAudio = z.infer<typeof timelineAudioSchema>;
export type TimelineCaption = z.infer<typeof timelineCaptionSchema>;
export type RenderSnapshot = z.infer<typeof renderSnapshotSchema>;
export type CaptionStyle = z.infer<typeof captionStyleSchema>;
export const captionPreviewSchema = z
  .object({
    format: timelineSchema.shape.format,
    text: timelineCaptionSchema.shape.text,
    style: captionStyleSchema.optional(),
  })
  .strict();
