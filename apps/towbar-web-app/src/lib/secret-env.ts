export function serializeSecretEnv(entries: Array<[string, string]>) {
  return entries
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
}

export function parseSecretEnv(text: string) {
  const values = new Map<string, string>();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    const fail = (message: string): never => {
      throw new Error(`Line ${index + 1}: ${message}`);
    };
    if (!match) fail("Use KEY=value.");
    const [, key, raw] = match!;
    if (values.has(key!)) fail(`Duplicate variable ${key}.`);
    if (values.size >= 200) fail("Use at most 200 variables.");
    let value = raw!;
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      let end = -1;
      for (let cursor = 1; ; cursor++) {
        if (cursor >= value.length) {
          if (++index >= lines.length) fail("Close the quoted value.");
          value += "\n" + lines[index];
        }
        if (value[cursor] === "\\" && quote === '"') {
          cursor++;
          continue;
        }
        if (value[cursor] === quote) {
          end = cursor;
          break;
        }
      }
      const tail = value.slice(end + 1).trim();
      if (tail && !tail.startsWith("#"))
        fail("Unexpected text after quoted value.");
      value = value.slice(1, end);
      if (quote === '"')
        value = value.replace(
          /\\(u[0-9a-fA-F]{4}|[\\"nrtbf])/g,
          (_, escaped: string) => JSON.parse('"\\' + escaped + '"') as string,
        );
    } else {
      value = value.split("#")[0]!.trim();
    }
    values.set(key!, value);
  }
  return values;
}
