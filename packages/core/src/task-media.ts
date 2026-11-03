import type { LocalAsset, LocalVoice } from "@aivideo/contracts";
export type TaskReferences = { assetIds: string[]; voiceIds: string[] };
/** Fetch task references by ID, independent of the bounded library listing. */
export async function loadTaskMedia(
  refs: TaskReferences,
  read: {
    asset: (id: string) => Promise<LocalAsset | undefined>;
    voice: (id: string) => Promise<LocalVoice | undefined>;
  },
) {
  const voices = await Promise.all(refs.voiceIds.map(read.voice));
  const ids = [
    ...new Set([
      ...refs.assetIds,
      ...voices.flatMap((v) => (v ? [v.assetId] : [])),
    ]),
  ];
  const found = await Promise.all(ids.map(read.asset));
  return {
    assets: found.filter((a): a is LocalAsset => !!a),
    missing: ids.filter((_, i) => !found[i]),
  };
}
