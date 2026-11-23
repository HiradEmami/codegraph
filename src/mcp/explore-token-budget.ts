/** Convert the existing explore render to a self-contained, measured packet. */
import {
  buildBoundedContextPacket,
  type ContextEvidence,
  type ContextTokenBudget,
  type SourceEvidence,
} from '../context/token-budget';
import type { ExploreEmission, ExploreFileEmission } from './explore-session-state';

export function boundExploreText(
  markdown: string,
  emission: ExploreEmission | undefined,
  budget: ContextTokenBudget,
  requiredNotices: string[] = [],
): { text: string; emission: ExploreEmission | undefined } {
  const files = new Map((emission?.files ?? []).map((f) => [f.path, f]));
  const source: SourceEvidence[] = [];
  const context: ContextEvidence[] = [];
  const notices = [...requiredNotices];
  let file: ExploreFileEmission | undefined;
  let run: SourceEvidence | undefined;
  let paragraph: string[] = [];
  let inFence = false;
  const flushSource = (): void => { if (run) source.push(run); run = undefined; };
  const flushContext = (): void => {
    const text = paragraph.join('\n').trim();
    paragraph = [];
    if (!text) return;
    // Renderer summaries describe the larger, pre-budget result. They must not
    // imply that all of that source survived selection in this packet.
    if (/^Found \d+ symbols? across /m.test(text)
      || /already Read|do NOT Read|do not Read|verbatim, current on-disk|complete source code|source above is complete/i.test(text)
      || text === '**Source Code**') return;
    context.push({ kind: 'context', text });
  };
  for (const line of markdown.split('\n')) {
    // Budgeted renders force numbered source, so a source line cannot spoof a
    // file header or closing fence. Match against the actual emission inventory.
    if (!inFence && line.startsWith('**`')) {
      flushSource(); flushContext();
      file = [...files.values()].find((candidate) => line.startsWith(`**\`${candidate.path}\`**`));
      if (line.includes('⚠')) notices.push(line);
      if (!file) paragraph.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushSource(); flushContext(); inFence = !inFence; continue; }
    const numbered = file && inFence ? /^(\d+)\t([\s\S]*)$/.exec(line) : null;
    if (numbered) {
      const lineNo = Number(numbered[1]);
      if (file!.ranges.some((range) => lineNo >= range.start && lineNo <= range.end)) {
        flushContext();
        if (run && run.path === file!.path && run.endLine + 1 === lineNo) {
          run.endLine = lineNo;
          run.text += `\n${numbered[2]!}`;
        } else {
          flushSource();
          run = {
            kind: 'source', path: file!.path, startLine: lineNo, endLine: lineNo,
            text: numbered[2]!, ...(file!.fingerprint ? { fingerprint: file!.fingerprint } : {}),
          };
        }
        continue;
      }
    }
    flushSource();
    if (line.includes('⚠')) { flushContext(); notices.push(line); continue; }
    // Gaps and elisions are metadata, never source evidence. Keep meaningful
    // pointers but not the bare visual spacer used between source spans.
    if (line === '... (gap) ...') continue;
    if (!line.trim()) flushContext();
    else paragraph.push(line);
  }
  flushSource(); flushContext();
  // Source in existing relevance order first; relationship/context prose follows.
  const bounded = buildBoundedContextPacket({
    evidence: [...source, ...context], notices,
    ...(emission ? { projectRoot: emission.projectRoot, query: emission.query } : {}),
  }, budget);
  if (!emission) return { text: bounded.text, emission: undefined };
  const delivered = new Map<string, ExploreFileEmission>();
  for (const item of bounded.packet.evidence) {
    if (item.kind !== 'source') continue;
    let target = delivered.get(item.path);
    if (!target) {
      target = { path: item.path, ranges: [], bytes: 0, ...(item.fingerprint ? { fingerprint: item.fingerprint } : {}) };
      delivered.set(item.path, target);
    }
    target.ranges.push({ start: item.startLine, end: item.endLine });
    target.bytes += item.text.length;
  }
  return {
    text: bounded.text,
    emission: {
      ...emission, files: [...delivered.values()],
      sourceBytes: [...delivered.values()].reduce((n, f) => n + f.bytes, 0),
      responseBytes: bounded.text.length,
    },
  };
}
