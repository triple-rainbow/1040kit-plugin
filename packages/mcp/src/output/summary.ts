import type { EngineApi, ReturnResult } from '@1040kit/engine';

import { drivers, FORM_ORDER } from '../calc.ts';
import type { StoreData } from '../store/types.ts';
import { currentAcknowledgment } from './acknowledgment.ts';
import { FORM_TITLES } from './field-maps.ts';

const usd = (v: number) => `$${Math.abs(v).toLocaleString('en-US')}`;

const STATUS: Record<string, string> = {
  single: 'Single',
  mfj: 'Married filing jointly',
  hoh: 'Head of household',
};

/** Plain-English summary. Never contains SSNs, EINs or account numbers. */
export function summaryMarkdown(
  data: StoreData,
  result: ReturnResult,
  engine: EngineApi
): string {
  const s = result.summary;
  const out: string[] = [];
  out.push(`# Your ${result.taxYear} federal return — summary`, '');
  out.push(
    `Prepared with 1040kit on your computer. This is not tax advice: you are the preparer, and you are responsible for the return you sign and file.`,
    ''
  );
  if (result.filingStatus)
    out.push(
      `**Filing status:** ${STATUS[result.filingStatus] ?? result.filingStatus}`,
      ''
    );
  out.push('| | Amount |', '|---|---:|');
  out.push(`| Total income | ${usd(s.totalIncome)} |`);
  out.push(`| Adjusted gross income | ${usd(s.agi)} |`);
  out.push(`| Deductions | ${usd(s.deductions)} |`);
  out.push(`| Taxable income | ${usd(s.taxableIncome)} |`);
  out.push(`| Total tax | ${usd(s.totalTax)} |`);
  out.push(
    `| Total payments and refundable credits | ${usd(s.totalPayments)} |`
  );
  out.push(
    s.refundOrOwed >= 0
      ? `| **Refund** | **${usd(s.refundOrOwed)}** |`
      : `| **Amount you owe** | **${usd(s.refundOrOwed)}** |`
  );
  out.push('');

  const top = drivers(result);
  if (top.length) {
    out.push('## What drives the result', '');
    for (const d of top) {
      out.push(`- **${d.label}: ${d.value < 0 ? '-' : ''}${usd(d.value)}**`);
      let expl;
      try {
        expl = engine.explainLine(result, d.id, 0);
      } catch {
        expl = null;
      }
      if (expl) {
        const n = expl.node;
        if (n.form && n.line)
          out.push(`  - On ${FORM_TITLES[n.form]}, line ${n.line}`);
        for (const c of n.citations.slice(0, 2)) {
          out.push(`  - IRS source: [${c.section ?? c.docId}](${c.url})`);
        }
      }
    }
    out.push('');
  }

  if (result.unsupported.length) {
    out.push('## Not handled by 1040kit', '');
    for (const u of result.unsupported)
      out.push(`- ${u.message} (planned: ${u.deferredTo})`);
    out.push('');
  }

  out.push('## Forms in this return', '');
  for (const f of FORM_ORDER.filter((f) => result.forms.includes(f)))
    out.push(`- ${FORM_TITLES[f]}`);
  out.push('');
  out.push('## Your agreement and review', '');
  const ack = currentAcknowledgment(data);
  if (ack) {
    out.push(
      `On ${ack.at.slice(0, 10)} (${ack.at}) you agreed:`,
      '',
      `> ${ack.text}`,
      ''
    );
  }
  if (data.review) {
    out.push(
      `You reviewed this return with return_review on ${data.review.at.slice(0, 10)} (${data.review.at}).`,
      ''
    );
  }
  out.push('## Privacy', '');
  out.push(
    `1040kit never stores Social Security numbers or bank account numbers. Every SSN box on the filled PDF is blank: write them in yourself before you sign. The outputs folder is not encrypted; once your SSNs are on the printed return, keep it private. Your documents and return data never left this computer.`,
    ''
  );
  return out.join('\n');
}
