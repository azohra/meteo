import { describe, expect, it } from "vitest";
import {
  archiveDayStep,
  archiveDayValue,
  archiveDayWindow,
  archivePeriodFor,
  archiveTrailingWindow,
} from "../src/client/index.js";

const DAY_MS = 86_400_000;

const localDayStartMs = (dateValue: string) => {
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Date(year as number, (month as number) - 1, day).getTime();
};

describe("the resolution ladder", () => {
  it("picks the finest period that keeps the span under the point target", () => {
    expect(archivePeriodFor(2 * 3_600_000)).toBe(1);
    expect(archivePeriodFor(DAY_MS)).toBe(5);
    expect(archivePeriodFor(7 * DAY_MS)).toBe(30);
    expect(archivePeriodFor(365 * DAY_MS)).toBe(360);
  });
});

describe("calendar-day math for a host's pager", () => {
  it("turns a date-input value into one whole LOCAL day and refuses a fake one", () => {
    expect(archiveDayWindow("2026-08-05")).toEqual({
      fromMs: localDayStartMs("2026-08-05"),
      toMs: localDayStartMs("2026-08-05") + DAY_MS,
    });
    expect(archiveDayWindow("not-a-day")).toBeNull();
    /* Date() would roll these over into a real date; the input was fake. */
    expect(archiveDayWindow("2026-13-05")).toBeNull();
    expect(archiveDayWindow("2026-02-30")).toBeNull();
  });

  it("steps days across month ends and names an instant's local day", () => {
    expect(archiveDayStep("2026-08-05", -1)).toBe("2026-08-04");
    expect(archiveDayStep("2026-08-31", 1)).toBe("2026-09-01");
    expect(archiveDayStep("2026-03-01", -1)).toBe("2026-02-28");
    expect(archiveDayStep("not-a-day", 1)).toBeNull();
    expect(archiveDayValue(localDayStartMs("2026-08-05") + DAY_MS / 2)).toBe("2026-08-05");
  });

  it("gives the trailing day ending at the asked instant", () => {
    const nowMs = localDayStartMs("2026-08-05") + 14 * 3_600_000;
    expect(archiveTrailingWindow(nowMs)).toEqual({ fromMs: nowMs - DAY_MS, toMs: nowMs });
  });
});
