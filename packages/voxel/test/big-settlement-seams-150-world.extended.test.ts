import { expect, it } from "vitest";
import { bigSettlement, scanSlits } from "./big-settlement-seams.fixture";

it("leaves no sky-visible slit with 150 buildings and the default seed", () => {
  const slits = scanSlits(bigSettlement(150), "world-default", 4);
  expect(slits, slits.slice(0, 6).join("\n")).toHaveLength(0);
}, 60_000);
