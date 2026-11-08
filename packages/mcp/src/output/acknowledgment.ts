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

/** The ACK_REQUIRED message, naming the workspace so the agreement lands there. */
export function ackRequiredMessage(workspace: string, year: number): string {
  return (
    'Before starting, show the user this short agreement word for word and ask whether they agree. ' +
    `Only if they agree, call workspace_init again with year: ${year}, path: ${JSON.stringify(workspace)}, acknowledged: true.\n\n` +
    `"${ACKNOWLEDGMENT_TEXT}"`
  );
}

/** The stored agreement, if it is for the current text. */
export function currentAcknowledgment(
  data: StoreData
): Acknowledgment | undefined {
  const a = data.acknowledgment;
  return a && a.text === ACKNOWLEDGMENT_TEXT ? a : undefined;
}

/** Refuse (ACK_REQUIRED) until the user agreed at the start. */
export function requireAcknowledgment(
  data: StoreData,
  workspace: string
): Acknowledgment {
  const a = currentAcknowledgment(data);
  if (!a)
    throw new ToolError(
      'ACK_REQUIRED',
      ackRequiredMessage(workspace, data.facts.taxYear)
    );
  return a;
}
