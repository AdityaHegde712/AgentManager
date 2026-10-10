import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

import "@xterm/xterm/css/xterm.css";


type TerminalPanelProps = {
  terminalUrl: string | undefined;
  onExit: () => void;
};


export function TerminalPanel({ terminalUrl, onExit }: TerminalPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (!terminalUrl || !containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontSize: 13,
      theme: { background: "#0b0f13", foreground: "#dce7ec", cursor: "#8bd5ca" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    fit.fit();

    const socket = new WebSocket(terminalUrl);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; data?: string };
      if (message.type === "output") {
        terminal.write(message.data ?? "");
      }
      if (message.type === "exit") {
        terminal.writeln("\r\n[Codex session ended]");
        onExit();
      }
    });
    terminal.onData((data) => socket.send(JSON.stringify({ type: "input", data })));
    const resize = () => {
      fit.fit();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      }
    };
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      socket.close();
      terminal.dispose();
    };
  }, [terminalUrl, onExit]);


  if (!terminalUrl) {
    return <div className="terminal-empty">Approve a brief, then launch a Codex resume picker.</div>;
  }

  return <div className="terminal-canvas" ref={containerRef} aria-label="Codex terminal" />;
}
