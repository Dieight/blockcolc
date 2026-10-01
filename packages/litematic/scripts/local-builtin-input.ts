/** Conversion is an explicit maintenance operation, never an application build prerequisite. */
export function selectLocalBuiltinInput(argument: string | undefined): string {
  if (!argument?.trim()) {
    throw new Error(
      'Local blueprint conversion requires an explicit input directory. '
      + 'Use npm run package:local-builtins -w @blockcolc/litematic -- <input directory>; '
      + 'application builds use the existing workspace JSON assets.',
    );
  }
  return argument.trim();
}
