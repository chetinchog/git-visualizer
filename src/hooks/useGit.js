import { useState, useCallback, useEffect } from 'react';

const generateId = () => Math.random().toString(36).substr(2, 7);

const formatTimestamp = (date) => {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const STORAGE_KEY = 'git-visualizer-state';

const createInitialState = () => ({
  commits: [
    { id: 'init', message: 'Initial commit', parentId: null, timestamp: formatTimestamp(new Date()), branch: 'main' }
  ],
  branches: {
    'main': 'init'
  },
  head: {
    type: 'branch',
    ref: 'main'
  },
  commandHistory: []
});

const loadState = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Error loading state from localStorage:', e);
  }
  return createInitialState();
};

const saveState = (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Error saving state to localStorage:', e);
  }
};

export function useGit() {
  const [state, setState] = useState(loadState);

  // Save to localStorage whenever state changes
  useEffect(() => {
    saveState(state);
  }, [state]);

  const executeCommand = useCallback((cmdStr) => {
    const args = cmdStr.trim().split(/\s+/);
    const cmd = args[0];
    const subCmd = args[1];

    setState(prev => {
      const newState = { ...prev, commandHistory: [...prev.commandHistory, { cmd: cmdStr, output: '', status: 'success' }] };

      const log = (msg, status = 'success') => {
        newState.commandHistory[newState.commandHistory.length - 1].output = msg;
        newState.commandHistory[newState.commandHistory.length - 1].status = status;
      };

      // Handle 'clear' command
      if (cmd === 'clear') {
        localStorage.removeItem(STORAGE_KEY);
        return createInitialState();
      }

      if (cmd !== 'git') {
        log(`command not found: ${cmd}`, 'error');
        return newState;
      }

      const currentHeadCommitId = prev.head.type === 'branch'
        ? prev.branches[prev.head.ref]
        : prev.head.ref;

      if (subCmd === 'commit') {
        const msgIndex = args.indexOf('-m');
        const message = msgIndex !== -1 ? args.slice(msgIndex + 1).join(' ').replace(/['"]/g, '') : 'New commit';

        const newCommitId = generateId();
        const newCommit = {
          id: newCommitId,
          message,
          parentId: currentHeadCommitId,
          timestamp: formatTimestamp(new Date()),
          branch: prev.head.type === 'branch' ? prev.head.ref : null
        };

        newState.commits = [...prev.commits, newCommit];

        if (prev.head.type === 'branch') {
          newState.branches = {
            ...prev.branches,
            [prev.head.ref]: newCommitId
          };
        } else {
          // Detached HEAD commit
          newState.head = { type: 'commit', ref: newCommitId };
        }
        log(`[${prev.head.type === 'branch' ? prev.head.ref : 'detached'}] ${newCommitId} ${message}`);
      }
      else if (subCmd === 'branch') {
        const flag = args[2];

        // Check for delete flags
        if (flag === '-d' || flag === '-D') {
          const branchToDelete = args[3];

          if (!branchToDelete) {
            log('fatal: branch name required', 'error');
          } else if (!prev.branches[branchToDelete]) {
            log(`error: branch '${branchToDelete}' not found.`, 'error');
          } else if (branchToDelete === prev.head.ref && prev.head.type === 'branch') {
            log(`error: Cannot delete branch '${branchToDelete}' checked out.`, 'error');
          } else if (branchToDelete === 'main') {
            log(`error: Cannot delete the 'main' branch.`, 'error');
          } else {
            // For -d, check if branch is merged
            if (flag === '-d') {
              // Check if branch tip is reachable from current HEAD
              const branchTip = prev.branches[branchToDelete];
              const reachable = new Set();
              const queue = [currentHeadCommitId];

              while (queue.length > 0) {
                const id = queue.shift();
                if (reachable.has(id)) continue;
                reachable.add(id);

                const commit = prev.commits.find(c => c.id === id);
                if (!commit) continue;

                const parents = commit.parents || (commit.parentId ? [commit.parentId] : []);
                parents.forEach(p => queue.push(p));
              }

              if (!reachable.has(branchTip)) {
                log(`error: The branch '${branchToDelete}' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D ${branchToDelete}'.`, 'error');
              } else {
                // Safe to delete
                const { [branchToDelete]: _, ...remainingBranches } = prev.branches;
                newState.branches = remainingBranches;
                log(`Deleted branch ${branchToDelete} (was ${branchTip.substr(0, 7)}).`);
              }
            } else {
              // -D: Force delete
              const branchTip = prev.branches[branchToDelete];
              const { [branchToDelete]: _, ...remainingBranches } = prev.branches;
              newState.branches = remainingBranches;
              log(`Deleted branch ${branchToDelete} (was ${branchTip.substr(0, 7)}).`);
            }
          }
        } else if (!flag) {
          // List branches
          const list = Object.keys(prev.branches).map(b =>
            (b === prev.head.ref && prev.head.type === 'branch' ? '* ' : '  ') + b
          ).join('\n');
          log(list);
        } else {
          // Create branch
          const branchName = flag;
          if (prev.branches[branchName]) {
            log(`fatal: A branch named '${branchName}' already exists.`, 'error');
          } else {
            newState.branches = { ...prev.branches, [branchName]: currentHeadCommitId };
            log(`Created branch ${branchName}`);
          }
        }
      }
      else if (subCmd === 'checkout') {
        const target = args[2];
        if (!target) {
          log('fatal: missing argument', 'error');
        } else if (prev.branches[target]) {
          newState.head = { type: 'branch', ref: target };
          log(`Switched to branch '${target}'`);
        } else {
          // Check if it's a commit hash
          const commit = prev.commits.find(c => c.id === target);
          if (commit) {
            newState.head = { type: 'commit', ref: target };
            log(`Note: switching to '${target}'.\n\nYou are in 'detached HEAD' state.`);
          } else if (args[2] === '-b') {
            const newBranch = args[3];
            if (prev.branches[newBranch]) {
              log(`fatal: A branch named '${newBranch}' already exists.`, 'error');
            } else {
              newState.branches = { ...prev.branches, [newBranch]: currentHeadCommitId };
              newState.head = { type: 'branch', ref: newBranch };
              log(`Switched to a new branch '${newBranch}'`);
            }
          } else {
            log(`error: pathspec '${target}' did not match any file(s) known to git`, 'error');
          }
        }
      }
      else if (subCmd === 'switch') {
        const target = args[2];
        if (!target) {
          log('fatal: missing argument', 'error');
        } else if (target === '-c') {
          const newBranch = args[3];
          if (prev.branches[newBranch]) {
            log(`fatal: A branch named '${newBranch}' already exists.`, 'error');
          } else {
            newState.branches = { ...prev.branches, [newBranch]: currentHeadCommitId };
            newState.head = { type: 'branch', ref: newBranch };
            log(`Switched to a new branch '${newBranch}'`);
          }
        } else {
          if (prev.branches[target]) {
            newState.head = { type: 'branch', ref: target };
            log(`Switched to branch '${target}'`);
          } else {
            log(`fatal: invalid reference: ${target}`, 'error');
          }
        }
      }
      else if (subCmd === 'merge') {
        // Check for --squash flag
        const isSquash = args[2] === '--squash';
        const targetBranch = isSquash ? args[3] : args[2];

        if (!targetBranch) {
          log('fatal: missing argument', 'error');
        } else if (!prev.branches[targetBranch]) {
          log(`fatal: '${targetBranch}' does not point to a valid object`, 'error');
        } else if (prev.head.type !== 'branch') {
          log('fatal: You are not currently on a branch.', 'error');
        } else {
          const targetCommitId = prev.branches[targetBranch];
          const currentCommitId = prev.branches[prev.head.ref];

          if (targetCommitId === currentCommitId) {
            log('Already up to date.');
          } else {
            const newCommitId = generateId();
            const currentBranch = prev.head.ref;

            if (isSquash) {
              // Squash merge: single parent commit (no merge commit structure)
              const newCommit = {
                id: newCommitId,
                message: `Squashed commit from '${targetBranch}'`,
                parentId: currentCommitId,
                timestamp: formatTimestamp(new Date()),
                branch: currentBranch
              };

              newState.commits = [...prev.commits, newCommit];
              newState.branches = {
                ...prev.branches,
                [prev.head.ref]: newCommitId
              };
              log(`Squash commit -- not updating HEAD\nChanges have been applied.`);
            } else {
              // Regular merge commit with two parents
              const newCommit = {
                id: newCommitId,
                message: `Merge branch '${targetBranch}' into '${currentBranch}'`,
                parentId: currentCommitId,
                parents: [currentCommitId, targetCommitId],
                timestamp: formatTimestamp(new Date()),
                branch: currentBranch
              };

              newState.commits = [...prev.commits, newCommit];
              newState.branches = {
                ...prev.branches,
                [prev.head.ref]: newCommitId
              };
              log(`Merge made by the 'ort' strategy.`);
            }
          }
        }
      }
      else if (subCmd === 'log') {
        const reachable = new Set();
        const queue = [currentHeadCommitId];

        // BFS to find all reachable ancestors
        while (queue.length > 0) {
          const id = queue.shift();
          if (reachable.has(id)) continue;
          reachable.add(id);

          const commit = newState.commits.find(c => c.id === id);
          if (!commit) continue;

          // Use 'parents' array if available (merge commits), otherwise 'parentId'
          const parents = commit.parents || (commit.parentId ? [commit.parentId] : []);
          parents.forEach(p => queue.push(p));
        }

        // Filter commits by reachability and reverse (assuming commits array is chronological)
        const history = newState.commits
          .filter(c => reachable.has(c.id))
          .reverse()
          .map(c => `- ${c.timestamp || 'N/A'} ${c.id} ${c.message}`);

        log(history.join('\n'));
      }
      else {
        log(`git: '${subCmd}' is not a git command.`, 'error');
      }

      return newState;
    });
  }, []);

  return {
    state,
    executeCommand
  };
}
