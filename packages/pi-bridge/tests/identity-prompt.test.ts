/**
 * The identity prompt's contract (change `rebuild-skill-prompt-and-eval`).
 *
 * Replaces `system-prompt.test.ts`, which asserted a 15,630-character prompt built
 * around a mandatory SKILL-read protocol, a duplicated didactic floor, a German
 * language default and a worked XML-entity example — all removed here.
 *
 * Asserted: the budget, the conduct floor's exact membership, the ONE language rule,
 * the corpus half of the opening protocol WITHOUT a skill read, the tool statement's
 * agreement with the registered set, and — the load-bearing one — that no rule is
 * stated in two channels.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cbeIdentityPrompt, IDENTITY_PROMPT_BUDGET, stripFrontmatter } from "../src/cbe-system-prompt.js";
import { CBE_TOOL_ALLOWLIST } from "../src/session.js";
import { buildEnvironmentDescriptor } from "../src/environment.js";
import { createCiteTool } from "../src/cite-tool.js";
import { createWikiTool } from "../src/wiki-tool.js";
import { WikiRetrievalGate } from "../src/wiki-index.js";
import { toolProse } from "./tool-prose.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillBody = stripFrontmatter(readFileSync(path.resolve(__dirname, "../../../skills/cbe/SKILL.md"), "utf8"));

/**
 * The whole prose surface of `cbe_cite` — `description` plus every parameter
 * description — so the channel-boundary assertions can read the tool side of the
 * citation-sequencing carve-out (Requirement: *Instruction Channel Boundary*). The
 * walk itself is shared with the budget test, which measures every registered tool.
 */
function citeToolProse(): string {
  return toolProse(createCiteTool(null));
}

/** The whole prose surface of `cbe_wiki`, for the same reason (change
 * `give-the-wiki-a-reading-route`). */
function wikiToolProse(): string {
  return toolProse(createWikiTool(new WikiRetrievalGate(), undefined));
}

describe("identity prompt — the documented budget", () => {
  // Requirement: Identity-Prompt Instruction Budget. BASIS, STATED HONESTLY: a
  // judgement ratchet, not a measured limit. The prompt it replaces was 15,630 chars.
  it("stays under the documented cap", () => {
    expect(cbeIdentityPrompt.length).toBeLessThan(IDENTITY_PROMPT_BUDGET);
    console.info(`[budget] identity prompt: ${cbeIdentityPrompt.length} / ${IDENTITY_PROMPT_BUDGET} chars`);
  });
});

describe("identity prompt — identity", () => {
  // Requirement: CBE-Specific System-Prompt Identity (Default Override).
  it("opens as the CBE Toolbox and carries no pi default coding-agent language", () => {
    expect(cbeIdentityPrompt.startsWith("You are the CBE Toolbox")).toBe(true);
    expect(cbeIdentityPrompt).not.toMatch(/software engineering|repository|codebase/i);
  });

  it("states that filesystem paths are not identity signals", () => {
    // The cwd line pi appends can contain "pi-agent"; without this the model infers
    // "I am pi" from the path alone.
    expect(cbeIdentityPrompt).toMatch(/paths are not identity signals/i);
    expect(cbeIdentityPrompt).toMatch(/NOT "pi"/);
  });

  it("does not mention the harness unless asked", () => {
    expect(cbeIdentityPrompt).toMatch(/unless the lecturer explicitly asks about your runtime stack/i);
  });
});

