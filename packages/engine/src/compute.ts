/** computeReturn: facts -> evaluated graph -> ReturnResult. */
import { ownedOnReturn } from './facts.ts';
import { eicChildren, eicNodes } from './forms/eic.ts';
import { f1040Nodes } from './forms/f1040.ts';
import { f8829Businesses, f8829Nodes } from './forms/f8829.ts';
import { f8959Nodes, f8960Nodes } from './forms/f8959.ts';
import { f8995Nodes } from './forms/f8995.ts';
import { sch1Nodes } from './forms/sch1.ts';
import { sch1aNodes } from './forms/sch1a.ts';
import { sch8812Nodes } from './forms/sch8812.ts';
import { needsScheduleB } from './forms/schB.ts';
import { businessesOnReturn, schCNodes } from './forms/schC.ts';
import { planRentals, schENodes } from './forms/schE.ts';
import { schSENodes } from './forms/schSE.ts';
import { evaluate, type NodeDef } from './graph.ts';
import { getParams, type YearParams } from './params/index.ts';
import { requiredFactsFrom } from './required.ts';
import { scopeItems } from './scope.ts';
import type {
  FormId,
  LineNode,
  ReturnResult,
  ReturnSummary,
  TaxFacts,
} from './types.ts';

export function buildNodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  return [
    ...f1040Nodes(facts, params),
    ...schCNodes(facts, params),
    ...schSENodes(facts, params),
    ...sch1Nodes(facts, params),
    ...f8995Nodes(facts, params),
    ...sch1aNodes(facts, params),
    ...sch8812Nodes(facts, params),
    ...schENodes(facts, params),
    ...f8829Nodes(facts, params),
    ...f8959Nodes(facts, params),
    ...f8960Nodes(facts, params),
    ...eicNodes(facts, params),
  ];
}

export interface CoreResult {
  params: YearParams;
  nodes: Record<string, LineNode>;
}

/** Evaluate the graph only (no scope or missing-facts checks). */
export function computeCore(facts: TaxFacts): CoreResult {
  const params = getParams(facts.taxYear);
  return { params, nodes: evaluate(buildNodes(facts, params), facts, params) };
}

function formsUsed(facts: TaxFacts, core: CoreResult): FormId[] {
  const forms: FormId[] = ['f1040'];
  const v = (id: string) => core.nodes[id]?.value ?? 0;
  const owners = businessesOnReturn(facts).map((b) => b.owner);
  if (
    v('additionalIncome') !== 0 ||
    v('adjustments') !== 0 ||
    v('form1099KPersonalPortion') !== 0
  )
    forms.push('sch1');
  if (v('sch1aTotal') > 0) forms.push('sch1a');
  if (v('otherTaxes') > 0) forms.push('sch2');
  if (needsScheduleB(facts, core.params)) forms.push('schB');
  for (const o of owners) forms.push(`schC.${o}`);
  for (const o of owners) if (v(`seTax.${o}`) > 0) forms.push(`schSE.${o}`);
  if (v('childCredits') > 0 || v('actc') > 0) forms.push('sch8812');
  if (v('qbiDeduction') > 0) forms.push('f8995');
  if (planRentals(facts, core.params).some((p) => p.column !== null))
    forms.push('schE');
  if (v('eic') > 0 && eicChildren(facts).length > 0) forms.push('schEIC');
  for (const b of f8829Businesses(facts)) forms.push(`f8829.${b.owner}`);
  // i8959 Who Must File: any one W-2 box 5 over $200,000, or tax or withholding to report.
  const bigW2 = ownedOnReturn(facts, facts.w2s).some(
    (w) =>
      w.medicareWages > core.params.additionalMedicareWithholdingThreshold * 100
  );
  if (v('additionalMedicareTax') > 0 || v('withholdingOther') > 0 || bigW2)
    forms.push('f8959');
  if (v('niit') > 0) forms.push('f8960');
  return forms;
}

function summaryOf(nodes: Record<string, LineNode>): ReturnSummary {
  const v = (id: string) => nodes[id]?.value ?? 0;
  return {
    totalIncome: v('totalIncome'),
    agi: v('agi'),
    deductions: v('deductions'),
    taxableIncome: v('taxableIncome'),
    totalTax: v('totalTax'),
    totalPayments: v('totalPayments'),
    refundOrOwed: v('refundOrOwed'),
  };
}

export function computeReturn(facts: TaxFacts): ReturnResult {
  const core = computeCore(facts);
  const unsupported = scopeItems(facts, core);
  const missing = requiredFactsFrom(facts, core);
  return {
    taxYear: facts.taxYear,
    ...(facts.filingStatus ? { filingStatus: facts.filingStatus } : {}),
    complete: unsupported.length === 0 && !missing.some((m) => m.blocking),
    unsupported,
    missing,
    forms: formsUsed(facts, core),
    nodes: core.nodes,
    summary: summaryOf(core.nodes),
  };
}
