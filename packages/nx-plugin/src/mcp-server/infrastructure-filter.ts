/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Transform <Infrastructure> blocks in guide text so agents receive the
 * relevant IaC provider variant (or both, clearly labelled) without the
 * surrounding Astro/Starlight tabs machinery.
 *
 * <Infrastructure> is authored as:
 *
 *   <Infrastructure>
 *     <Fragment slot="cdk">
 *       ...CDK-specific content...
 *     </Fragment>
 *     <Fragment slot="terraform">
 *       ...Terraform-specific content...
 *     </Fragment>
 *   </Infrastructure>
 *
 * When `iacProvider` is 'CDK' → emit only the CDK slot body.
 * When `iacProvider` is 'Terraform' → emit only the Terraform slot body.
 * When `iacProvider` is absent or 'Inherit' → emit both, each under a
 * `### CDK` / `### Terraform` heading so the variants stay distinguishable.
 */

const OPEN_TAG = '<Infrastructure';
const CLOSE_TAG = '</Infrastructure>';

const FRAGMENT_OPEN_RE = /<Fragment\s+slot=["'](cdk|terraform)["']\s*>/g;
const FRAGMENT_CLOSE = '</Fragment>';

interface Block {
  startIndex: number;
  endIndex: number;
  body: string;
}

const findTagEnd = (text: string, openIdx: number): number => {
  let i = openIdx + 1;
  let depth = 0;
  let quote: string | undefined;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 2;
      else {
        if (ch === quote) quote = undefined;
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      i++;
      continue;
    }
    if (ch === '>' && depth === 0) return i;
    i++;
  }
  return -1;
};

const scan = (text: string): Block[] => {
  const blocks: Block[] = [];
  let i = 0;
  while (i < text.length) {
    const openIdx = text.indexOf(OPEN_TAG, i);
    if (openIdx === -1) break;
    const afterName = text.charAt(openIdx + OPEN_TAG.length);
    if (
      afterName !== ' ' &&
      afterName !== '>' &&
      afterName !== '\n' &&
      afterName !== '\t'
    ) {
      i = openIdx + OPEN_TAG.length;
      continue;
    }
    const openEnd = findTagEnd(text, openIdx);
    if (openEnd === -1) break;
    const closeIdx = text.indexOf(CLOSE_TAG, openEnd + 1);
    if (closeIdx === -1) break;
    blocks.push({
      startIndex: openIdx,
      endIndex: closeIdx + CLOSE_TAG.length,
      body: text.slice(openEnd + 1, closeIdx),
    });
    i = closeIdx + CLOSE_TAG.length;
  }
  return blocks;
};

const extractSlots = (body: string): { cdk: string; terraform: string } => {
  const slots: Record<string, string> = { cdk: '', terraform: '' };
  FRAGMENT_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FRAGMENT_OPEN_RE.exec(body)) !== null) {
    const slotName = match[1];
    const openEnd = match.index + match[0].length;
    const closeIdx = body.indexOf(FRAGMENT_CLOSE, openEnd);
    if (closeIdx === -1) break;
    slots[slotName] = body.slice(openEnd, closeIdx).trim();
  }
  return { cdk: slots.cdk, terraform: slots.terraform };
};

export const applyInfrastructureFilter = (
  text: string,
  iacProvider?: string,
): string => {
  // No filter supplied (or `Inherit` — treat as no opinion): leave the
  // <Infrastructure> block in place so downstream rendering keeps both
  // slots as side-by-side tabs, and we don't inject `### CDK` / `### Terraform`
  // headings that would land at the wrong depth inside nested sections.
  if (!iacProvider || iacProvider === 'Inherit') return text;

  const blocks = scan(text);
  if (blocks.length === 0) return text;

  let result = '';
  let cursor = 0;
  for (const block of blocks) {
    result += text.slice(cursor, block.startIndex);
    const { cdk, terraform } = extractSlots(block.body);
    // With a concrete iacProvider, inline only the relevant slot body —
    // no wrapper, no heading. The surrounding section already carries
    // the right heading level.
    if (iacProvider === 'CDK') result += cdk;
    else if (iacProvider === 'Terraform') result += terraform;
    cursor = block.endIndex;
  }
  result += text.slice(cursor);
  return result;
};
