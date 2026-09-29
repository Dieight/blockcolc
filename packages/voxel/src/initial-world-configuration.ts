/** Transaction used only by the first renderer bootstrap to adopt worlds and an optional pack together. */
export interface InitialWorldConfigurationPorts<Worlds, Pack, Staged, Previous> {
  /** Stage expensive work (the atlas) without changing visible renderer state. */
  prepare(pack: Pack): Promise<Staged>;
  /** Invalidate a staged result if a newer pack request or renderer disposal won the race. */
  isCurrent(): boolean;
  capture(): Previous;
  /** Adopt the world and staged pack together, then perform exactly one rebuild. */
  commit(worlds: Worlds, staged: Staged): void;
  /** Restore previous state if commit/rebuild fails. */
  rollback(previous: Previous, staged: Staged): void;
  disposeStaged(staged: Staged): void;
  /** Release prior pack resources only after the new configuration commits. */
  disposePrevious(previous: Previous): void;
}

/**
 * Does not own renderer state. It coordinates stage -> current check -> adopt
 * -> rollback/retirement so failures cannot publish a partial world/pack pair.
 */
export async function initializeWorldConfiguration<Worlds, Pack, Staged, Previous>(
  worlds: Worlds,
  pack: Pack,
  ports: InitialWorldConfigurationPorts<Worlds, Pack, Staged, Previous>,
): Promise<"committed" | "stale"> {
  const staged = await ports.prepare(pack);
  if (!ports.isCurrent()) {
    ports.disposeStaged(staged);
    return "stale";
  }
  const previous = ports.capture();
  try {
    ports.commit(worlds, staged);
  } catch (error) {
    try {
      ports.rollback(previous, staged);
    } finally {
      ports.disposeStaged(staged);
    }
    throw error;
  }
  ports.disposePrevious(previous);
  return "committed";
}
