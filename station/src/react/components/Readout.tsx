"use client";
import type { ReadoutPart } from "../../scene/index.js";
import { WindArrow } from "./WindArrow.js";

/* The inspection-readout idiom the charts share: an <output> whose bold lead
 * names the moment and whose tail states the reading — aria-live polite at
 * rest so a pin announces, off while the pointer sweeps so a hover never
 * floods a screen reader. */
export function Readout({
  ariaLabel,
  ariaLive,
  className,
  strong,
  parts,
}: {
  ariaLabel: string;
  ariaLive: "off" | "polite";
  className: string;
  strong: string;
  parts: ReadoutPart[];
}) {
  return (
    <output aria-label={ariaLabel} aria-live={ariaLive} className={className}>
      <strong>{strong}</strong>
      <span>
        {parts.map((part, index) =>
          part.kind === "arrow" ? <WindArrow deg={part.deg} key={index} /> : part.text,
        )}
      </span>
    </output>
  );
}
