export function createLaunchUrl(host: string, port: number, token: string): string {
  return `http://${host}:${port}/#token=${encodeURIComponent(token)}`;
}
