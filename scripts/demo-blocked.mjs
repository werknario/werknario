// The fabricated-citation demo. The scripted mock model cites a file it never
// read, so the grounding gate refuses the merge request before a human sees it,
// and the audit chain still verifies. This is the run that carries the pitch:
// the guarantee is invisible in a happy path. No key, no server, no network.
// `npm run demo:blocked`.
process.env.LLM_PROVIDER = "mock";
process.env.WERKNARIO_BACKEND = "mock";
process.argv = [
  process.argv[0],
  process.argv[1],
  "Draft the split sheet but add a fabricated citation to show the gate",
  "--yes",
];
await import("../packages/cli/dist/cli.js");
