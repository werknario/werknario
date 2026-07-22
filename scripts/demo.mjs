// Cross-platform 30-second demo launcher. `npm run demo` works the same on
// Windows (PowerShell/cmd), macOS, and Linux, because node sets the environment
// rather than a bash-only inline `FOO=bar` prefix. It runs the whole flow against
// an in-memory repo with the scripted mock model: no key, no server, no network.
process.env.LLM_PROVIDER = "mock";
process.env.WERKNARIO_BACKEND = "mock";
process.argv = [
  process.argv[0],
  process.argv[1],
  "Draft the split sheet from the session note",
  "--yes",
];
await import("../packages/cli/dist/cli.js");
