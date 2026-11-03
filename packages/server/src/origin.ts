/** NextRequest normalizes loopback URL hostnames; verify the original Host too. */
export function matchesLocalOrigin(request: Request, origin: string) {
  const configured = new URL(origin),
    actual = new URL(request.url);
  const loopback = (hostname: string) =>
    ["127.0.0.1", "localhost"].includes(hostname);
  return (
    loopback(configured.hostname) &&
    loopback(actual.hostname) &&
    actual.protocol === configured.protocol &&
    actual.port === configured.port &&
    request.headers.get("host")?.toLowerCase() === configured.host
  );
}
