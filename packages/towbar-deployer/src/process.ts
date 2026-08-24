import { execFile } from "node:child_process";

export type CommandResult = { stderr: string; stdout: string };
export type CommandOutputHandlers = {
  onStderr?: (content: string) => Promise<void> | void;
  onStdout?: (content: string) => Promise<void> | void;
};

export async function runCommand(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    input?: string;
    onStderr?: CommandOutputHandlers["onStderr"];
    onStdout?: CommandOutputHandlers["onStdout"];
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
) {
  return await new Promise<CommandResult>((resolve, reject) => {
    let outputError: unknown;
    let outputQueue = Promise.resolve();
    const enqueue = (
      handler: ((content: string) => Promise<void> | void) | undefined,
      content: string,
    ) => {
      if (!handler) return;
      outputQueue = outputQueue.then(async () => {
        try {
          await handler(content);
        } catch (error) {
          outputError ??= error;
        }
      });
    };
    const child = execFile(
      executable,
      args,
      {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: 8 * 1_024 * 1_024,
        signal: options.signal,
        timeout: options.timeoutMs ?? 120_000,
      },
      (error, stdout, stderr) => {
        void outputQueue.then(() => {
          if (error) {
            reject(
              new CommandError(
                `${executable} exited unsuccessfully`,
                String(stdout),
                String(stderr),
                error,
              ),
            );
            return;
          }
          if (outputError) {
            reject(
              outputError instanceof Error
                ? outputError
                : new Error("Command output handler failed", {
                    cause: outputError,
                  }),
            );
            return;
          }
          resolve({ stderr: String(stderr), stdout: String(stdout) });
        });
      },
    );
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (value: string) => {
      enqueue(options.onStdout, value);
    });
    child.stderr?.on("data", (value: string) => {
      enqueue(options.onStderr, value);
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CommandError";
  }
}
