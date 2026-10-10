type RequestTokenInput = {
  headerToken: string | undefined;
  queryToken: string | undefined;
  websocketUpgrade: boolean;
};


export function selectRequestToken(input: RequestTokenInput): string | undefined {
  return input.websocketUpgrade ? input.queryToken : input.headerToken;
}
