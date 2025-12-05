import React, { useState, useRef, useEffect } from 'react';
import './GitConsole.css';

export function GitConsole({ history, onExecute }) {
    const [input, setInput] = useState('');
    const endRef = useRef(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            if (input.trim()) {
                onExecute(input);
                setInput('');
            }
        }
    };

    return (
        <div className="console-container">
            <div className="console-history">
                <div className="console-entry">
                    <div className="console-output success">
                        Welcome to Git Visualizer v1.0
                        Type 'git commit -m "msg"' to start.
                    </div>
                </div>
                {history.map((entry, i) => (
                    <div key={i} className="console-entry">
                        <div className="console-cmd">$ {entry.cmd}</div>
                        {entry.output && (
                            <div className={`console-output ${entry.status}`}>
                                {entry.output}
                            </div>
                        )}
                    </div>
                ))}
                <div ref={endRef} />
            </div>
            <div className="console-input-wrapper">
                <span className="console-prompt">➜</span>
                <input
                    className="console-input"
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="git commit -m 'Initial commit'..."
                    autoFocus
                />
            </div>
        </div>
    );
}
