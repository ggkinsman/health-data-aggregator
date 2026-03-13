import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  PipelineConfig,
  PipelineResult,
  ReviewVerdict,
  SelfReflection,
  CodeResult,
  TokenUsage,
  AgentRole,
} from './types.js';
import type { DataContext } from './types.js';
import { serializeContext } from './serialize-context.js';
import { extractExecutableBlocks, executeCodeBlock, validateResult } from './code-executor.js';
import { loadMemory, saveMemory, pruneMemory } from './session-memory.js';
import type Database from 'better-sqlite3';

const PROMPTS_DIR = join(import.meta.dirname, '..', '..', 'prompts');
const MAX_CODE_RETRIES = 2;

function loadPrompt(filename: string): string {
  return readFileSync(join(PROMPTS_DIR, filename), 'utf-8');
}

export async function runPipeline(
  db: Database.Database,
  dataContext: DataContext,
  config: PipelineConfig,
  memoryPath: string,
): Promise<PipelineResult> {
  const startTime = Date.now();
  const client = new Anthropic();
  const tokenUsage: TokenUsage = { totalInput: 0, totalOutput: 0, byCaller: {} };
  const modelResearcher = config.modelResearcher ?? 'claude-sonnet-4-6';
  const modelReviewer = config.modelReviewer ?? 'claude-haiku-4-5-20251001';

  // Retry wrapper for API calls (exponential backoff: 1s, 3s)
  async function callWithRetry<T>(
    fn: () => Promise<T>,
    label: string,
    maxRetries = 2,
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const isTransient = err.status === 429 || err.status === 529 || err.status >= 500;
        if (!isTransient || attempt === maxRetries) throw err;
        const delayMs = attempt === 0 ? 1000 : 3000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    throw new Error(`${label}: unreachable`);
  }

  // Load memory and prompts
  const memory = loadMemory(memoryPath);
  const researcherPrompt = loadPrompt('hayden-researcher.md');
  const contextText = serializeContext(dataContext);

  // Build user message
  let userMessage: string;
  if (config.reportType) {
    const templateFile = config.reportType === 'daily'
      ? 'report-templates/daily-briefing.md'
      : 'report-templates/weekly-deep-dive.md';
    const template = loadPrompt(templateFile);
    userMessage = `${template}\n\n---\n\n## Health Data\n\n${contextText}`;
  } else {
    userMessage = `## Question\n\n${config.question}\n\n---\n\n## Health Data\n\n${contextText}`;
  }

  // Add memory context
  if (memory.recentFindings.length > 0 || memory.goals.length > 0) {
    userMessage += `\n\n---\n\n## Session Memory\n\n${JSON.stringify(memory, null, 2)}`;
  }

  // Add continue context
  if (config.continueContext) {
    userMessage += `\n\n---\n\n## Previous Analysis\n\n${config.continueContext}`;
  }

  // Add staleness warning
  if (dataContext.staleness.isStale) {
    userMessage += `\n\n---\n\n**Data may be stale.** Last sync: ${dataContext.staleness.lastSyncAt ?? 'never'}. Some findings may not reflect your most recent data.`;
  }

  // Step 1: Hayden draft
  const draftResponse = await callWithRetry(
    () => client.messages.create({
      model: modelResearcher,
      max_tokens: 4096,
      system: researcherPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    'researcher-draft',
  );
  const draftText = extractText(draftResponse);
  trackUsage(tokenUsage, 'researcher-draft', draftResponse.usage);

  // Step 2: Code execution (if any executable blocks)
  const codeResults: CodeResult[] = [];
  let enrichedDraft = draftText;
  const codeBlocks = extractExecutableBlocks(draftText);

  for (const block of codeBlocks) {
    let result = executeCodeBlock(db, block);
    let retries = 0;

    while (result.error && retries < MAX_CODE_RETRIES) {
      retries++;
      const retryResponse = await client.messages.create({
        model: modelResearcher,
        max_tokens: 2048,
        system: researcherPrompt,
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: draftText },
          { role: 'user', content: `Your query failed with: ${result.error}\n\nPlease fix and resubmit the query.` },
        ],
      });
      const retryText = extractText(retryResponse);
      trackUsage(tokenUsage, `code-retry-${retries}`, retryResponse.usage);

      const retryBlocks = extractExecutableBlocks(retryText);
      if (retryBlocks.length > 0) {
        result = executeCodeBlock(db, retryBlocks[0]);
        result.retryCount = retries;
      } else {
        break;
      }
    }

    if (result.output) {
      result.warnings = validateResult(result);
      result.validated = result.warnings.length === 0;
    }

    codeResults.push(result);
  }

  // Append code results to draft
  if (codeResults.length > 0) {
    enrichedDraft += '\n\n## Code Execution Results\n\n';
    for (const r of codeResults) {
      enrichedDraft += `### Query:\n\`\`\`sql\n${r.code}\n\`\`\`\n`;
      if (r.output) {
        enrichedDraft += `### Result:\n\`\`\`json\n${r.output}\n\`\`\`\n`;
      }
      if (r.error) {
        enrichedDraft += `### Error: ${r.error}\n`;
      }
      if (r.warnings.length > 0) {
        enrichedDraft += `### Warnings: ${r.warnings.join(', ')}\n`;
      }
    }
  }

  // Step 3: Parallel reviews
  const reviewPrompts: { role: AgentRole; file: string }[] = [
    { role: 'statistician', file: 'reviewer-statistician.md' },
    { role: 'sleep', file: 'reviewer-sleep.md' },
    { role: 'biomarker', file: 'reviewer-biomarker.md' },
  ];

  const reviewPromises = reviewPrompts.map(async ({ role, file }) => {
    const systemPrompt = loadPrompt(file);
    const dataSubset = buildReviewerDataSubset(role, contextText);

    try {
      const response = await callWithRetry(
        () => client.messages.create({
          model: modelReviewer,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: `## Draft to Review\n\n${enrichedDraft}\n\n---\n\n## Raw Data\n\n${dataSubset}`,
          }],
        }),
        `reviewer-${role}`,
      );
      trackUsage(tokenUsage, `reviewer-${role}`, response.usage);
      return parseReviewVerdict(role, extractText(response));
    } catch (err: any) {
      return {
        role,
        verdict: 'confirmed' as const,
        notes: `Review unavailable: ${err.message}`,
        suggestedEdit: null,
        raw: '',
      } satisfies ReviewVerdict;
    }
  });

  const reviews = await Promise.all(reviewPromises);

  // Step 4: Hayden revision
  const reviewFeedback = reviews.map(r =>
    `## Review: ${r.role}\n- Verdict: ${r.verdict}\n- Notes: ${r.notes}\n- Suggested edit: ${r.suggestedEdit ?? 'None'}`
  ).join('\n\n');

  const revisionResponse = await callWithRetry(
    () => client.messages.create({
      model: modelResearcher,
      max_tokens: 4096,
      system: researcherPrompt,
      messages: [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: enrichedDraft },
        { role: 'user', content: `## Reviewer Feedback\n\n${reviewFeedback}\n\nPlease revise your analysis incorporating this feedback. Produce the final output for the user.` },
      ],
    }),
    'researcher-revision',
  );
  const revisedText = extractText(revisionResponse);
  trackUsage(tokenUsage, 'researcher-revision', revisionResponse.usage);

  // Step 5: Self-reflection
  const reflectionPrompt = loadPrompt('self-reflection.md');
  const reflectionResponse = await client.messages.create({
    model: modelReviewer,
    max_tokens: 512,
    system: reflectionPrompt,
    messages: [{
      role: 'user',
      content: `## Final Output to Check\n\n${revisedText}\n\n---\n\n## Original Data\n\n${contextText}`,
    }],
  });
  trackUsage(tokenUsage, 'self-reflection', reflectionResponse.usage);

  let selfReflection = parseSelfReflection(extractText(reflectionResponse));
  let finalOutput = revisedText;

  // One revision if reflection flags issues
  if (selfReflection.action === 'revise') {
    const fixResponse = await client.messages.create({
      model: modelResearcher,
      max_tokens: 4096,
      system: researcherPrompt,
      messages: [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: revisedText },
        { role: 'user', content: `## Self-Reflection Issues\n\n${selfReflection.details}\n\nPlease fix these specific issues in your output.` },
      ],
    });
    finalOutput = extractText(fixResponse);
    trackUsage(tokenUsage, 'researcher-reflection-fix', fixResponse.usage);
  }

  // Update session memory
  const today = new Date().toISOString().split('T')[0];
  const updatedMemory = pruneMemory(memory, today);
  updatedMemory.lastUpdated = today;

  try {
    const memoryExtractionResponse = await callWithRetry(
      () => client.messages.create({
        model: modelReviewer,
        max_tokens: 512,
        system: `Extract key findings and open questions from this health analysis. Return JSON only:
{"findings": [{"insight": "...", "followUp": "..."}], "openQuestions": ["..."]}`,
        messages: [{ role: 'user', content: finalOutput }],
      }),
      'memory-extraction',
    );
    trackUsage(tokenUsage, 'memory-extraction', memoryExtractionResponse.usage);

    const extracted = JSON.parse(extractText(memoryExtractionResponse));
    if (Array.isArray(extracted.findings)) {
      for (const f of extracted.findings) {
        updatedMemory.recentFindings.push({
          date: today,
          insight: f.insight,
          status: 'open',
          followUp: f.followUp ?? '',
        });
      }
    }
    if (Array.isArray(extracted.openQuestions)) {
      for (const q of extracted.openQuestions) {
        if (!updatedMemory.openQuestions.includes(q)) {
          updatedMemory.openQuestions.push(q);
        }
      }
    }
  } catch {
    // Memory enrichment failure is non-fatal
  }

  saveMemory(memoryPath, updatedMemory);

  return {
    finalOutput,
    reviews,
    selfReflection,
    codeResults,
    tokenUsage,
    durationMs: Date.now() - startTime,
  };
}

