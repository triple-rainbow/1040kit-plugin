/**
 * The one-time agreement the user gives when they start (workspace_init with
 * acknowledged: true). The agent shows this text once, the user agrees, and
 * it is stored with the time in the encrypted workspace. It doesn't depend on
 * the facts, so editing the return later doesn't ask again; changing this
 * text does. The final check before the forms is return_review.
 */
import { ToolError } from '../envelope.ts';
import type { Acknowledgment, StoreData } from '../store/types.ts';

export const ACKNOWLEDGMENT_TEXT =
  '1040kit is software that helps you prepare your own federal tax return. ' +
  'It is not tax advice and does not take responsibility for the accuracy of your return. ' +
  'You review the numbers, write in the Social Security numbers yourself, and sign the return as its preparer.';

export const ACK_REQUIRED_MESSAGE =
  'Before starting, show the user this short agreement word for word and ask whether they agree. ' +
  'Only if they agree, call workspace_init again with acknowledged: true.\n\n' +
  `"${ACKNOWLEDGMENT_TEXT}"`;

/** The stored agreement, if it is for the current text. */
export function currentAcknowledgment(
  data: StoreData
): Acknowledgment | undefined {
  const a = data.acknowledgment;
  return a && a.text === ACKNOWLEDGMENT_TEXT ? a : undefined;
}

/** Refuse (ACK_REQUIRED) until the user agreed at the start. */
export function requireAcknowledgment(data: StoreData): Acknowledgment {
  const a = currentAcknowledgment(data);
  if (!a) throw new ToolError('ACK_REQUIRED', ACK_REQUIRED_MESSAGE);
  return a;
}
