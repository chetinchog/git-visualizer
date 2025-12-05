import React, { useMemo } from 'react';
import './GitVisualizer.css';

const ROW_HEIGHT = 150;
const COL_WIDTH = 180;

// Color palette for branches (main is always red)
const BRANCH_COLORS = [
    '#ff3366', // red - reserved for main
    '#00d4aa', // teal
    '#7c4dff', // purple
    '#ffab00', // amber
    '#00b0ff', // light blue
    '#76ff03', // lime
    '#ff6e40', // deep orange
    '#e040fb', // pink
    '#64ffda', // cyan
    '#ffd600', // yellow
];

const getBranchColor = (branchName, branchList) => {
    if (branchName === 'main') return BRANCH_COLORS[0];

    // Get consistent index for branch name
    const sortedBranches = Object.keys(branchList).filter(b => b !== 'main').sort();
    const index = sortedBranches.indexOf(branchName);

    // Use colors 1-9 (skip 0 which is for main)
    return BRANCH_COLORS[(index % (BRANCH_COLORS.length - 1)) + 1];
};

export function GitVisualizer({ state }) {
    const { commits, branches, head } = state;

    // Calculate layout
    const layout = useMemo(() => {
        const positions = {}; // commitId -> { x, y }

        // Build depth map (Y position) via BFS
        const depths = {};
        const childrenMap = {};

        commits.forEach(c => {
            if (c.parentId) {
                if (!childrenMap[c.parentId]) childrenMap[c.parentId] = [];
                childrenMap[c.parentId].push(c.id);
            }
        });

        const queue = [{ id: 'init', depth: 0 }];
        const visited = new Set(['init']);
        depths['init'] = 0;

        while (queue.length > 0) {
            const { id, depth } = queue.shift();
            const children = childrenMap[id] || [];
            children.forEach(childId => {
                if (!visited.has(childId)) {
                    visited.add(childId);
                    depths[childId] = depth + 1;
                    queue.push({ id: childId, depth: depth + 1 });
                }
            });
        }

        // Determine which commits are on main branch
        const mainTip = branches['main'];
        const mainCommits = new Set();
        if (mainTip) {
            let curr = mainTip;
            while (curr) {
                mainCommits.add(curr);
                const commit = commits.find(c => c.id === curr);
                if (!commit) break;
                curr = commit.parentId;
            }
        }

        // Assign lanes per branch (not per commit)
        // branchLanes: branchName -> laneIndex
        const branchLanes = { 'main': 0 };

        // Track which depths are occupied in each lane
        // laneOccupiedDepths: lane -> Set of occupied depths
        const laneOccupiedDepths = { 0: new Set() };

        // First, mark all main commit depths as occupied in lane 0
        commits.forEach(c => {
            if (mainCommits.has(c.id)) {
                const depth = depths[c.id] || 0;
                if (!laneOccupiedDepths[0]) laneOccupiedDepths[0] = new Set();
                laneOccupiedDepths[0].add(depth);
            }
        });

        // Get all unique branches from commits (excluding main)
        const branchesFromCommits = [...new Set(commits.map(c => c.branch).filter(b => b && b !== 'main'))];

        // Sort branches by the depth of their first commit (earliest first)
        branchesFromCommits.sort((a, b) => {
            const aFirstCommit = commits.find(c => c.branch === a);
            const bFirstCommit = commits.find(c => c.branch === b);
            return (depths[aFirstCommit?.id] || 0) - (depths[bFirstCommit?.id] || 0);
        });

        // Assign lane to each branch
        let nextRightLane = 1;
        let nextLeftLane = -1;
        let assignRight = true; // Alternate sides

        branchesFromCommits.forEach(branchName => {
            // Get all commits for this branch and their depths
            const branchCommitDepths = commits
                .filter(c => c.branch === branchName)
                .map(c => depths[c.id] || 0);

            // Try to find an available lane
            let assignedLane = null;

            // Determine which side to prefer based on alternation or first available
            const tryLane = (lane) => {
                if (!laneOccupiedDepths[lane]) return true; // Lane is empty
                // Check if any of our depths conflict
                for (const d of branchCommitDepths) {
                    if (laneOccupiedDepths[lane].has(d)) return false;
                }
                return true;
            };

            // Try alternating sides, starting with the current preference
            if (assignRight) {
                // Try right side first
                for (let lane = 1; lane <= 20; lane++) {
                    if (tryLane(lane)) {
                        assignedLane = lane;
                        break;
                    }
                }
                if (assignedLane === null) {
                    // Try left side
                    for (let lane = -1; lane >= -20; lane--) {
                        if (tryLane(lane)) {
                            assignedLane = lane;
                            break;
                        }
                    }
                }
            } else {
                // Try left side first
                for (let lane = -1; lane >= -20; lane--) {
                    if (tryLane(lane)) {
                        assignedLane = lane;
                        break;
                    }
                }
                if (assignedLane === null) {
                    // Try right side
                    for (let lane = 1; lane <= 20; lane++) {
                        if (tryLane(lane)) {
                            assignedLane = lane;
                            break;
                        }
                    }
                }
            }

            // Fallback: create new lane on the appropriate side
            if (assignedLane === null) {
                if (assignRight) {
                    assignedLane = nextRightLane++;
                } else {
                    assignedLane = nextLeftLane--;
                }
            }

            branchLanes[branchName] = assignedLane;

            // Mark these depths as occupied
            if (!laneOccupiedDepths[assignedLane]) laneOccupiedDepths[assignedLane] = new Set();
            branchCommitDepths.forEach(d => laneOccupiedDepths[assignedLane].add(d));

            // Alternate sides for next branch
            assignRight = !assignRight;
        });

        // Build commit lane map based on branch lanes
        const laneMap = {}; // commitId -> laneIndex

        commits.forEach(c => {
            if (mainCommits.has(c.id)) {
                laneMap[c.id] = 0;
            } else {
                const branchLane = branchLanes[c.branch];
                if (branchLane !== undefined) {
                    laneMap[c.id] = branchLane;
                } else {
                    // Fallback for commits without branch info
                    laneMap[c.id] = 1;
                }
            }
        });

        // Calculate the center offset based on used lanes
        const usedLanes = Object.values(laneMap);
        const minLane = Math.min(...usedLanes, 0);
        const maxLane = Math.max(...usedLanes, 0);

        // Offset to center lane 0
        const centerOffset = Math.abs(minLane) * COL_WIDTH;


        // First pass: position non-merge commits and track max depth per lane
        const laneMaxDepth = {}; // lane -> max depth used

        commits.forEach(c => {
            const lane = laneMap[c.id];
            const isMergeCommit = c.parents && c.parents.length > 1;

            if (!isMergeCommit) {
                const depth = depths[c.id] || 0;
                positions[c.id] = {
                    x: centerOffset + lane * COL_WIDTH,
                    y: depth * ROW_HEIGHT
                };
                // Track max depth for this lane
                laneMaxDepth[lane] = Math.max(laneMaxDepth[lane] || 0, depth);
            }
        });

        // Second pass: position merge commits
        commits.forEach(c => {
            const lane = laneMap[c.id];
            const isMergeCommit = c.parents && c.parents.length > 1;

            if (isMergeCommit) {
                // Get the source branch tip depth (second parent)
                const sourceCommitId = c.parents[1];
                const sourceDepth = depths[sourceCommitId] || 0;

                // Get the destination branch's last commit depth (first parent)
                const destCommitId = c.parents[0];
                const destDepth = depths[destCommitId] || 0;

                // The merge commit should be at:
                // - Same row as source branch tip OR
                // - One row below the destination's last commit
                // Whichever is greater
                const minDepthForLane = (laneMaxDepth[lane] || 0) + 1;
                const mergeDepth = Math.max(sourceDepth, minDepthForLane);

                positions[c.id] = {
                    x: centerOffset + lane * COL_WIDTH,
                    y: mergeDepth * ROW_HEIGHT
                };

                // Update lane max depth
                laneMaxDepth[lane] = Math.max(laneMaxDepth[lane] || 0, mergeDepth);
            }
        });

        return { positions, depths, centerOffset };
    }, [commits, branches]);

    const { positions } = layout;



    // Generate Branch Threads (The "Red Thread" metaphor)
    // We trace back from branch tip.
    // Actually, let's just draw lines between commits.
    // The user wants "Branch name on the thread".
    // So for the connection leading TO the branch tip, we put the label.

    // Also handle "Dangling" branches (no unique commit, just pointing to existing)
    // We can render them as extra labels or small extensions.

    return (
        <div className="visualizer-container">
            <div className="graph-area" style={{ height: (commits.length + 1) * ROW_HEIGHT }}>
                <svg style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                    <defs>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                            <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>
                    {commits.map(c => {
                        const parents = c.parents || (c.parentId ? [c.parentId] : []);
                        if (parents.length === 0) return null;

                        return parents.map((pid, idx) => {
                            const start = positions[pid];
                            const end = positions[c.id];
                            if (!start || !end) return null;

                            // Different style for secondary parents (merges)
                            const isSecondary = idx > 0;

                            // Get the color based on the commit's branch
                            const commitColor = getBranchColor(c.branch || 'main', branches);

                            return (
                                <path
                                    key={`line-${c.id}-${pid}`}
                                    d={`M ${start.x + 70} ${start.y + 50} C ${start.x + 70} ${start.y + 80}, ${end.x + 70} ${end.y - 40}, ${end.x + 70} ${end.y - 5}`}
                                    stroke={commitColor}
                                    strokeWidth={isSecondary ? "2" : "3"}
                                    strokeDasharray={isSecondary ? "4,4" : "none"}
                                    fill="none"
                                    opacity={isSecondary ? 0.6 : 1}
                                />
                            );
                        });
                    })}

                    {/* Dangling threads for branches */}
                    {/* Dangling threads for branches */}
                    {(() => {
                        // Group branches by commit to handle overlaps
                        const branchesByCommit = {};
                        Object.entries(branches).forEach(([name, commitId]) => {
                            if (!branchesByCommit[commitId]) branchesByCommit[commitId] = [];
                            branchesByCommit[commitId].push(name);
                        });

                        return Object.entries(branchesByCommit).map(([commitId, branchNames]) => {
                            const pos = positions[commitId];
                            if (!pos) return null;

                            return branchNames.map((name, index) => {
                                // Calculate offset based on index
                                const yBase = 100;
                                const yStep = 30;
                                const yOffset = yBase + (index * yStep);

                                const branchColor = getBranchColor(name, branches);
                                const isActive = head.type === 'branch' && head.ref === name;

                                return (
                                    <g key={name}>
                                        <path
                                            d={`M ${pos.x + 70} ${pos.y + 50} Q ${pos.x + 70} ${pos.y + yOffset} ${pos.x + 140} ${pos.y + yOffset}`}
                                            stroke={branchColor}
                                            strokeWidth={isActive ? "3" : "2"}
                                            fill="none"
                                            strokeDasharray="4,4"
                                            filter={isActive ? "url(#glow)" : "none"}
                                        />
                                        <text
                                            x={pos.x + 145}
                                            y={pos.y + yOffset + 5}
                                            fill={branchColor}
                                            fontSize="12"
                                            fontWeight="bold"
                                            fontFamily="monospace"
                                            filter={isActive ? "url(#glow)" : "none"}
                                        >
                                            {name}
                                        </text>
                                    </g>
                                );
                            });
                        });
                    })()}
                </svg>

                {commits.map(c => {
                    const pos = positions[c.id];
                    const isActive = head.ref === c.id || (head.type === 'branch' && branches[head.ref] === c.id);
                    const commitColor = getBranchColor(c.branch || 'main', branches);

                    return (
                        <div
                            key={c.id}
                            className={`note ${isActive ? 'active' : ''}`}
                            style={{
                                left: pos.x,
                                top: pos.y,
                                transform: `rotate(${Math.random() * 6 - 3}deg)`,
                                borderColor: commitColor,
                                '--commit-color': commitColor
                            }}
                        >
                            <div className="pin" style={{ background: `radial-gradient(circle at 30% 30%, ${commitColor}, ${commitColor}88)` }} />
                            <div className="note-header">
                                <span>{c.id.substr(0, 6)}</span>
                            </div>
                            <div className="note-msg">{c.message}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
