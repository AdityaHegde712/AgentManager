const launchTokenStorageKey = "agent-runner.launch-token";


type LaunchLocation = Pick<Location, "hash" | "pathname" | "search">;


type SessionStorageLike = Pick<Storage, "getItem" | "setItem">;


export function consumeLaunchToken(
  location: LaunchLocation,
  storage: SessionStorageLike,
  replaceVisibleUrl: (url: string) => void,
): string {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const fragmentToken = fragment.get("token");
  if (fragmentToken) {
    storage.setItem(launchTokenStorageKey, fragmentToken);
    replaceVisibleUrl(`${location.pathname}${location.search}`);
    return fragmentToken;
  }

  return storage.getItem(launchTokenStorageKey) ?? "";
}
