'use strict';
const { spawn } = require('child_process');

function defaultExec(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts.env || process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    if (opts.input) child.stdin.end(opts.input);
    else child.stdin.end();
    child.on('error', reject);
    child.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

function parseJson(text, fallback = null) {
  const s = String(text || '').trim();
  if (!s) return fallback;
  return JSON.parse(s);
}

function createClient({ exec } = {}) {
  const run = exec || defaultExec;

  async function gh(args, { input, json = true } = {}) {
    const result = await run('gh', args, { input });
    if (result.status !== 0) {
      const err = (result.stderr || result.stdout || 'gh failed').trim();
      throw new Error(err);
    }
    return json ? parseJson(result.stdout, null) : result.stdout;
  }

  async function whoami() {
    const user = await gh(['api', 'user']);
    if (!user || !user.login) throw new Error('could not determine the GitHub runner login');
    return user.login;
  }

  async function repoInfo(fullName) {
    const [owner, name] = fullName.split('/');
    const repo = await gh(['api', `repos/${owner}/${name}`]);
    // GitHub redirects renamed repos (fitzyracing1/bitcoin -> fitzyracing1/viper).
    return {
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      isFork: Boolean(repo.fork),
      parent: repo.parent ? repo.parent.full_name : null,
      hasIssues: Boolean(repo.has_issues),
      hasDiscussions: Boolean(repo.has_discussions),
      htmlUrl: repo.html_url,
    };
  }

  async function defaultSha(fullName, branch) {
    const data = await gh(['api', `repos/${fullName}/commits/${encodeURIComponent(branch)}`]);
    return data.sha;
  }

  async function fetchIssues(fullName, { maxFetch = 80, after = null, acc = [] } = {}) {
    const [owner, name] = fullName.split('/');
    const query = `query($o:String!,$n:String!,$after:String){
      repository(owner:$o, name:$n) {
        issues(states:OPEN, first:50, after:$after, orderBy:{field:UPDATED_AT, direction:DESC}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            number title body url createdAt updatedAt
            labels(first:20) { nodes { name } }
            comments(last:8) { nodes { author { login } body } }
          }
        }
      }
    }`;
    const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `o=${owner}`, '-F', `n=${name}`];
    if (after) args.push('-F', `after=${after}`);
    const data = await gh(args);
    const conn = data && data.data && data.data.repository && data.data.repository.issues;
    if (!conn) {
      // discussions-only or GraphQL shape failure
      return acc;
    }
    const nodes = (conn.nodes || []).map((n) => ({
      type: 'issue',
      number: n.number,
      title: n.title,
      body: n.body || '',
      url: n.url,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      labels: (n.labels && n.labels.nodes) || [],
      comments: (n.comments && n.comments.nodes) || [],
    }));
    const next = acc.concat(nodes);
    if (next.length >= maxFetch) return next.slice(0, maxFetch);
    if (conn.pageInfo && conn.pageInfo.hasNextPage && conn.pageInfo.endCursor) {
      return fetchIssues(fullName, { maxFetch, after: conn.pageInfo.endCursor, acc: next });
    }
    return next;
  }

  async function fetchDiscussions(fullName, { maxFetch = 80 } = {}) {
    const [owner, name] = fullName.split('/');
    const query = `query($o:String!,$n:String!){
      repository(owner:$o, name:$n) {
        hasDiscussionsEnabled
        discussions(first:50, states:OPEN) {
          nodes {
            number title body url createdAt updatedAt
            comments(last:8) { nodes { author { login } body } }
          }
        }
      }
    }`;
    let data;
    try {
      data = await gh(['api', 'graphql', '-f', `query=${query}`, '-F', `o=${owner}`, '-F', `n=${name}`]);
    } catch (err) {
      if (/discussions|not enabled|Could not resolve/i.test(err.message)) return [];
      throw err;
    }
    const repo = data && data.data && data.data.repository;
    if (!repo || !repo.hasDiscussionsEnabled) return [];
    return (repo.discussions.nodes || []).slice(0, maxFetch).map((n) => ({
      type: 'discussion',
      number: n.number,
      title: n.title,
      body: n.body || '',
      url: n.url,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      labels: [],
      comments: (n.comments && n.comments.nodes) || [],
    }));
  }

  async function listViewerForks(login) {
    const query = `query($l:String!,$after:String){
      user(login:$l) {
        repositories(first:100, after:$after, isFork:true, ownerAffiliations:OWNER) {
          pageInfo { hasNextPage endCursor }
          nodes { nameWithOwner name owner { login } parent { nameWithOwner } defaultBranchRef { name } }
        }
      }
    }`;
    const forks = [];
    let after = '';
    // Cap pages so we cannot loop forever.
    for (let page = 0; page < 10; page++) {
      const gargs = ['api', 'graphql', '-f', `query=${query}`, '-F', `l=${login}`];
      if (after) gargs.push('-F', `after=${after}`);
      const data = await gh(gargs);
      const conn = data && data.data && data.data.user && data.data.user.repositories;
      if (!conn) break;
      for (const n of conn.nodes || []) {
        forks.push({
          fullName: n.nameWithOwner,
          owner: n.owner.login,
          name: n.name,
          parent: n.parent ? n.parent.nameWithOwner : null,
          defaultBranch: n.defaultBranchRef ? n.defaultBranchRef.name : 'main',
        });
      }
      if (!conn.pageInfo.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
    return forks;
  }

  async function createFork(sourceFullName) {
    // gh repo fork does not open a PR or comment on the source.
    const out = await gh(['repo', 'fork', sourceFullName, '--clone=false', '--default-branch-only'], { json: false });
    return String(out || '');
  }

  async function commitChecks(fullName, sha) {
    let checks = { check_runs: [] };
    let statuses = { statuses: [], state: 'pending' };
    try {
      checks = await gh(['api', `repos/${fullName}/commits/${sha}/check-runs`]);
    } catch (err) {
      if (!/404|422/.test(err.message)) throw err;
    }
    try {
      statuses = await gh(['api', `repos/${fullName}/commits/${sha}/status`]);
    } catch (err) {
      if (!/404|422/.test(err.message)) throw err;
    }
    return { checks: checks.check_runs || [], status: statuses };
  }

  return {
    gh,
    whoami,
    repoInfo,
    defaultSha,
    fetchIssues,
    fetchDiscussions,
    listViewerForks,
    createFork,
    commitChecks,
    run,
  };
}

module.exports = { createClient, defaultExec, parseJson };
