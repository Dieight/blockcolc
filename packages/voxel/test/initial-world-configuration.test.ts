import { describe, expect, it } from "vitest";
import { initializeWorldConfiguration, type InitialWorldConfigurationPorts } from "../src/initial-world-configuration";

interface Stage { atlas: string | null; }
interface Snapshot { worlds: string[]; pack: string | null; }

describe("initial world/pack configuration", () => {
  it("commits no-pack worlds as one rebuild and keeps existing setters out of the transaction", async () => {
    const { ports, log, state } = fixture();
    const result = await initializeWorldConfiguration(["initial-world"], null, ports);
    expect(result).toBe("committed");
    expect(state.current).toEqual({ worlds: ["initial-world"], pack: null });
    expect(log.filter((entry) => entry === "rebuild")).toHaveLength(1);
    expect(log).toEqual(["prepare:null", "capture", "commit:initial-world:null", "rebuild", "dispose-previous"]);
  });

  it("stages a selected pack before one atomic world rebuild and retires the old pack after success", async () => {
    const { ports, log, state } = fixture({ worlds: ["resident"], pack: "old-pack" });
    const result = await initializeWorldConfiguration(["initial-world"], "new-pack", ports);
    expect(result).toBe("committed");
    expect(state.current).toEqual({ worlds: ["initial-world"], pack: "new-pack" });
    expect(log).toEqual(["prepare:new-pack", "capture", "commit:initial-world:new-pack", "rebuild", "dispose-previous"]);
  });

  it("discards an obsolete staged atlas without adopting worlds", async () => {
    let current = true;
    const { ports, log, state } = fixture(undefined, () => current);
    ports.prepare = async (pack) => {
      log.push(`prepare:${pack ?? "null"}`);
      current = false;
      return { atlas: pack };
    };
    const result = await initializeWorldConfiguration(["stale-world"], "stale-pack", ports);
    expect(result).toBe("stale");
    expect(state.current).toEqual({ worlds: [], pack: null });
    expect(log).toEqual(["prepare:stale-pack", "dispose-staged:stale-pack"]);
  });

  it("restores the old world/pack and releases staged resources if rebuild throws", async () => {
    const { ports, log, state } = fixture({ worlds: ["resident"], pack: "old-pack" });
    ports.commit = (worlds, staged) => {
      log.push(`commit:${worlds.join(",")}:${staged.atlas ?? "null"}`);
      state.current = { worlds: [...worlds], pack: staged.atlas };
      log.push("rebuild");
      throw new Error("synthetic rebuild failure");
    };
    await expect(initializeWorldConfiguration(["new-world"], "new-pack", ports)).rejects.toThrow("synthetic rebuild failure");
    expect(state.current).toEqual({ worlds: ["resident"], pack: "old-pack" });
    expect(log).toEqual([
      "prepare:new-pack", "capture", "commit:new-world:new-pack", "rebuild",
      "rollback:resident:old-pack", "dispose-staged:new-pack",
    ]);
  });

  it("does not mutate world state or retire resources when pack staging fails", async () => {
    const { ports, log, state } = fixture({ worlds: ["resident"], pack: "old-pack" });
    ports.prepare = async (pack) => {
      log.push(`prepare:${pack ?? "null"}`);
      throw new Error("synthetic atlas failure");
    };
    await expect(initializeWorldConfiguration(["new-world"], "bad-pack", ports)).rejects.toThrow("synthetic atlas failure");
    expect(state.current).toEqual({ worlds: ["resident"], pack: "old-pack" });
    expect(log).toEqual(["prepare:bad-pack"]);
  });
});

function fixture(initial: Snapshot = { worlds: [], pack: null }, current: () => boolean = () => true) {
  const log: string[] = [];
  const state: { current: Snapshot } = { current: { worlds: [...initial.worlds], pack: initial.pack } };
  const ports: InitialWorldConfigurationPorts<readonly string[], string | null, Stage, Snapshot> = {
    async prepare(pack) {
      log.push(`prepare:${pack ?? "null"}`);
      return { atlas: pack };
    },
    isCurrent: current,
    capture() {
      log.push("capture");
      return { worlds: [...state.current.worlds], pack: state.current.pack };
    },
    commit(worlds, staged) {
      log.push(`commit:${worlds.join(",")}:${staged.atlas ?? "null"}`);
      state.current = { worlds: [...worlds], pack: staged.atlas };
      log.push("rebuild");
    },
    rollback(previous, _staged) {
      state.current = { worlds: [...previous.worlds], pack: previous.pack };
      log.push(`rollback:${previous.worlds.join(",")}:${previous.pack ?? "null"}`);
    },
    disposeStaged(staged) { log.push(`dispose-staged:${staged.atlas ?? "null"}`); },
    disposePrevious() { log.push("dispose-previous"); },
  };
  return { ports, log, state };
}
