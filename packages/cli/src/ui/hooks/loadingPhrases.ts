/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ThoughtSummary } from '@apex-code/apex-core';

export const LOADING_PHRASE_ROTATION_MS = 9000;

export const APEX_LOADING_PHRASE_CATEGORIES = [
  'evidence',
  'tracing',
  'system',
  'crossWire',
  'tools',
  'verification',
  'patch',
  'calm',
] as const;

export type ApexLoadingPhraseCategory =
  (typeof APEX_LOADING_PHRASE_CATEGORIES)[number];

export const REASONING_PREFIX_TO_CATEGORY: Array<[
  string,
  ApexLoadingPhraseCategory,
]> = [
  ['search', 'evidence'],
  ['read', 'evidence'],
  ['inspect', 'evidence'],
  ['analy', 'tracing'],
  ['trace', 'tracing'],
  ['map', 'tracing'],
  ['investig', 'evidence'],
  ['reason', 'crossWire'],
  ['plan', 'patch'],
  ['design', 'patch'],
  ['write', 'patch'],
  ['edit', 'patch'],
  ['fix', 'patch'],
  ['patch', 'patch'],
  ['verify', 'verification'],
  ['test', 'verification'],
  ['build', 'verification'],
  ['check', 'verification'],
  ['tool', 'tools'],
  ['call', 'tools'],
  ['execute', 'tools'],
  ['system', 'system'],
  ['daemon', 'system'],
  ['service', 'system'],
  ['runtime', 'system'],
  ['wire', 'crossWire'],
  ['protocol', 'crossWire'],
  ['convert', 'crossWire'],
  ['translate', 'crossWire'],
];

const sanitizePhrase = (phrase: string): string => phrase.trim();
const makePhrases = (...phrases: string[]): string[] =>
  phrases.map(sanitizePhrase);

export const APEX_LOADING_PHRASES_BY_CATEGORY: Record<
  ApexLoadingPhraseCategory,
  string[]
> = {
  evidence: makePhrases(
    'Gathering evidence from the source...',
    'Grounding the answer in verified code paths...',
    'Cross-checking each claim against the workspace...',
    'Building an evidence-backed response...',
    'Verifying the signal before the summary...',
    'Separating facts from assumptions...',
    'Reading the code before making the call...',
    'Locking the answer to real artifacts...',
    'Pulling the strongest evidence into view...',
    'Following the proof, not the vibes...',
    'Checking the source before committing to a theory...',
    'Correlating the evidence across files and flow...',
    'Reducing guesswork to zero...',
    'Ground truth first, wording second...',
    'Validating the narrative against the implementation...',
    'Preparing a source-backed answer...',
  ),
  tracing: makePhrases(
    'Tracing the call path end to end...',
    'Following the execution path through the code...',
    'Mapping the control flow before answering...',
    'Walking the dependency chain carefully...',
    'Resolving the path from entry point to effect...',
    'Tracking the signal through the stack...',
    'Unwinding the logic one step at a time...',
    'Charting the path through the implementation...',
    'Locating the exact handoff points...',
    'Threading the reasoning through the code path...',
    'Pinning down where the behavior actually branches...',
    'Connecting the trigger to the consequence...',
    'Reading the system through its call graph...',
    'Tightening the trace until it holds...',
    'Building a precise map of the behavior...',
    'Following the chain without losing context...',
  ),
  system: makePhrases(
    'Tracing system-specific behavior...',
    'Following the management path through the stack...',
    'Checking the control plane assumptions...',
    'Reading the code the way the system wants to be read...',
    'Aligning the answer with system conventions...',
    'Tracking flow across the right layers...',
    'Verifying the behavior against the source...',
    'Walking the path from interface to implementation...',
    'Checking how this lands in the runtime stack...',
    'Grounding the result in system-level evidence...',
    'Following the story from trigger to state...',
    'Reading the system through an systems lens...',
    'Locking onto the execution path...',
    'Checking invariants before concluding...',
    'Preparing an system-aware response...',
    'Resolving the implementation details...',
  ),
  crossWire: makePhrases(
    'Reconciling wire-level differences...',
    'Preserving intent across provider boundaries...',
    'Aligning the harness with the wire...',
    'Normalizing behavior across protocols...',
    'Keeping the semantics intact across backends...',
    'Bridging the model and the wire cleanly...',
    'Holding the response steady across protocols...',
    'Reading past the transport to the meaning...',
    'Reconciling provider semantics before responding...',
    'Keeping the output coherent across wires...',
    'Translating behavior without losing precision...',
    'Maintaining a clean line from protocol to answer...',
    'Closing the gap between model and harness...',
    'Carrying meaning cleanly across the stack...',
    'Stabilizing the response across the wire layer...',
    'Preparing a protocol-aware answer...',
  ),
  tools: makePhrases(
    'Orchestrating the right tools for the job...',
    'Sequencing the next tool pass...',
    'Preparing the next evidence-gathering step...',
    'Choosing the shortest path to signal...',
    'Driving the tools with intent...',
    'Turning tool output into usable evidence...',
    'Coordinating the toolchain without drift...',
    'Keeping the investigation tool-driven and grounded...',
    'Setting up the next high-value read...',
    'Letting the tools do the talking...',
    'Pulling signal from the right instrumentation...',
    'Reading the workspace through the right interfaces...',
    'Lining up the next precise tool call...',
    'Reducing friction between question and evidence...',
    'Converting tool output into confident progress...',
    'Advancing with the sharpest next move...',
  ),
  verification: makePhrases(
    'Verifying assumptions before landing the answer...',
    'Checking the final shape against the evidence...',
    'Running a last pass for consistency...',
    'Testing the reasoning against the implementation...',
    'Closing gaps before they become errors...',
    'Pressure-testing the answer for drift...',
    'Making sure the result survives scrutiny...',
    'Checking edge conditions before finalizing...',
    'Confirming the conclusion holds under inspection...',
    'Verifying the answer before it ships...',
    'Tightening the conclusion until it is clean...',
    'Reviewing the result with a cold eye...',
    'Checking for missing edges and loose ends...',
    'Validating the response under real constraints...',
    'Finishing with verification, not wishful thinking...',
    'Preparing a resilient final answer...',
  ),
  patch: makePhrases(
    'Preparing a clean patch path...',
    'Designing the smallest correct change...',
    'Tightening the fix before touching the file...',
    'Turning analysis into an actionable patch...',
    'Planning the change with the blast radius in view...',
    'Lining up the implementation details...',
    'Preparing a patch that reads like it belongs...',
    'Shaping the fix around real constraints...',
    'Keeping the change precise and local...',
    'Converting signal into a concrete edit...',
    'Drafting the path from problem to patch...',
    'Making the next change count...',
    'Preparing an implementation that stays grounded...',
    'Keeping the patch disciplined and deliberate...',
    'Designing for correctness first...',
    'Building the fix with verification in mind...',
  ),
  calm: makePhrases(
    'Holding the line while the details settle...',
    'Keeping the response calm, sharp, and grounded...',
    'Bringing the signal into focus...',
    'Letting the complexity compress into clarity...',
    'Settling the answer into its final shape...',
    'Turning moving parts into a controlled result...',
    'Keeping the system steady under load...',
    'Bringing order to the stack...',
    'Staying precise while the pieces align...',
    'Maintaining control through the noisy parts...',
    'Reducing chaos to a clean path forward...',
    'Holding context while the answer firms up...',
    'Letting the right pattern emerge...',
    'Keeping momentum without losing accuracy...',
    'Preparing a calm, exact response...',
    'Controlling the complexity instead of chasing it...',
  ),
};

