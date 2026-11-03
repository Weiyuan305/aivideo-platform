# Timeline live preview and finishing implementation plan

**Goal:** Edit uploaded clips, hear original audio and overlapping voice tracks, inspect waveforms, preview transitions and styled captions, then export the same saved edit on desktop and mobile.

**Architecture:** Extend the versioned timeline contract without changing old drafts. Share frame timing and transition rules in core. Browser native media performs draft playback; wavesurfer.js draws precomputed peaks. FFmpeg remains the bounded CPU renderer. Sharp/Pango generates the same caption PNG for live preview and export. No model API, GPU, Redis or browser rendering worker.

**Tech stack:** Next.js / React, Zod, wavesurfer.js 7 (BSD-3-Clause), existing dnd-kit, FFmpeg, Sharp/Pango, PostgreSQL/pg-boss/private asset storage.

## Global constraints

- Keep existing projects, frozen render snapshots, asset ownership, cancellation and retry behavior.
- A clip's incoming transition overlaps its predecessor; combined incoming/outgoing overlap must be shorter than that clip. First clip cannot have an incoming transition. Crossfade and left-to-right wipe use the same timing in browser and FFmpeg; original audio crossfades linearly for both.
- Captions remain non-overlapping. Reordering, removing or changing transitions revalidates anchored tracks. Hard cuts remain the default.
- Preview routes require existing authentication/ownership and origin protection. Bound waveform decoding, caption size, process runtime, cache size and concurrency.
- Reuse existing isolated database and uploaded synthetic fixtures. Real model adapters stay disabled. Main agent implements and accepts inline; no Git mutations or deployment requested.

## Implementation sequence

- [x] Contracts/core: optional transition and caption styles, overlap-aware starts/total/SRT, shared preview composition; unit tests for boundaries and backward compatibility.
- [x] Server: shared caption rasterizer, bounded waveform peaks endpoint, two-input transition rendering with bounded memory; actual media and endpoint authorization tests.
- [x] UI: synchronized draft player, play/pause/seek/frame stepping, waveform region and seek, transition inspector, per-caption styles/presets; responsive controls and failure states.
- [x] Verification: lint/type checks, unit and isolated server regression, production build; desktop and mobile edit → live preview → save → worker export → playback/download → reuse. Inspect actual encoded frames/duration/audio.
- [x] Update usage and dependency notices; report tested evidence and remaining device/provider limits.

## Files

- `packages/contracts/src/timeline.ts`, `packages/core/src/timeline.ts`, `tests/timeline.test.ts`.
- `packages/server/src/{render,caption,waveform}.ts`, server exports; authenticated preview API routes.
- `apps/web/features/timeline/{timeline-editor,timeline-preview,audio-waveform,caption-style-editor}.tsx`, `apps/web/app/globals.css`.
- `tests/server/{render,http}.test.ts`, `docs/timeline-export.md`, `third-party/notices.md`, package manifest and lockfile.

## Acceptance criteria

- Old hard-cut drafts still save/render unchanged; transitions shorten total duration accurately and follow reordering.
- Live playback shows both transition layers, mixes active tracks, seeks and stops at end; edits pause/rebuild preview; missing media errors remain visible.
- Waveforms show source trim regions and click-to-seek; audio decoding is not multiplied across browser tracks.
- Styled Chinese subtitles have matching position, line breaks and pixels in preview and export.
- Actual MP4 has expected overlap duration, transition pixels, audible track placement and no duplicate outputs. Unauthorized preview/asset access is rejected.
- Desktop plus 390/320 CSS-pixel layouts are usable without page overflow, runtime errors or hidden primary actions.


## Completion evidence (2026-10-15)

- `pnpm test`: 55/55; isolated `pnpm test:server` including the authenticated HTTP server: 50/50, no skips. Actual output checks include overlap duration, crossfade/wipe RGB pixels, yellow top-position CJK captions, overlapping PCM audio, peaks, session/Origin/ownership, cancellation and archive recovery. Existing monitoring and database/media backup/restore suites also pass.
- `pnpm lint`, `pnpm build`, `pnpm format:check`, `pnpm verify:sources`: pass (62 copied source hashes unchanged). Frontend-only acceptance refinements were typechecked and rebuilt after the server suite; server code did not change afterward.
- CUA browser: desktop and 390/320 CSS px. Uploaded color-card video and a second synthesized WAV; set crossfade and wipe, selected styled captions, played two simultaneous voice tracks, stepped into overlaps, dragged a waveform trim from 2.0 to 1.5 seconds, used waveform seek, saved and exported.
- Desktop v4: 5.0 sec; mobile v5: 4.9 sec; reused the v5 MP4 as a trimmed new clip and exported v6: 6.4 sec. All downloaded actual H.264/AAC 720x1280 files; task return link restores episode, timeline and exact render. Final video playback verified through its native controls. No page-wide overflow or app console errors.
- Acceptance fix: preserve exact portrait canvas aspect ratio under the preview height limit; stop continuous preview refresh while paused; stop source-audition audio when composed playback starts; preserve 72% default opacity with a 0.01 slider step.
- Runtime artifacts/screenshots/logs are outside the repository under `/private/tmp/aivideo-live-qa` and `/private/tmp/aivideo-live-*.log`. Example project: “全链路验收 · 雨夜来信”, second episode, v6. Production Web and disabled-provider worker remain running. Isolated HTTP service stopped.
- Not validated: physical iOS/Android devices, Safari autoplay/volume policy, 10-minute maximum-complexity performance, target deployment/S3, or real model calls. Current composition is a primary picture sequence (two overlapping layers during transitions), multiple voice tracks and one caption layer.
