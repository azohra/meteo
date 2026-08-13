import type { CodestreamHeader } from "./codestream.js";
import { parseCodestream } from "./codestream.js";
import type { CodeblockTask, PacketPlan } from "./packets.js";
import { parsePackets } from "./packets.js";
import { decodeCodeblock } from "./t1.js";

export interface DecodePlan extends PacketPlan {
  header: CodestreamHeader;
}

/** Parses headers and packet structure only — no entropy decoding — and
 * returns every codeblock as an independent, serializable work order. */
export function planDecode(codestream: Uint8Array): DecodePlan {
  const header = parseCodestream(codestream);
  return { header, ...parsePackets(codestream, header) };
}

/**
 * Decodes one codeblock from its own codeword bytes (`bytes[0, byteLength)`),
 * independent of every other codeblock.
 */
export function decodeCodeblockTask(bytes: Uint8Array, task: CodeblockTask): Int32Array {
  return decodeCodeblock(
    bytes,
    0,
    task.byteLength,
    task.width,
    task.height,
    task.band,
    task.numbps,
    task.passes,
  );
}

/**
 * Places one decoded codeblock's coefficients into the tile buffer at the
 * task's (tileX, tileY); writes stay inside the task's own rectangle, so
 * concurrent placements never overlap.
 */
export function placeCodeblock(
  tile: Int32Array,
  tileWidth: number,
  task: CodeblockTask,
  coefficients: Int32Array,
): void {
  for (let y = 0; y < task.height; y++) {
    const from = y * task.width;
    const to = (task.tileY + y) * tileWidth + task.tileX;
    for (let x = 0; x < task.width; x++) tile[to + x] = coefficients[from + x]!;
  }
}
