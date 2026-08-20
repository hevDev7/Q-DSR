import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';

import { AGENTIC_ID_ABI, QDSR_REGISTRY_ABI } from '../src/abi.js';

/**
 * The ABIs in this package are written by hand so the API server can start
 * without the contracts package having been compiled. The cost of that choice is
 * that the two can drift — and they did: `mint` gained a metadata struct in
 * Solidity while this client kept encoding a string, which failed only at the
 * moment a user pressed the button.
 *
 * Every fragment declared here must exist in the compiled contract with the same
 * signature. The artifacts are a build output, so a missing one fails loudly with
 * an instruction rather than quietly skipping the check.
 */
const here = dirname(fileURLToPath(import.meta.url));
const artifactDir = resolve(here, '..', '..', '..', 'contracts', 'artifacts', 'contracts');

function compiledInterface(contractName: string): Interface {
  const path = resolve(artifactDir, `${contractName}.sol`, `${contractName}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `No compiled artifact at ${path}. Run: pnpm --filter @workspace/contracts run compile`,
    );
  }
  return new Interface((JSON.parse(raw) as { abi: unknown[] }).abi as never);
}

/**
 * Compares selectors, not names.
 *
 * The obvious implementation — asking the compiled interface for each declared
 * signature — does not work: ethers resolves a function by name when the name is
 * unambiguous, so a `mint` whose arguments had changed still matched. Selectors
 * and topic hashes are derived from the full signature and cannot be fooled that
 * way.
 */
function missingFragments(declaredAbi: readonly string[], compiled: Interface): string[] {
  const declared = new Interface(declaredAbi as unknown as string[]);

  const compiledSelectors = new Set<string>();
  compiled.forEachFunction((f) => compiledSelectors.add(`function ${f.selector}`));
  compiled.forEachError((e) => compiledSelectors.add(`error ${e.selector}`));
  compiled.forEachEvent((e) => compiledSelectors.add(`event ${e.topicHash}`));

  const missing: string[] = [];
  for (const fragment of declared.fragments) {
    let key: string | undefined;
    if (fragment.type === 'function') key = `function ${(fragment as never as { selector: string }).selector}`;
    else if (fragment.type === 'error') key = `error ${(fragment as never as { selector: string }).selector}`;
    else if (fragment.type === 'event') key = `event ${(fragment as never as { topicHash: string }).topicHash}`;
    if (!key) continue;

    if (!compiledSelectors.has(key)) {
      missing.push(`${fragment.type} ${fragment.format('sighash')}`);
    }
  }
  return missing;
}

describe('hand-written ABIs match the compiled contracts', () => {
  it('AGENTIC_ID_ABI', () => {
    expect(missingFragments(AGENTIC_ID_ABI, compiledInterface('AgenticID'))).toEqual([]);
  });

  it('QDSR_REGISTRY_ABI', () => {
    expect(missingFragments(QDSR_REGISTRY_ABI, compiledInterface('QDSRRegistry'))).toEqual([]);
  });

  it('encodes a mint call the deployed contract decodes identically', () => {
    // The exact failure this file exists to catch: a struct argument encoded
    // against a signature that expected a string.
    const declared = new Interface(AGENTIC_ID_ABI as unknown as string[]);
    const data = declared.encodeFunctionData('mint', [
      '0x000000000000000000000000000000000000dEaD',
      `0x${'ab'.repeat(32)}`,
      { name: 'A', description: 'B', image: '', evidenceURI: '0g://storage/x' },
      `0x${'cd'.repeat(32)}`,
    ]);

    const decoded = compiledInterface('AgenticID').decodeFunctionData('mint', data);
    expect(decoded[2].name).toBe('A');
    expect(decoded[2].evidenceURI).toBe('0g://storage/x');
  });

  it('encodes a verdict submission the registry decodes identically', () => {
    const declared = new Interface(QDSR_REGISTRY_ABI as unknown as string[]);
    const args = [
      `0x${'11'.repeat(32)}`,
      `0x${'22'.repeat(32)}`,
      `0x${'33'.repeat(32)}`,
      'qdsr-core/1.0.0',
      9982,
      4,
      60,
      756,
    ];
    const data = declared.encodeFunctionData('submitVerdict', args);
    const decoded = compiledInterface('QDSRRegistry').decodeFunctionData('submitVerdict', data);
    expect(decoded[3]).toBe('qdsr-core/1.0.0');
    expect(Number(decoded[4])).toBe(9982);
  });
});
