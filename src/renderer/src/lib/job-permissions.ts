export function canEditJobVariables(
  jobRemoteId: string | null | undefined,
  isAdmin: boolean,
  variableEditJobIds: ReadonlySet<string>
): boolean {
  if (isAdmin) return true
  if (!jobRemoteId) return false
  return variableEditJobIds.has(jobRemoteId)
}
