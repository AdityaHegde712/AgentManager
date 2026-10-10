import { execFile } from "node:child_process";
import { promisify } from "node:util";


const execFileAsync = promisify(execFile);


export type FolderPickerResult = {
  canceled: boolean;
  path: string | null;
};


export type FolderPickerRunner = () => Promise<FolderPickerResult>;


export type PickFolderOptions = {
  runner?: FolderPickerRunner;
  execFileFn?: (
    file: string,
    args: string[],
    options: { windowsHide?: boolean },
  ) => Promise<{ stdout: string; stderr: string }>;
  platform?: NodeJS.Platform;
};


const POWERSHELL_COMMAND =
  "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; " +
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; " +
  "$dialog.Description = 'Select Project Directory'; " +
  "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }";


export async function pickFolder(options?: PickFolderOptions | FolderPickerRunner): Promise<FolderPickerResult> {
  if (typeof options === "function") {
    return options();
  }
  if (options?.runner) {
    return options.runner();
  }

  const platform = options?.platform ?? process.platform;
  if (platform !== "win32") {
    return { canceled: true, path: null };
  }

  const exec = options?.execFileFn ?? (async (file, args, opts) => execFileAsync(file, args, opts));

  try {
    const { stdout } = await exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", POWERSHELL_COMMAND],
      { windowsHide: true },
    );

    const selectedPath = stdout.trim();
    if (selectedPath) {
      return { canceled: false, path: selectedPath };
    }

    return { canceled: true, path: null };
  } catch {
    return { canceled: true, path: null };
  }
}
