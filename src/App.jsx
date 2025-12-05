import React from 'react';
import { useGit } from './hooks/useGit';
import { GitVisualizer } from './components/GitVisualizer';
import { GitConsole } from './components/GitConsole';

function App() {
  const { state, executeCommand } = useGit();

  return (
    <div className="app-container">
      <GitConsole history={state.commandHistory} onExecute={executeCommand} />
      <GitVisualizer state={state} />
    </div>
  );
}

export default App;
