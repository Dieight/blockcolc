import { expect, it } from "vitest";
import { bigSettlement, scanSlits } from "./big-settlement-seams.fixture";

it.each(["world-default", "probe-seed-16"])("leaves no sky-visible slit with 100 buildings and seed %s", (seed) => {
  const slits = scanSlits(bigSettlement(100), seed, 4);
  expect(slits, slits.slice(0, 6).join("\n")).toHaveLength(0);
}, 60_000);
