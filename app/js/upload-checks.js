// Upload eligibility is separate from strict export/editor quality checks.
// Existing exports can label text overflow as an error; it is still a design choice.
const advisoryCodes = new Set(['overflow', 'shrunk', 'copy-review', 'missing-translation', 'empty', 'empty-text', 'outside-canvas', 'font-missing', 'upscaled-image', 'capture-size']);
const technicalCodes = new Set(['capture-missing', 'frame-missing', 'asset-missing']);

export function uploadChecks(report = {}) {
  const errors = [], warnings = [];
  for (const issue of report.issues ?? []) {
    if (issue.level === 'info') continue;
    const technical = technicalCodes.has(issue.code) || (issue.level === 'error' && !advisoryCodes.has(issue.code));
    (technical ? errors : warnings).push({ ...issue, level: technical ? 'error' : 'warn' });
  }
  // Older reports may contain warning strings that have no structured counterpart.
  const messages = new Set((report.issues ?? []).map(i => i.message));
  for (const message of report.warnings ?? []) if (!messages.has(message)) warnings.push({ level: 'warn', message });
  for (const message of report.skipped ?? []) errors.push({ level: 'error', code: 'skipped-image', message: `Image was not exported: ${message}` });
  return { errors, warnings };
}
