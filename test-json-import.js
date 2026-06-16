// 测试 JSON 导入功能

// 模拟 normalizeJsonToRequirements 函数
function normalizeJsonToRequirements(jsonData) {
  const weightMap = {
    'tech': '技術適合',
    'technology': '技術適合',
    'industry': '業界経験',
    'logic': '具体性',
    'specificity': '具体性',
    'mgmt': '管理推進',
    'management': '管理推進',
    'stability': '安定性',
  };

  const weights = {
    '技術適合': 0,
    '業界経験': 0,
    '具体性': 0,
    '管理推進': 0,
    '安定性': 0,
  };

  if (jsonData.weights && typeof jsonData.weights === 'object') {
    for (const [key, val] of Object.entries(jsonData.weights)) {
      const internalKey = weightMap[key.toLowerCase()] || key;
      if (weights.hasOwnProperty(internalKey)) {
        weights[internalKey] = Number(val) || 0;
      }
    }
  }

  let body = '';
  if (jsonData.memo) {
    body = typeof jsonData.memo === 'string' ? jsonData.memo : '';
  } else if (jsonData.body) {
    body = typeof jsonData.body === 'string' ? jsonData.body : '';
  }
  if (!body.trim()) {
    body = `# 募集要件（${jsonData.name || jsonData.position || '未設定'}）`;
  }

  return {
    preset: jsonData.id || jsonData.preset || '',
    position: jsonData.name || jsonData.position || '',
    experienceYears: Number(jsonData.experienceYears || 0),
    weights: weights,
    necessary: Array.isArray(jsonData.mustSkills) ? jsonData.mustSkills : (Array.isArray(jsonData.necessary) ? jsonData.necessary : []),
    preferred: Array.isArray(jsonData.niceSkills) ? jsonData.niceSkills : (Array.isArray(jsonData.preferred) ? jsonData.preferred : []),
    body: body,
  };
}

// 测试数据
const testData = {
  "id": "pmo",
  "name": "PMO（管理者）",
  "experienceYears": 5,
  "mustSkills": ["プロジェクトマネジメント経験", "進捗・品質・課題管理", "ステークホルダ折衝", "ドキュメント作成", "チームマネジメント"],
  "niceSkills": ["PMP / プロジェクトマネージャ試験", "予算管理", "複数案件の統括経験"],
  "weights": { "tech": 5, "industry": 7, "logic": 7, "mgmt": 10, "stability": 7 },
  "memo": "# 募集要件（PMO（管理者））\n管理・推進力を最重視。技術は理解できる程度でも可。"
};

console.log('=== テスト: JSON to Requirements 変換 ===\n');
console.log('入力:', JSON.stringify(testData, null, 2));
console.log('\n---\n');

const result = normalizeJsonToRequirements(testData);
console.log('出力:', JSON.stringify(result, null, 2));

console.log('\n=== 検証 ===');
console.log('✓ preset:', result.preset === 'pmo' ? '成功' : '失敗');
console.log('✓ position:', result.position === 'PMO（管理者）' ? '成功' : '失敗');
console.log('✓ experienceYears:', result.experienceYears === 5 ? '成功' : '失敗');
console.log('✓ necessary count:', result.necessary.length === 5 ? '成功' : '失敗');
console.log('✓ preferred count:', result.preferred.length === 3 ? '成功' : '失敗');
console.log('✓ weights[管理推進]:', result.weights['管理推進'] === 10 ? '成功' : '失敗');
console.log('✓ body:', result.body.includes('管理・推進力') ? '成功' : '失敗');
