
import React from 'react';
import { CodeBlock } from './CodeBlock.tsx';

export const SudoInstructionBox: React.FC = () => {
    const visudoCommand = `sudo visudo`;
    const lineToAdd = `<your_username> ALL=(ALL) NOPASSWD: /usr/bin/zerotier-cli, /usr/bin/timedatectl`;

    return (
        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200">
            <h4 className="font-bold text-lg mb-2">Action Required: Configure `sudo`</h4>
            <div className="text-sm space-y-2 text-amber-800 dark:text-amber-300">
                <p>
                    To allow this panel to manage system services (like ZeroTier and NTP),
                    you need to grant it passwordless `sudo` access for specific commands.
                </p>
                <ol className="list-decimal list-inside space-y-2 pl-2">
                    <li>SSH into your panel's host machine (your Orange Pi).</li>
                    <li>
                        Run this command to safely edit the sudoers file:
                        <div className="my-2 bg-amber-100 dark:bg-amber-900/50 rounded-md border border-amber-200 dark:border-amber-700/60">
                            <CodeBlock script={visudoCommand} />
                        </div>
                    </li>
                    <li>
                        Scroll to the very bottom of the file and add the following line.
                        <strong className="block">Important: Replace `&lt;your_username&gt;` with the actual username that runs this panel (e.g., `pi`, `orangepi`, or `root`).</strong>
                        <div className="my-2 bg-amber-100 dark:bg-amber-900/50 rounded-md border border-amber-200 dark:border-amber-700/60">
                             <CodeBlock script={lineToAdd} />
                        </div>
                    </li>
                    <li>To save and exit, press <kbd className="font-mono bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">Ctrl+X</kbd>, then <kbd className="font-mono bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">Y</kbd>, then <kbd className="font-mono bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">Enter</kbd>.</li>
                </ol>
            </div>
        </div>
    );
};
