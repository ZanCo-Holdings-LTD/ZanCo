/** Filesystem- and URL-safe slug for report filenames and storage paths. */
export function slugify(input: string, maxLength = 60): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'untitled').slice(0, maxLength).replace(/-+$/, '');
}

/**
 * Storage key for a rendered report version.
 * Org-prefixed so a signed URL can never be reused across tenants.
 */
export function reportPdfKey(orgId: string, reportId: string, versionNo: number): string {
  return `${orgId}/${reportId}/v${versionNo}.pdf`;
}

export function capturePath(orgId: string, reportId: string, captureId: string): string {
  return `${orgId}/${reportId}/${captureId}.m4a`;
}

export function mediaPath(orgId: string, reportId: string, assetId: string, ext = 'jpg'): string {
  return `${orgId}/${reportId}/${assetId}.${ext}`;
}
