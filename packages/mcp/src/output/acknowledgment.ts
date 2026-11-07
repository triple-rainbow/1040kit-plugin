/**
 * The sign-off the user gives before forms_fill. It is a contract: the agent
 * shows this text word for word, the user agrees, and forms_fill records it
 * (text, time, facts hash) in the encrypted store. Any change to the facts
 * afterwards needs a new sign-off. Changing this text also requires one.
 */
import { factsHash } from '../calc.ts';
import type { Acknowledgment, StoreData } from '../store/types.ts';

export const ACKNOWLEDGMENT_TEXT =
  'I entered all Social Security numbers and other identifying numbers on these forms myself. ' +
  'I reviewed every number on these forms and confirm that they are correct and complete. ' +
  'I am the preparer of my own tax return. ' +
  '1040kit is software, not tax advice, and takes no responsibility for the accuracy of my return or of the numbers I enter.';

export const ACK_REQUIRED_MESSAGE =
  'Before filling the forms, show the user this acknowledgment word for word and ask whether they agree. ' +
  'Only if they agree, call forms_fill again with acknowledged: true.\n\n' +
  `"${ACKNOWLEDGMENT_TEXT}"`;

/** The stored sign-off, if it covers the current facts and the current text. */
export function currentAcknowledgment(
  data: StoreData
): Acknowledgment | undefined {
  const a = data.acknowledgment;
  return a &&
    a.text === ACKNOWLEDGMENT_TEXT &&
    a.factsHash === factsHash(data.facts)
    ? a
    : undefined;
}