// --- Helper Functions (exported for testing) ---

export function parseReviewVerdict(role: string, text: string): ReviewVerdict {
  // Handle both emoji-prefixed (✅ confirmed) and plain text (confirmed) verdict formats
  const verdictMatch = text.match(/Verdict:\s*(?:✅\s*)?(?:⚠️\s*)?(?:🔄\s*)?(confirmed|flag|revise)/i);
  const notesMatch = text.match(/Notes:\s*(.+)/);
  const editMatch = text.match(/Suggested edit:\s*(.+)/i);

  let verdict: 'confirmed' | 'flag' | 'revise' = 'confirmed';
  if (verdictMatch) {
    const v = verdictMatch[1].toLowerCase();
    if (v.includes('flag')) verdict = 'flag';
    else if (v.includes('revise')) verdict = 'revise';
  }

  const suggestedEdit = editMatch?.[1]?.trim();

  return {
    role: role as AgentRole,
    verdict,
    notes: notesMatch?.[1]?.trim() ?? text,
    suggestedEdit: (suggestedEdit && suggestedEdit.toLowerCase() !== 'none' && suggestedEdit.toLowerCase() !== 'n/a')
      ? suggestedEdit
      : null,
    raw: text,
  };
}

export function buildReviewerDataSubset(role: string, fullContext: string): string {
  if (role === 'statistician') return fullContext;

  const lines = fullContext.split('\n');

  if (role === 'sleep') {
    return lines.filter(line =>
      /^##/.test(line) ||
      /sleep|hrv|rem|deep|eff|temperature|spo2|respiratory|cpap|anomal/i.test(line) ||
      line.trim() === ''
    ).join('\n');
  }

  if (role === 'biomarker') {
    return lines.filter(line =>
      /^##/.test(line) ||
      /hr[:\s=]|heart|resting|activity|steps|cal|workout|readiness|blood|biomarker|anomal/i.test(line) ||
      line.trim() === ''
    ).join('\n');
  }

  return fullContext;
}

function parseSelfReflection(text: string): SelfReflection {
  const consistent = !/Consistent:\s*no/i.test(text);
  const claimDriftMatch = text.match(/Claim drift:\s*(.+)/i);
  const safetyMatch = !/Safety compliant:\s*no/i.test(text);
  const actionMatch = text.match(/Action:\s*(?:✅\s*)?(?:🔄\s*)?(deliver|revise)/i);

  const claimDrift = claimDriftMatch?.[1]?.trim();

  return {
    consistent,
    claimDrift: (claimDrift && claimDrift.toLowerCase() !== 'none') ? claimDrift : null,
    safetyCompliant: safetyMatch,
    action: actionMatch?.[1]?.includes('revise') ? 'revise' : 'deliver',
    details: text,
  };
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('');
}

function trackUsage(
  tracker: TokenUsage,
  caller: string,
  usage: { input_tokens: number; output_tokens: number }
): void {
  tracker.totalInput += usage.input_tokens;
  tracker.totalOutput += usage.output_tokens;
  tracker.byCaller[caller] = {
    input: usage.input_tokens,
    output: usage.output_tokens,
  };
}
