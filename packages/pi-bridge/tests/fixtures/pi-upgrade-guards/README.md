# Negative fixtures for the Pi upgrade guards

Each file here is a deliberate violation that `pi-upgrade-guards.test.ts` feeds
to one guard in `../../helpers/pi-upgrade-guards.ts`, asserting the guard
reports it with the expected detail. They are the guards' negative controls: a
guard that cannot fail on its fixture is a placebo.

The `.ts.fixture` suffix keeps the sources out of the TypeScript build, the
linters and the repository-wide boundary scan, which would otherwise (rightly)
report them.

| Fixture                                                           | Guard                 | Violation                                                          |
| ----------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------ |
| `private-agent-mutation.ts.fixture`                               | private-access        | replaces the loop's stream function on `session.agent`             |
| `deep-import.ts.fixture`                                          | deep-import           | imports Pi's `dist/` internals and a `node_modules` path           |
| `boundary-import.ts.fixture`                                      | boundary              | product code importing Pi and naming its session type              |
| `installed-patch.json`                                            | installed-patch       | patch tool, postinstall edit, override, patch dir, drifted install |
| `version-misaligned.json`                                         | version-alignment     | a range, two Pi versions, a nested stray copy, two typebox copies  |
| `undeclared-import.ts.fixture` + `undeclared-import.package.json` | undeclared-dependency | imports `typebox` and `pi-ai` that the manifest does not declare   |
