import type { LocalAsset } from "@aivideo/contracts";

/** Filenames alone cannot distinguish outputs from a batch or repeated uploads. */
export function assetOptionLabel(
  asset: Pick<LocalAsset, "id" | "name" | "createdAt">,
) {
  return `${asset.name} · ${new Date(asset.createdAt).toLocaleString()} · ${asset.id.slice(0, 8)}`;
}
