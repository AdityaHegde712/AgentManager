const terminalSessionCookieName = "agent_runner_terminal";
const terminalSessionPath = "/api/v1/terminals";


export function createTerminalSessionCookie(token: string): string {
  return `${terminalSessionCookieName}=${token}; HttpOnly; SameSite=Strict; Path=${terminalSessionPath}`;
}


export function readTerminalSessionToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const cookiePrefix = `${terminalSessionCookieName}=`;
  for (const cookie of cookieHeader.split(";")) {
    const trimmedCookie = cookie.trim();
    if (trimmedCookie.startsWith(cookiePrefix)) {
      return trimmedCookie.slice(cookiePrefix.length);
    }
  }

  return undefined;
}
