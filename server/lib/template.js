// server/lib/template.js
export function expandTemplate(template, vars) {
  return template.replace(/\{([^}]+)\}/g, (m, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m;
  });
}

export function buildTemplateVars({ candidateName, position, settings, surveyUrl, expiresAt }) {
  const deadline = expiresAt
    ? new Date(expiresAt).toISOString().slice(0, 10)
    : '';
  return {
    候補者名: candidateName || '候補者',
    ポジション: position || 'ご応募ポジション',
    会社名: settings.companyName || '弊社',
    'HR 名': settings.hrName || '採用担当',
    'Survey URL': surveyUrl || '',
    締切日: deadline,
  };
}
