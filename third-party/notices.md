# Open-source reuse and modifications

The application does not include proprietary RunningHub source. Research bundles remain outside the product. No model weights or inference projects are installed.

## Source snapshots (MIT)

| Project                                                                             | Commit                                     | Actual reuse                                                                                                           | Local modifications                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [nextjs/saas-starter](https://github.com/nextjs/saas-starter)                       | `6e33e58b1e553a41fe22e6b941a7229a002de361` | Four UI components, `lib/utils.ts`, dashboard layout as the initial structure                                          | Media navigation and local workspace shell; native label and direct Radix Slot import; authentication replaced by Better Auth. Starter JWT, billing, teams and database migrations were not copied.                                                                                                                                                                                               |
| [Anil-matcha/Open-Generative-AI](https://github.com/Anil-matcha/Open-Generative-AI) | `6b704b0806bf07b435586ff182fb54fffe64253f` | `ImageStudio.jsx`, `VideoStudio.jsx`, `AudioStudio.jsx`, shared controls, locale strings and pure model-family helpers | Replaced MuAPI implementation/catalog/key persistence with platform-owned modules. File uploads use IndexedDB references and local media wrappers. Public upstream demo assets/logos replaced by a local placeholder. Unavailable business errors use UI messages without exception logs. Audio copy/formats narrowed to reference-voice use. Unadapted drawing modal is not mounted or exported. |
| [SamurAIGPT/Vibe-Workflow](https://github.com/SamurAIGPT/Vibe-Workflow)             | `121bde4ef0499ea000be98bdeaf1b244b928a8f3` | `RenderField.jsx`, `NodeOptionsMenu.jsx`, `AudioPlayer.jsx`                                                            | Prompt editing enabled; upload dependency changed to injected callback; removed axios/proxy/remote file assumptions; menu localized; native image wrapper and download helper. Graph container, node protocol, persistence and validation are platform-owned.                                                                                                                                     |

The Vibe `NodeFlow` execution engine and MuAPI proxy were **not** integrated. React Flow handles canvas mechanics; the platform supplies typed media nodes and local graph logic. Sexyvoice's optional recording hook has **not** been imported in this iteration. No claims of reusing those modules should be inferred from their presence in prior research.

The three complete MIT licenses are retained in `licenses/`. `manifest.json` records every copied file, upstream path, fixed commit, upstream SHA-256 and adapted local SHA-256. Platform-owned `models.js`, `platform-client.js`, local media wrappers and business packages are not upstream files.

`scripts/vendor-sources.py` and `scripts/adapt-vendor.py` document the initial import operation and refuse to overwrite an existing adapted snapshot. They are not an updater; future upstream changes require a reviewed diff against the recorded commit.

VideoStudio control initialization was also adapted to restore saved duration and aspect ratio only when supported by the selected model. Previously the default control values overwrote those draft values on reload.

## Installed libraries

Next.js/React, Better Auth, Drizzle/Postgres, Tailwind, Radix Slot, React Flow, Zod, Lucide, React Icons, react-hot-toast, Vitest and Playwright are installed as package dependencies with their license metadata distributed in their packages. Exact resolutions are pinned by `pnpm-lock.yaml`.

pg-boss 12.37.1 (MIT) is installed as the durable PostgreSQL queue; its worker and maintenance logic are used directly. AWS SDK client-s3, lib-storage and s3-request-presigner 3.1150.0 (Apache-2.0) are installed for bounded streaming upload, private reads/deletion and expiring input URLs. Package license files remain in the installed distributions; exact resolutions are pinned in pnpm-lock.yaml. Neither dependency is copied into the MIT source-snapshot manifest.

Trigger.dev, fal and Replicate retain reserved configuration/adapter boundaries. No model execution SDK or paid model call is enabled. An IndexTTS hosted prediction version is not bundled or guessed.

Local task/history navigation extends the adapted starter shell. Task state, IndexedDB migration, cross-tab locking, DAG dry-run execution, checkpoints and Studio history restoration are platform-owned code. They do not reuse Vibe's server execution engine. The Studio API bridge now persists a local request snapshot before checking the disabled platform endpoint; no provider SDK or paid call was added.


## Server execution increment (2026-10-13)

The adapted starter shell now distinguishes the configured browser/server workspace. The three adapted Studio components return the submitted server task ID through an injected callback rather than expecting synchronous media. Their recorded local hashes are updated; upstream hashes and commits remain unchanged. The platform bridge routes to the same task API used by task/history/workflow views.

The server task service, transactional outbox, authenticated private-resource API, cancellation/reconciliation policy and archive checkpoints are platform-owned. Background queue mechanics come from pg-boss; S3 transport comes from AWS SDK. FixtureProvider and tiny fixed media bytes occur exclusively in isolated server tests, with an import-boundary check against product use. The S3 protocol fixture is a local test server, not evidence of a live storage account.

The adapted starter shell now uses a native modal dialog for mobile navigation, with focus restoration, Escape/backdrop dismissal, background scroll locking and a scrollable safe-area-aware panel. Desktop navigation remains a sidebar. The local hash is updated; the fixed upstream commit, hash and MIT notice are retained.

Studio acceptance adaptations preserve every accepted batch task through a platform-owned all-settled submission helper. Image model rows use keyboard-accessible buttons; model counts are numeric. Shared popovers fit clipping ancestors and the viewport. Audio required fields report inline errors and the prompt follows the 500-character contract. Copied source local hashes are updated; fixed upstream commits, hashes and MIT notices are retained.

### 2026-10-15 短剧项目入口

在已改编的 saas-starter 工作区导航中增加 `/projects` 短剧项目入口；原始来源 commit 和 upstream hash 保持不变，本地 hash 已更新。项目、分集、分镜、设定版本与候选领域代码为本项目新增，复用既有上传、任务及工作流模块。

### 2026-10-15 Timeline and movie export

Installed `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0 and `@dnd-kit/utilities` 3.2.2 (MIT) for pointer/keyboard clip ordering. Installed `sharp` 0.35.5 (Apache-2.0) directly in the server package for Pango-backed subtitle layout and PNG composition. Versions are locked in `pnpm-lock.yaml`; these are package dependencies, not copied snapshots.

The worker invokes an administrator-installed FFmpeg/ffprobe executable for probing, trimming, scaling, concatenation, subtitle overlay, audio mixing and H.264/AAC MP4 encoding. This repository does not redistribute FFmpeg binaries. Its build flags and bundled codec libraries determine the applicable upstream license; retain their notices if packaging binaries. See [FFmpeg](https://www.ffmpeg.org/) and [Sharp](https://github.com/lovell/sharp).

Timeline contracts, shot/candidate snapshot import, frame/anchor validation, version conflict handling, render submission, cancellation, private input checks and atomic publication are platform-owned integration. No Remotion runtime, browser renderer or third-party editor backend was copied. Existing source-snapshot manifest entries are unchanged by this increment.


### 2026-10-15 Live timeline finishing

Installed [wavesurfer.js](https://github.com/katspaugh/wavesurfer.js) **7.12.12** (BSD-3-Clause) as a locked npm dependency. Uses its waveform renderer and Regions plugin directly; package license is retained in the distribution. Browser supplies precomputed peaks, following the [official large-file guidance](https://wavesurfer.xyz/docs/). No upstream source snapshot was copied or modified.

Transitions reuse [FFmpeg xfade/acrossfade](https://www.ffmpeg.org/ffmpeg-filters.html), with a bounded two-input overlap pipeline. Caption style rasterization reuses the existing Sharp/Pango dependency. Native browser media playback, the shared frame clock, overlap validation, UI composition, private preview routes and peak aggregation are platform-owned integration. No additional editor backend, GPU or model API was introduced.
