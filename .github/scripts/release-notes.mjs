import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * 取出 PR 正文里「## 更新说明」到下一个同级或更高级标题之间的内容。
 * 没有这段、或去掉 HTML 注释后是空的，就返回 null，调用方改用 PR 标题。
 */
export function extractUpdateSection(body) {
  if (!body) return null;
  const lines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s*更新说明\s*$/.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;
  const collected = [];
  for (let i = start; i < lines.length; i += 1) {
    if (/^#{1,2}\s+\S/.test(lines[i])) break;
    collected.push(lines[i]);
  }
  const section = collected.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
  return section || null;
}

/** 合并提交是 "Merge pull request #12 ..."，压缩合并通常以 "(#12)" 结尾。 */
export function prNumberFromSubject(subject) {
  const merge = subject.match(/^Merge pull request #(\d+)\b/);
  if (merge) return Number(merge[1]);
  const squash = subject.match(/\(#(\d+)\)\s*$/);
  if (squash) return Number(squash[1]);
  return null;
}

export function uniquePrNumbers(subjects) {
  const seen = new Set();
  const numbers = [];
  for (const subject of subjects) {
    const number = prNumberFromSubject(subject);
    if (number == null || seen.has(number)) continue;
    seen.add(number);
    numbers.push(number);
  }
  return numbers;
}

export function composeReleaseBody({ items, previousTag, tag, repo }) {
  const lines = ['## 更新', ''];
  if (items.length === 0) {
    lines.push('本次没有合并的 Pull Request。', '');
  } else {
    for (const item of items) {
      const notes = extractUpdateSection(item.body);
      const fallback = String(item.title ?? '').trim() || `Pull Request #${item.number}`;
      const text = (notes ?? fallback).trim();
      const link = `[#${item.number}](https://github.com/${repo}/pull/${item.number})`;
      if (text.includes('\n')) {
        lines.push(text, '', `（${link}）`, '');
      } else {
        lines.push(`- ${text}（${link}）`);
      }
    }
    lines.push('');
  }
  if (previousTag && tag) {
    lines.push(`**Full Changelog**: https://github.com/${repo}/compare/${previousTag}...${tag}`);
  } else if (tag) {
    lines.push(`**Full Changelog**: https://github.com/${repo}/commits/${tag}`);
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function option(name, optional = false) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    if (optional) return '';
    console.error(`missing ${name}`);
    process.exit(1);
  }
  return value;
}

function gitSubjects(previous) {
  const args = ['log', '--reverse', '--pretty=%s'];
  args.push(previous ? `${previous}..HEAD` : 'HEAD');
  const out = execFileSync('git', args, { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function loadPr(repo, number) {
  const out = execFileSync(
    'gh',
    ['pr', 'view', String(number), '--repo', repo, '--json', 'number,title,body'],
    { encoding: 'utf8' },
  );
  return JSON.parse(out);
}

function writeNotes() {
  const previous = option('--previous', true);
  const tag = option('--tag');
  const repo = option('--repo');
  const out = option('--out');
  const numbers = uniquePrNumbers(gitSubjects(previous));
  const items = numbers.map((number) => {
    try {
      const pr = loadPr(repo, number);
      return { number: pr.number ?? number, title: pr.title ?? '', body: pr.body ?? '' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`无法读取 PR #${number}，改用编号作为标题: ${message}`);
      return { number, title: `Pull Request #${number}`, body: '' };
    }
  });
  const body = composeReleaseBody({ items, previousTag: previous, tag, repo });
  fs.writeFileSync(out, body);
  process.stdout.write(body);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeNotes();
}
