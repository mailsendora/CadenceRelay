export function canDecideApproval(requesterId: string | null, actorId: string, allowSelfApproval: boolean): boolean {
  return allowSelfApproval || requesterId !== actorId;
}

export function approvalAllowsSending(status: string): boolean {
  return status === 'not_required' || status === 'approved';
}
