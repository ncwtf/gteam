import assert from 'node:assert/strict';
import test from 'node:test';
import { composeReleaseBody, extractUpdateSection, prNumberFromSubject, uniquePrNumbers } from './release-notes.mjs';

test('更新说明取到下一个同级标题为止，并保留其中的三级标题', () => {
  const body = [
    '## 背景',
    '给审查者看的。',
    '## 更新说明',
    '安装后的客户端自带 MCP。',
    '',
    '### 托盘',
    '左键打开主窗口。',
    '## 测试',
    '不进发布说明。',
  ].join('\n');
  assert.equal(extractUpdateSection(body), '安装后的客户端自带 MCP。\n\n### 托盘\n左键打开主窗口。');
});

test('没有更新说明、或只剩 HTML 注释时返回空', () => {
  assert.equal(extractUpdateSection('只有标题'), null);
  assert.equal(extractUpdateSection('## 更新说明\n\n<!-- 请填写 -->\n'), null);
  assert.equal(extractUpdateSection(''), null);
  assert.equal(extractUpdateSection('## 更新说明\r\n用户能看到这一句。\r\n'), '用户能看到这一句。');
});

test('从合并提交和压缩合并的标题里取出 PR 号，并去重', () => {
  assert.equal(prNumberFromSubject('Merge pull request #12 from ncwtf/feat'), 12);
  assert.equal(prNumberFromSubject('为桌面端加入自动更新 (#11)'), 11);
  assert.equal(prNumberFromSubject('直接推到 main 的提交'), null);
  assert.deepEqual(uniquePrNumbers([
    'Merge pull request #12 from ncwtf/feat',
    'Merge pull request #12 from ncwtf/feat',
    '修一下 (#13)',
    '无关提交',
  ]), [12, 13]);
});

test('发布正文用更新说明，缺省时用 PR 标题，并附上比较链接', () => {
  const body = composeReleaseBody({
    previousTag: 'v0.1.5',
    tag: 'v0.1.6',
    repo: 'ncwtf/gteam',
    items: [
      { number: 13, title: '英文标题不该出现', body: '## 更新说明\n\n安装包自带 MCP，托盘可以打开主窗口。\n' },
      { number: 14, title: '修复登录按钮没反应', body: '没有更新说明' },
      {
        number: 15,
        title: '多行',
        body: '## 更新说明\n- 自建服务可以启用 HTTPS\n- 客户端接受 https 地址\n## 其他\n忽略',
      },
    ],
  });
  assert.match(body, /^- 安装包自带 MCP，托盘可以打开主窗口。（\[#13\]\(https:\/\/github.com\/ncwtf\/gteam\/pull\/13\)）/m);
  assert.match(body, /^- 修复登录按钮没反应（\[#14\]\(https:\/\/github.com\/ncwtf\/gteam\/pull\/14\)）/m);
  assert.match(body, /^- 自建服务可以启用 HTTPS\n- 客户端接受 https 地址\n\n（\[#15\]/m);
  assert.doesNotMatch(body, /英文标题/);
  assert.doesNotMatch(body, /忽略/);
  assert.match(body, /\*\*Full Changelog\*\*: https:\/\/github.com\/ncwtf\/gteam\/compare\/v0\.1\.5\.\.\.v0\.1\.6/);
});

test('没有 PR 时仍然给出比较链接', () => {
  const body = composeReleaseBody({
    items: [],
    previousTag: 'v0.1.0',
    tag: 'v0.1.1',
    repo: 'ncwtf/gteam',
  });
  assert.match(body, /本次没有合并的 Pull Request/);
  assert.match(body, /compare\/v0\.1\.0\.\.\.v0\.1\.1/);
});
