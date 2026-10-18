import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentDocumentProblems } from './current-docs.mjs';
const docs = {
  product: '正式版本：v2.7.0，versionCode 84。\n[发布记录](docs/releases/v2.7.0.md)',
  todo: '正式版本：[v2.7.0 / 84](releases/v2.7.0.md)，已发布；',
  delivery: '## 原始报告\n候选待生成，尚未创建 v2.7.0 Release。\n## 两个包\n两包完成。\n## 发布与关闭\n已发布。',
};
test('accepts matching summaries while preserving old failure and pending logs', () => assert.deepEqual(currentDocumentProblems(docs), []));
test('rejects a stale current product release', () => assert.equal(currentDocumentProblems({ ...docs, product: docs.product.replace('2.7.0', '2.6.0') }).length, 1));
test('rejects pending placeholders in completed current delivery sections', () => assert.equal(currentDocumentProblems({ ...docs, delivery: docs.delivery + '\n尚未创建 v2.7.0 Release。' }).length, 1));
test('does not confuse a new worktree version with the last formal release', () => assert.deepEqual(currentDocumentProblems({ ...docs, todo: docs.todo + '\n工作树正在开发 v2.8.0 / 85。' }), []));
