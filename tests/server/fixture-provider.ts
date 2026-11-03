import {
  type ProviderAdapter,
  type Artifact,
  type ProviderState,
} from "../../packages/server/src/types";
export class FixtureProvider implements ProviderAdapter {
  id = "test-fixture";
  submissions = 0;
  failSubmit = false;
  beforePoll?: () => Promise<void>;
  async submit(
    request?: import("../../packages/contracts/src/index").GenerationRequest,
  ) {
    this.submissions++;
    if (this.failSubmit)
      throw new Error("connection lost after possible acceptance");
    return {
      requestId:
        (request?.modelKey.startsWith("video.")
          ? "video"
          : request?.modelKey.startsWith("voice.")
            ? "audio"
            : "image") +
        ":" +
        crypto.randomUUID(),
    };
  }
  async poll(requestId: string): Promise<ProviderState> {
    await this.beforePoll?.();
    this.beforePoll = undefined;
    const kind = (requestId.split(":")[0] || "image") as
      | "image"
      | "audio"
      | "video";
    return {
      status: "succeeded",
      outputs: [
        {
          key: "fixture-output",
          name: `fixture.${kind === "image" ? "png" : kind === "audio" ? "wav" : "mp4"}`,
          kind,
          mime:
            kind === "image"
              ? "image/png"
              : kind === "audio"
                ? "audio/wav"
                : "video/mp4",
        },
      ],
    };
  }
  async cancel() {
    return "requested" as const;
  }
  async openOutput(_artifact: Artifact): Promise<AsyncIterable<Uint8Array>> {
    if (_artifact.kind === "audio")
      return (async function* () {
        const wav = Buffer.alloc(46);
        wav.write("RIFF");
        wav.writeUInt32LE(38, 4);
        wav.write("WAVEfmt ", 8);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(8000, 24);
        wav.writeUInt32LE(16000, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write("data", 36);
        wav.writeUInt32LE(2, 40);
        yield wav;
      })();
    if (_artifact.kind === "video")
      return (async function* () {
        yield Buffer.from([
          0,
          0,
          0,
          24,
          ...Buffer.from("ftypisom"),
          0,
          0,
          0,
          0,
          ...Buffer.from("isommp42"),
        ]);
      })();
    return (async function* () {
      yield new Uint8Array(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
          "base64",
        ),
      );
    })();
  }
}
