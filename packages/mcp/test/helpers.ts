import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineApi, ReturnResult, TaxFacts } from '@1040kit/engine';

import type { Deps } from '../src/deps.ts';

export interface TestEnv {
  home: string;
  config: string;
  cleanup(): Promise<void>;
}

/** Fresh KIT1040_HOME / KIT1040_CONFIG_DIR; never the real ~/Taxes or ~/.1040kit. */
export async function freshEnv(): Promise<TestEnv> {
  const home = await mkdtemp(join(tmpdir(), '1040kit-home-'));
  const config = await mkdtemp(join(tmpdir(), '1040kit-config-'));
  process.env.KIT1040_HOME = home;
  process.env.KIT1040_CONFIG_DIR = config;
  return {
    home,
    config,
    async cleanup() {
      await rm(home, { recursive: true, force: true });
      await rm(config, { recursive: true, force: true });
    },
  };
}

export function emptySummary() {
  return {
    totalIncome: 0,
    agi: 0,
    deductions: 0,
    taxableIncome: 0,
    totalTax: 0,
    totalPayments: 0,
    refundOrOwed: 0,
  };
}

export function fakeResult(
  facts: TaxFacts,
  over: Partial<ReturnResult> = {}
): ReturnResult {
  return {
    taxYear: facts.taxYear,
    filingStatus: facts.filingStatus,
    complete: true,
    unsupported: [],
    missing: [],
    forms: ['f1040'],
    nodes: {},
    summary: emptySummary(),
    ...over,
  };
}

const notImplemented = (): never => {
  throw new Error('not implemented');
};

export function fakeEngine(over: Partial<EngineApi> = {}): EngineApi {
  return {
    supportedYears: [2025, 2026],
    computeReturn: (facts) => fakeResult(facts),
    explainLine: () => null,
    requiredFacts: () => [],
    checkScope: () => [],
    findDeductions: () => [],
    reviewChecks: () => [],
    compareScenarios: notImplemented,
    ...over,
  };
}

export function fakeDeps(over: Partial<Deps> = {}): Deps {
  return {
    engine: fakeEngine(),
    now: () => new Date('2026-02-01T12:00:00Z'),
    kbFetch: (async () => {
      throw new Error('network disabled in tests');
    }) as typeof fetch,
    ...over,
  };
}
