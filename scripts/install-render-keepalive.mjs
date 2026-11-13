import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const owner = 'cbt12123';
const repo = 'QQ-Team-dfy';
const path = '.github/workflows/render-keepalive.yml';
const credential = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true });
const password = credential.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
if (!password) throw new Error('现有 GitHub 凭据不可用');
async function api(route, method = 'GET', body) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${route ? '/' + route : ''}`, {
    method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${password}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) throw new Error(`GitHub API ${method} ${route.split('?')[0]} failed: ${response.status}`);
  return response.status === 204 ? {} : response.json();
}
const repository = await api('');
const permissions = await api('actions/permissions');
console.log(JSON.stringify({ repositoryFound: Boolean(repository), private: repository?.private, actionsEnabled: permissions?.enabled }));
if (!repository || repository.private || !permissions?.enabled) throw new Error('需要已启用 Actions 的当前公共仓库，不更改付费或权限设置');
const branch = repository.default_branch;
const existing = await api(`contents/${path}?ref=${encodeURIComponent(branch)}`);
if (existing && !Buffer.from(existing.content, 'base64').toString().includes('qqbot-public-web-test.onrender.com/health')) throw new Error('拒绝覆盖非本项目保活工作流');
if (process.argv.includes('--status')) {
  const runs = await api('actions/workflows/render-keepalive.yml/runs?per_page=1');
  const run = runs?.workflow_runs?.[0];
  const workflows = await api('actions/workflows?per_page=20');
  console.log(JSON.stringify({ found: Boolean(runs), count: runs?.total_count, status: run?.status, conclusion: run?.conclusion, url: run?.html_url, workflows: workflows?.workflows?.map(w => ({ name: w.name, state: w.state, path: w.path })) }));
} else if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ publicRepository: true, actionsEnabled: true, defaultBranch: branch, existingWorkflow: Boolean(existing) }));
} else {
  const content = readFileSync(new URL('../deploy/render-keepalive.yml', import.meta.url)).toString('base64');
  if (!existing || existing.content.replaceAll(/\s/g, '') !== content) await api(`contents/${path}`, 'PUT', { message: 'Keep free Render preview warm with scheduled health requests', branch, content, ...(existing ? { sha: existing.sha } : {}) });
  await api(`actions/workflows/render-keepalive.yml/dispatches`, 'POST', { ref: branch });
  console.log(JSON.stringify({ installedOn: branch, dispatched: true, workflow: `https://github.com/${owner}/${repo}/actions/workflows/render-keepalive.yml` }));
}
