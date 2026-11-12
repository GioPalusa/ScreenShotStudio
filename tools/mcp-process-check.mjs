import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

/** An active-app proxy must stay one process: the open GUI owns rendering. */
export function verifyActiveMCPProcess(pid) {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const children = rows.filter(([, parent]) => parent === pid);
  const rss = rows.find(([id]) => id === pid)?.[2];
  assert.equal(children.length, 0, `Active-app MCP started ${children.length} unnecessary helper processes (PIDs ${children.map(([id]) => id).join(', ')}).`);
  return { pid, helpers: children.length, rssMiB: Math.round(rss / 1024) };
}
