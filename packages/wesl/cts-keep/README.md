# CTS oracle keep-set

A tiny, hand-edited set of CTS cases and shaders that always runs, in the same
wire formats as the generated dumps (`cases/` decoded by `CtsCases.ts`,
`shaders/` by `CtsShaders.ts`). Its job is to smoke-test the extract -> decode
-> check machinery from a bare checkout, before and independent of the sampled
corpus (checked into the cts fork under `dumps/cases/` and `dumps/shaders/`).
The oracles read the keep-set additively, so every entry here runs on every
commit even when the cts submodule is not checked out.

This set is hand-maintained; it is never tool-regenerated. It grows by rule:

- Regression pins: when a fix lands for a bug the oracles caught, add the
  triggering case or shader here so it is always re-run.
- Construct representatives: one entry per construct, added once the oracles
  attribute gaps to a construct, so every construct is always exercised.

Keep it small enough to review. Seeded with one tiny case list per expression
shape (binary / unary / assign / call+member) and a few representative shaders.