describe("identity prompt — the language rule is stated exactly once", () => {
  // Requirement: CBE-Specific System-Prompt Identity, Scenario: *The language rule is
  // stated once, with the no-signal branch*. The surface previously carried THREE
  // answers to one situation: a German default in the prompt, a two-language "hard
  // rule, overrides every default" trailer on the descriptor, and an
  // English-plus-invitation rule in the skill. The loudest was the one placed last.
  it("mirrors the lecturer, discounts machine tokens, and covers the no-signal case", () => {
    expect(cbeIdentityPrompt).toMatch(/language of the lecturer's most recent message/i);
    expect(cbeIdentityPrompt).toMatch(/machine tokens are not language samples/i);
    expect(cbeIdentityPrompt).toMatch(/reply in English and invite a switch in the same turn/i);
    expect(cbeIdentityPrompt).toMatch(/never decides your output language/i);
  });

  it("carries no German default", () => {
    expect(cbeIdentityPrompt).not.toMatch(/[Dd]efault to German/);
  });

  it("is not restated by the environment descriptor", () => {
    // Requirement: Environment Descriptor for the Skill, Scenario: *The descriptor
    // carries no overriding rule text*.
    const block = buildEnvironmentDescriptor({ profile: "app", paths: { corpus: "/c" } }).toSystemPromptBlock();
    expect(block).not.toMatch(/RESPONSE LANGUAGE/i);
    expect(block).not.toMatch(/overrides every default/i);
    expect(block.trimEnd().endsWith("--- END ---")).toBe(true);
  });

  it("is not restated by the skill body", () => {
    expect(skillBody).not.toMatch(/language of the lecturer/i);
    expect(skillBody).not.toMatch(/reply in English/i);
  });
});

describe("identity prompt — the form-of-address rule", () => {
  // Requirement: CBE-Specific System-Prompt Identity (Default Override), the
  // *Form of address* bullet added by change `address-the-lecturer-as-they-ask`.
  //
  // Three of that requirement's new scenarios are MODEL BEHAVIOUR and are measured by
  // the eval, not here (see tasks.md 6.6): *A recorded form of address is used as
  // recorded*, *Nothing recorded means today's behaviour, not a question*, and *The
  // assistant never sources the values itself*. What IS statically checkable is the
  // scenario below plus the two proxies: the bullet exists, and it carries the no-ask
  // branch. A rule the prompt does not contain cannot be obeyed by any model.
  const bullet = (() => {
    const i = cbeIdentityPrompt.indexOf("# Form of address");
    expect(i).toBeGreaterThan(-1);
    const rest = cbeIdentityPrompt.slice(i);
    const next = rest.indexOf("\n# ", 1);
    return next === -1 ? rest : rest.slice(0, next);
  })();

  it("carries the bullet, immediately after the language rule", () => {
    // Response REGISTER is the language rule's immediate neighbour — that adjacency is
    // the channel argument made visible in the text (design.md § The identity prompt,
    // not the skill body).
    expect(cbeIdentityPrompt.indexOf("# Language")).toBeLessThan(cbeIdentityPrompt.indexOf("# Form of address"));
    expect(cbeIdentityPrompt.indexOf("# Form of address")).toBeLessThan(cbeIdentityPrompt.indexOf("# Conduct floor"));
    // Use what is recorded, in the recorded words.
    expect(bullet).toMatch(/records a name or form of address/i);
    expect(bullet).toMatch(/use it verbatim/i);
    expect(bullet).toMatch(/never translated or corrected/i);
    // The language of the reply stays the language rule's business alone.
    expect(bullet).toMatch(/the rule above still decides the language/i);
  });

  it("carries the no-ask branch and the never-infer / never-revise / never-record half", () => {
    // Nothing recorded means today's behaviour, and no question — the single most
    // important half, because it is what keeps the feature invisible to a lecturer
    // who never filled the fields in.
    expect(bullet).toMatch(/where it records nothing/i);
    expect(bullet).toMatch(/never ask/i);
    expect(bullet).toMatch(/never infer, revise or record/i);
    // Identity data the lecturer states, not an estimate the assistant forms.
    expect(bullet).toMatch(/not your estimate/i);
  });

  // Scenario: *The form-of-address rule is stated once*
  it("is stated in exactly one channel — the prompt, not the skill body, not a tool", async () => {
    /** Markers that would indicate a SECOND statement of the rule in another channel. */
    const RULE_MARKERS = [/form of address/i, /address the lecturer by name/i, /lecturer-identity/i];

    // The prompt states it — once. `# Form of address` is the only section heading
    // about it, and the phrase does not recur in a second passage.
    const headingCount = [...cbeIdentityPrompt.matchAll(/^# Form of address$/gm)].length;
    expect(headingCount).toBe(1);

    // The skill body states nothing about it. It is not didactic conduct: it changes
    // no CBE substance, and it reads a host surface the body is deliberately blind to.
    for (const marker of RULE_MARKERS) expect(skillBody).not.toMatch(marker);
    expect(skillBody).not.toMatch(/how (the lecturer|they) (wish|want)e?s? to be addressed/i);

    // No registered tool description states it either — and none should: no tool
    // writes this record, which is what the read-only obligation requires.
    const { pickerTool } = await import("../src/picker-tool.js");
    const { canvasTool } = await import("../src/canvas-tool.js");
    const { stepTool } = await import("../src/step-tool.js");
    const { maturityTool } = await import("../src/maturity-tool.js");
    const { profileTool } = await import("../src/profile-tool.js");
    const { createCiteTool } = await import("../src/cite-tool.js");
    const registered = [pickerTool, canvasTool, stepTool, maturityTool, profileTool, createCiteTool(null)];
    const toolProse = registered.map((t) => `${t.description ?? ""}\n${JSON.stringify(t.parameters ?? {})}`).join("\n");
    for (const marker of RULE_MARKERS) expect(toolProse).not.toMatch(marker);
    // `cbe_profile` in particular gained nothing: its schema still admits exactly the
    // five dimensions, so there is no path by which a tool writes the identity record.
    const { PROFILE_DIMENSIONS } = await import("../src/lecturer-profile.js");
    const admitted = JSON.stringify(profileTool.parameters);
    for (const dimension of PROFILE_DIMENSIONS) expect(admitted).toContain(dimension);
    for (const field of ["formOfAddress", "form of address", "lecturerName"]) {
      expect(admitted).not.toContain(field);
    }
  });
});

describe("identity prompt — the conduct floor carries only what the skill does not", () => {
  // Requirement: Runtime-Stable Operating Guardrails in the Identity Prompt.
  const floor = (() => {
    const i = cbeIdentityPrompt.indexOf("# Conduct floor");
    const rest = cbeIdentityPrompt.slice(i);
    const next = rest.indexOf("\n# ", 1);
    return next === -1 ? rest : rest.slice(0, next);
  })();

  it("carries the four runtime-surface rules", () => {
    expect(floor).toMatch(/Material arriving without an instruction/i);
    expect(floor).toMatch(/recognisable what is being worked on/i);
    expect(floor).toMatch(/student personal data/i);
    expect(floor).toMatch(/Off-topic requests: decline/i);
    expect(floor).toMatch(
      /never a control, feature or capability the environment has not reported|Never offer a control/i
    );
  });

  // Scenario: *The artefact boundary is not duplicated in the identity prompt* (change
  // `recalibrate-tutor-support`, product decision 2026-10-13). The prompt-side refusal is
  // REMOVED, not reinterpreted: the skill alone owns who decides and the consent gate, so the
  // prompt carries neither a refusal of a requested artefact nor a permission to produce one.
  it("carries neither a finished-artefact refusal nor a formulation permission", () => {
    const prompt = cbeIdentityPrompt;
    expect(prompt).not.toMatch(/No finished artefact/i);
    expect(prompt).not.toMatch(/Decline with the reason/i);
    expect(prompt).not.toMatch(/explicitly asks for one/i);
    expect(prompt).not.toMatch(/you do not build it for them/i);
    // …and no permission took its place, in either the floor or anywhere else.
    expect(prompt).not.toMatch(
      /\b(formulate|draft|write)\b[^.]{0,60}\b(outcome|rubric|challenge|task brief|schedule)/i
    );
    expect(prompt).not.toMatch(/\bconsent\b/i);
    expect(prompt).not.toMatch(/unasked|unprompted/i);
  });

  it("carries no quotable refusal sentence and no self-reference as a skill", () => {
    // Scenario: *Refusals carry no quotable string*.
    expect(floor).toMatch(/Compose both replies in the lecturer's language/i);
    expect(floor).toMatch(/never call yourself a "skill"/i);
    expect(floor).not.toMatch(/"[A-Z][^"]{40,}"/); // no long quoted sentence to emit
  });

  it("does not restate the citation discipline, anti-sycophancy, the checks or the backbone", () => {
    // Scenario: *The floor carries only what the skill does not*.
    expect(floor).not.toMatch(/cite/i);
    expect(floor).not.toMatch(/sycophan|flatter|mirror praise/i);
    expect(floor).not.toMatch(/Kompetenz|alignment check|competency check/i);
    expect(floor).not.toMatch(/ten[- ]step|step 1|backbone/i);
    expect(floor).not.toMatch(/mirror of the/i);
  });
});

describe("identity prompt — the corpus half of the opening protocol, without a skill read", () => {
  // Requirement: Mandatory Corpus-Grounding Opening Protocol in the Identity Prompt.
  it("requires the corpus index read at the descriptor's absolute path", () => {
    expect(cbeIdentityPrompt).toMatch(/<paths\.corpus>\/index\.json/);
    expect(cbeIdentityPrompt).toMatch(/never a bare `corpus\/index\.json`/);
  });

  it("requires read-before-claim and calls an unread citation a fabrication", () => {
    expect(cbeIdentityPrompt).toMatch(/before any authoritative CBE claim or any `\(corpus:…\)` citation/i);
    expect(cbeIdentityPrompt).toMatch(/an unread citation is a fabrication/i);
    expect(cbeIdentityPrompt).toMatch(/not a substitute for reading the source/i);
  });

  it("contains NO instruction to read the skill body", () => {
    // Task 1.4 / Scenario: *The protocol requires the corpus read and not a skill
    // read*. Under the lazy load this instruction delivered 62.3 % of the body.
    expect(cbeIdentityPrompt).not.toMatch(/read.{0,40}(the )?`?cbe`? skill/i);
    expect(cbeIdentityPrompt).not.toMatch(/SKILL\.md/);
    expect(cbeIdentityPrompt).not.toMatch(/available_skills/);
    expect(cbeIdentityPrompt).not.toMatch(/<location>/);
  });

  it("binds read-once to the content still being in context and licenses a re-read after compaction", () => {
    // Scenario: *A compaction notice licenses a re-read*. The retired sentence
    // ("repeating a successful read never changes the result") threw the body away.
    expect(cbeIdentityPrompt).toMatch(/while its content is still in your context/i);
    expect(cbeIdentityPrompt).toMatch(/retained-state notice reports that the conversation was compacted/i);
    expect(cbeIdentityPrompt).not.toMatch(/never changes the result/i);
  });

  // change restore-citation-production-step, Scenario: *The prompt states how a
  // citation is produced*. A precondition on citing is not a procedure for citing:
  // under citing pressure the model hand-wrote 3 and 8 malformed `(corpus:…)` tokens
  // with zero `cbe_cite` calls behind them, while the tool description's
  // NEVER HAND-WRITE prohibition was in every request. Nothing said where the token
  // comes from.
  it("carries the ordered production sequence", () => {
    // change sharpen-citing-sequence: the entry condition is the observable moment a
    // `(corpus:…)` token is about to appear.
    expect(cbeIdentityPrompt).toMatch(/The trigger is a `\(corpus:…\)` token about to appear in your answer/i);
    // Order: index read, then document read, then the token.
    const seq = cbeIdentityPrompt.indexOf("The trigger is a `(corpus:…)` token");
    expect(seq).toBeGreaterThan(-1);
    const tail = cbeIdentityPrompt.slice(seq);
    // change route-the-citation-trigger-through-the-tool, Scenario: *The citation
    // sequence ends in the tool call*. The last step used to be "emit the token" —
    // the model writing it itself — which is the wording this change retires.
    expect(tail.indexOf("index")).toBeLessThan(tail.indexOf("document"));
    expect(tail.indexOf("document")).toBeLessThan(tail.indexOf("call `cbe_cite`"));
    expect(cbeIdentityPrompt).not.toMatch(/→ emit the token/);
  });

  // change route-the-citation-trigger-through-the-tool, Scenario: *The citation
  // sequence ends in the tool call* (product decision 2026-08-18, superseding the
  // ruling of 2026-08-10 that this assertion's predecessor pinned). The product authority
  // reproduced the failure by hand: no citation until asked, then a citation whose
  // link was dead, then a working one only after he reported the dead link. The
  // retired licence is asserted ABSENT, not merely unmentioned — a permission to
  // write the token is exactly what the model reached for under pressure.
  it("routes the token through the tool and licenses no self-written one", () => {
    expect(cbeIdentityPrompt).toMatch(/call `cbe_cite` for the token, never write one yourself/i);
    expect(cbeIdentityPrompt).not.toMatch(/You may write that form yourself/i);
    expect(cbeIdentityPrompt).not.toMatch(/where you want it checked first/i);
  });

  // change route-the-citation-trigger-through-the-tool, Scenario: *The grounding
  // condition survives the route change*. The route is stated IN ADDITION to what
  // grounds a token, never in place of it: an unread `cbe_cite` call is still an
  // ungrounded citation, and the read obligation is pinned in its own test above.
  it("still states what grounds a token, alongside the route", () => {
    expect(cbeIdentityPrompt).toMatch(/What grounds it is that read plus the canonical form/i);
    expect(cbeIdentityPrompt).toMatch(/`\(corpus:<id> § <section>, <author year>\)`/);
  });

  // change route-the-citation-trigger-through-the-tool, Requirement: *Instruction
  // Channel Boundary*, Scenario: *The citation sequencing rule lives in the identity
  // prompt*. The carve-out is narrow: the prompt carries the TRIGGER and the ORDER,
  // `cbe_cite`'s own prose carries what the call buys and does not restate the
  // sequence, and the skill body names the tool nowhere at all.
  it("keeps the sequencing carve-out narrow across the three channels", () => {
    const citeProse = citeToolProse();
    // The prompt owns the sequence.
    expect(cbeIdentityPrompt).toMatch(/The trigger is a `\(corpus:…\)` token about to appear in your answer/i);
    // The tool description does not restate it.
    expect(citeProse).not.toMatch(/The trigger is/i);
    expect(citeProse).not.toMatch(/read` the index/i);
    // The prompt does not restate what the call buys — that stays in the tool.
    expect(cbeIdentityPrompt).not.toMatch(/real headings/i);
    expect(cbeIdentityPrompt).not.toMatch(/A REFUSAL IS AN INSTRUCTION/i);
    // The skill body names no tool at all (guarded in full by skill-body-contract).
    expect(skillBody).not.toMatch(/cbe_cite/);
  });

  // Scenario: *The section is required of every token*. This is the rule the failing
  // checkpoints actually measured: `cite_all` never inspects a tool call, and
  // `(corpus:methodology-002)` fails the canonical pattern for want of ` § `.
  it("requires the section and says why the lecturer needs it", () => {
    expect(cbeIdentityPrompt).toMatch(/the section is not optional/i);
    expect(cbeIdentityPrompt).toMatch(/where in the document your claim comes from/i);
  });

  // change sharpen-citing-sequence, Scenario: *The prompt does not name the skipped
  // `read` as the citation failure*. The old wording is forbidden, not merely absent:
  // in run-2026-08-07T12-56-34-282Z (`gemma4-31b`, S6) the model made 8 corpus `read`
  // calls and zero `cbe_cite` calls, so naming the skipped `read` named the one step it
  // had already performed correctly.
  it("does not name the skipped read as the citation failure", () => {
    expect(cbeIdentityPrompt).not.toMatch(/skipping the `read` is the failure to avoid/i);
  });

  // Scenario: *A grep does not ground a document*. Product decision: the eval
  // checker counting only `read` is the intended rule, so a channel has to state it.
  // A counter-probe produced a well-formed, tool-produced, correct citation that
  // failed provenance solely because the passage was reached with `grep`.
  it("states that grep / find / ls do not satisfy read-before-cite", () => {
    expect(cbeIdentityPrompt).toMatch(/only `read` grounds a document/i);
    expect(cbeIdentityPrompt).toMatch(/`grep`, `find` or `ls` does not/i);
  });

  it("does not restate the backbone or the opening sequence", () => {
    // Scenario: *The prompt does not restate the backbone*.
    expect(cbeIdentityPrompt).not.toMatch(/ambition question/i);
    expect(cbeIdentityPrompt).not.toMatch(/visible backbone/i);
    expect(cbeIdentityPrompt).not.toMatch(/Set the frame/);
  });
});

describe("identity prompt — the depth offer is bound to something to deepen", () => {
  // change `bound-the-depth-offer-to-something-to-deepen`, Requirement: Concise-Iterative
  // Response Shape (Default), and Requirement: CBE-Specific System-Prompt Identity
  // (Default Override), § Response shape.
  //
  // The prompt carried `Core answer first, then one or two concrete depth offers.` from
  // 2026-05-29. Unconditional, it obliges an offer on every turn — and once
  // `settle-only-on-a-lecturer-decision` removed the licence for the assistant's own
  // content proposals, the same mandate filled the slot with a PROCESS offer instead
  // (the v0.1.9 hand test: "Zusatzangebot: … ein fertiges Produkt … oder einen
  // Prozess-Nachweis …" appended to a turn that had settled). The obligation is the
  // defect, so the rule is bound to a condition rather than tightened further.
  const shape = (() => {
    const i = cbeIdentityPrompt.indexOf("# Response shape");
    const rest = cbeIdentityPrompt.slice(i);
    const next = rest.indexOf("\n# ", 1);
    return next === -1 ? rest : rest.slice(0, next);
  })();

  // Scenario: *Identity prompt declares a bounded concise-iterative default*.
  it("declares the core answer first and binds the offer to something left to deepen", () => {
    expect(shape).toMatch(/Core answer first/);
    expect(shape).toMatch(/only where something is left to deepen/);
  });

  // Same scenario, the half that must NOT reappear: a fixed numeric cap. The rule is
  // qualitative — length is earned by substance.
  it("imposes no fixed word, sentence or token limit", () => {
    expect(shape).toMatch(/No length limit/);
    expect(shape).not.toMatch(/\b\d+\s*(?:-|\s)?\s*(words?|sentences?|tokens?|characters?)\b/i);
  });

  // Scenario: *The bound is a condition, not a prohibition on offering*. The failure mode
  // is the reflex, not the offer — where the answer does leave something open, one or two
  // concrete offers are still wanted, and nothing here may read as "stop offering".
  it("still calls for one or two concrete depth offers where the condition holds", () => {
    expect(shape).toMatch(/one or two concrete depth offers/);
    expect(shape).not.toMatch(/never offer|do not offer|no depth offers?|refrain from offer/i);
  });

  // Scenario: *Brevity is subordinated to the didactic non-negotiables*. The re-cut that
  // pays for the bound must not have spent this sentence: all three protected things are
  // still named, and brevity is still what may not override them.
  it("keeps a disagreement, a required source and an objection safe from brevity", () => {
    expect(shape).toMatch(/Never cut a disagreement, a required source or an objection for brevity/);
  });

  // Scenario: *Rule lives in the always-present identity prompt, not the on-demand skill*.
  // Response shape is the identity prompt's channel (Requirement: Instruction Channel
  // Boundary); the skill body must not restate the bound.
  it("is stated in the identity prompt and not restated by the skill body", () => {
    expect(cbeIdentityPrompt).toMatch(/only where something is left to deepen/);
    expect(skillBody).not.toMatch(/depth offers?/i);
    expect(skillBody).not.toMatch(/left to deepen/i);
  });

  // The bound touches the FIRST paragraph only. The no-wordless-turn clause and its
  // `cbe_picker` carve-out are a different rule with their own scenarios, asserted in the
  // sibling describe below — this guards them against a re-cut that reaches too far.
  it("leaves the no-wordless-turn clause and its picker exemption standing", () => {
    expect(shape).toMatch(/A turn is never tool calls alone/);
    expect(shape).toMatch(/that question is the turn's word and no prose is owed beside it/);
  });
});

describe("identity prompt — a turn never consists of tool calls alone", () => {
  // change `end-every-tool-turn-with-a-word`, Requirement: Concise-Iterative Response
  // Shape (Default). The repo carried only the opposite obligation — capability
  // `cbe-skill`, Requirement *Announcing Is Not Doing* forbids a claim without the
  // work; nothing forbade the work without a word. A lecturer facing a bare row of
  // tool cards cannot tell what was recorded, why, or whether anything is still
  // running. This is response SHAPE, so it lives here and in no other channel.
  const shape = (() => {
    const i = cbeIdentityPrompt.indexOf("# Response shape");
    const rest = cbeIdentityPrompt.slice(i);
    const next = rest.indexOf("\n# ", 1);
    return next === -1 ? rest : rest.slice(0, next);
  })();

  // Scenario: *The identity prompt forbids a turn made of tool calls alone*.
  it("states that a turn whose substance is tool work still carries prose", () => {
    expect(shape).toMatch(/A turn is never tool calls alone/i);
    expect(shape).toMatch(/the same turn carries one or two sentences/i);
    expect(shape).toMatch(/what you settled and why it was worth recording/i);
  });

  // Same scenario, the LENGTH bound: one or two sentences, never a per-call narration,
  // and no restatement of what the card already shows.
  it("bounds the prose against a narration of the calls", () => {
    expect(shape).toMatch(/one or two sentences/i);
    expect(shape).toMatch(/[Nn]ot a log of the calls/);
    expect(shape).toMatch(/not a repeat of what the card now shows/i);
  });

  // Same scenario, the VOCABULARY bound: the substance in the lecturer's terms, never
  // the mechanism — § Register's prohibition on internal vocabulary is unchanged.
  it("requires the substance to be named rather than the tool", () => {
    expect(shape).toMatch(/in the lecturer's own terms/i);
    expect(shape).toMatch(/name the substance, never the mechanism/i);
  });

  // Scenario: *The clause exempts a turn that ends on a deferred-answer question*.
  // `cbe_picker` terminates the batch by design (Requirement: *The Agent Run Ends on a
  // Deferred-Answer Tool Call*); the rendered question IS the turn's word.
  it("exempts a turn that ends on the deferred-answer question", () => {
    expect(shape).toMatch(/One exception/);
    expect(shape).toMatch(/cbe_picker/);
    expect(shape).toMatch(/that question is the turn's word and no prose is owed beside it/i);
  });

  // The clause is response shape, not didactic conduct: it must hold for every tool the
  // harness ever registers, so it stays out of the skill body (which additionally may
  // not name `cbe_picker` at all — `skill-body-contract.test.ts`).
  it("is not restated by the skill body", () => {
    expect(skillBody).not.toMatch(/tool calls alone/i);
    expect(skillBody).not.toMatch(/no prose is owed/i);
  });
});

describe("identity prompt — the tool statement matches the registered set", () => {
  // Requirement: Tool Allowlist Excluding Shell Execution, Scenario: *The prompt's
  // no-shell statement is true*. The invariant is platform-independent: the prompt
  // must not deny a registered capability nor claim an absent one.
  it("names exactly the registered file tools", () => {
    for (const t of ["read", "write", "edit", "grep", "find", "ls"]) {
      expect(cbeIdentityPrompt).toContain(`\`${t}\``);
      expect(CBE_TOOL_ALLOWLIST as readonly string[]).toContain(t);
    }
  });

  it("states there is no shell, and that is true of the registered set on every platform", () => {
    expect(cbeIdentityPrompt).toMatch(/There is no shell and no command execution/i);
    expect(CBE_TOOL_ALLOWLIST as readonly string[]).not.toContain("bash");
    // Unconditional now: the previous wording had to be hedged because the tool set
    // branched on the platform, which made the sentence false where bash was present.
    // Scoped to the Tools section — "unless" is legitimate elsewhere in the prompt.
    const tools = (() => {
      const i = cbeIdentityPrompt.indexOf("# Tools");
      const rest = cbeIdentityPrompt.slice(i);
      const next = rest.indexOf("\n# ", 1);
      return next === -1 ? rest : rest.slice(0, next);
    })();
    expect(tools).not.toMatch(/on this platform|where available|when a sandbox|unless/i);
  });

  it("carries no descriptor flag that the descriptor no longer emits", () => {
    const emitted = Object.keys(buildEnvironmentDescriptor({ profile: "app" }).affordances);
    for (const gone of ["bash", "citations", "corpusAccess"]) {
      expect(emitted).not.toContain(gone);
      expect(cbeIdentityPrompt).not.toContain(gone);
    }
  });

  it("gives at most a purpose line per registered tool and no operating rules", () => {
    // Scenario: *The prompt does not duplicate tool rules*.
    expect(cbeIdentityPrompt).toMatch(/describe themselves; where one fits, use it instead of prose/i);
    expect(cbeIdentityPrompt).not.toMatch(/fire-and-forget/i);
    expect(cbeIdentityPrompt).not.toMatch(/multiSelect|otherLabel|affordance is present/);
  });
});

describe("identity prompt — the wiki trigger is one sentence and nothing more", () => {
  // change `give-the-wiki-a-reading-route`, Requirement: *cbe_wiki Wiki-Retrieval Tool
  // with a Forced Index-First Route*, Scenario: *The tool is named in exactly one
  // instruction channel*.
  //
  // Before this change the wiki reached the model as ONE descriptor path line and one
  // ranking sentence in the skill body; nothing said an index existed, that the atoms
  // are the unit, or when to read them — and an agent asked about the lecturer's own
  // material read the imported extraction under `raw/` instead. `cbe_wiki` is a
  // GENERAL tool, so the prompt carries its trigger beside `cbe_picker` and
  // `cbe_profile`, and everything about how it is operated stays in its own prose.
  const tools = (() => {
    const i = cbeIdentityPrompt.indexOf("# Tools");
    const rest = cbeIdentityPrompt.slice(i);
    const next = rest.indexOf("\n# ", 1);
    return next === -1 ? rest : rest.slice(0, next);
  })();

  it("names the tool once, in the Tools section, as a purpose line", () => {
    expect(tools).toMatch(/Where the lecturer's own material bears on the question, `cbe_wiki` reads their wiki\./);
    expect(cbeIdentityPrompt.match(/cbe_wiki/g)?.length).toBe(1);
    expect(CBE_TOOL_ALLOWLIST as readonly string[]).toContain("cbe_wiki");
  });

  it("carries no operating rule of that tool — the route lives in the tool prose", () => {
    for (const mechanics of [/index[- ]first/i, /atoms are the unit/i, /outrank/i, /raw\//, /inbox\//]) {
      expect(cbeIdentityPrompt, String(mechanics)).not.toMatch(mechanics);
    }
    const prose = wikiToolProse();
    expect(prose).toMatch(/INDEX-FIRST AND CANNOT BE SHORT-CUT/);
    expect(prose).toMatch(/THE ATOMS ARE THE UNIT/);
    expect(prose).toMatch(/THEY OUTRANK THE IMPORTED ORIGINAL/);
  });

  it("is not named in the skill body at all", () => {
    // Guarded in full by `skill-body-contract.test.ts`; asserted here because this
    // change is the one that could have put it there.
    expect(skillBody).not.toMatch(/cbe_wiki/);
  });

  it("paid for itself inside the prompt — the duplicated training clause is gone", () => {
    // design.md D2: the removed clause stated a rule the same paragraph pair states
    // again forty words later, which is the instance the corpus-grounding test pins.
    expect(cbeIdentityPrompt).not.toMatch(/and your training is not a substitute for the source/);
    expect(cbeIdentityPrompt).toMatch(/not a substitute for reading the source/);
    expect(cbeIdentityPrompt).toMatch(/a guess in the shape of an answer/);
  });
});

describe("identity prompt — paths and self-description", () => {
  it("requires descriptor paths verbatim and reduces XML entities to one decode instruction", () => {
    expect(cbeIdentityPrompt).toMatch(/verbatim — never shorten, drop a segment, or assemble one yourself/i);
    expect(cbeIdentityPrompt).toMatch(/decode standard XML entities/i);
    // The worked example and its surrounding treatment governed a case that cannot
    // arise on any target platform and cost roughly a tenth of the old prompt.
    expect(cbeIdentityPrompt).not.toMatch(/example-vendor|Acme/);
    expect(cbeIdentityPrompt).not.toMatch(/fictional/i);
  });

  it("answers self-description as the lecturer's work and hides retrieval internals", () => {
    expect(cbeIdentityPrompt).toMatch(/answered as the lecturer's work, not as a tool list/i);
    expect(cbeIdentityPrompt).toMatch(/never internal document ids, document counts, or the corpus directory/i);
  });
});

describe("no rule is stated in two channels", () => {
  // Requirement: Instruction Channel Boundary, Scenario: *No rule is stated in two
  // channels*. Duplication is how the current surface acquired its contradictions —
  // a permission in the prompt against a prohibition in the skill, three language
  // fallbacks in three places — and it forces the model to arbitrate between two
  // authorities that both claim precedence.
  //
  // The lists are deliberately FIXED marker phrases, updated by hand when a rule
  // legitimately moves. A generic similarity check would drift into noise.
  const SKILL_MARKERS = [
    "weakness comes first",
    "What you have not read, you do not cite",
    "Never mirror praise",
    "visible backbone",
    "Coherence gate after step 3",
    "at least three student perspectives",
    // Replaced 2026-08-08: "Once per course, not per session" left the body when the
    // maturity reading became a running one (product decision — it must be current at
    // the closing, the way the lecturer-state estimates are).
    "runs with the work",
    "recorded dimensions",
    "one compact turn",
  ];
  const PROMPT_MARKERS = [
    "Material arriving without an instruction",
    "recognisable what is being worked on",
    "never call yourself",
    "There is no shell and no command execution",
    "decode standard XML entities",
    "invite a switch in the same turn",
    "an unread citation is a fabrication",
  ];

  it("no skill-body marker appears in the identity prompt", () => {
    for (const m of SKILL_MARKERS) {
      expect(skillBody.includes(m), `SKILL marker fixture is stale: "${m}"`).toBe(true);
      expect(cbeIdentityPrompt.includes(m), `identity prompt duplicates skill text: "${m}"`).toBe(false);
    }
  });

  it("no identity-prompt floor marker appears in the skill body", () => {
    for (const m of PROMPT_MARKERS) {
      expect(cbeIdentityPrompt.includes(m), `prompt marker fixture is stale: "${m}"`).toBe(true);
      expect(skillBody.includes(m), `skill body duplicates prompt text: "${m}"`).toBe(false);
    }
  });
});