export const APEX_LOADING_PHRASES: string[] = ([] as string[])
  .concat(APEX_LOADING_PHRASES_BY_CATEGORY.calm)
  .concat(APEX_LOADING_PHRASES_BY_CATEGORY.evidence)
  .concat(APEX_LOADING_PHRASES_BY_CATEGORY.tracing)
  .concat(APEX_LOADING_PHRASES_BY_CATEGORY.system)
  .concat(APEX_LOADING_PHRASES_BY_CATEGORY.crossWire)
  .concat(APEX_LOADING_PHRASES_BY_CATEGORY.tools)
  .concat(APEX_LOADING_PHRASES_BY_CATEGORY.verification)
  .concat(APEX_LOADING_PHRASES_BY_CATEGORY.patch);

export const deriveReasoningCategory = (
  thought: ThoughtSummary | undefined,
): ApexLoadingPhraseCategory | undefined => {
  const candidate = `${thought?.subject ?? ''} ${thought?.description ?? ''}`
    .trim()
    .toLowerCase();
  if (!candidate) {
    return undefined;
  }
  for (const [prefix, category] of REASONING_PREFIX_TO_CATEGORY) {
    if (candidate.includes(prefix)) {
      return category;
    }
  }
  return undefined;
};

export const selectPhraseFromCategory = (
  phrasesByCategory: Record<ApexLoadingPhraseCategory, string[]>,
  category: ApexLoadingPhraseCategory,
  cycleIndex: number,
): string => {
  const bucket = phrasesByCategory[category];
  if (!bucket || bucket.length === 0) {
    return '';
  }
  return bucket[cycleIndex % bucket.length] ?? bucket[0];
};

export const selectHybridLoadingPhrase = ({
  thought,
  translatedPhrases,
  cycleIndex,
}: {
  thought: ThoughtSummary | undefined;
  translatedPhrases: string[];
  cycleIndex: number;
}): string => {
  if (thought?.subject?.trim()) {
    return thought.subject.trim();
  }

  const category = deriveReasoningCategory(thought);
  if (category) {
    return selectPhraseFromCategory(
      APEX_LOADING_PHRASES_BY_CATEGORY,
      category,
      cycleIndex,
    );
  }

  if (translatedPhrases && translatedPhrases.length > 0) {
    return (
      translatedPhrases[cycleIndex % translatedPhrases.length] ??
      translatedPhrases[0]
    );
  }

  const fallbackCategory =
    APEX_LOADING_PHRASE_CATEGORIES[
      cycleIndex % APEX_LOADING_PHRASE_CATEGORIES.length
    ] ?? 'calm';
  return selectPhraseFromCategory(
    APEX_LOADING_PHRASES_BY_CATEGORY,
    fallbackCategory,
    cycleIndex,
  );
};
