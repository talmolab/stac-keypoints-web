// Shared YAML-export runner. Used by:
//   - Toolbar's "Export" / "Save As" buttons
//   - useKeyboardShortcuts (Cmd-S, Cmd-Shift-S)
//
// Output goes through one of two paths:
//   1. File System Access API — Chrome/Edge get save-in-place. The handle
//      is held in memory for the session, so subsequent Cmd-S writes through
//      without re-prompting. `forcePicker` (Cmd-Shift-S / Save As) drops the
//      cached handle and re-prompts.
//   2. Blob download fallback — Firefox/Safari get the original behaviour:
//      every export downloads a fresh file.
import { useStore } from "./store";
import * as api from "./api";
import { validateMappings } from "./validation";

interface FileSystemWritableFileStream {
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandle {
  name: string;
  createWritable(): Promise<FileSystemWritableFileStream>;
}
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
type ShowSaveFilePicker = (opts?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;

function fsaSupported(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

let mainHandle: FileSystemFileHandle | null = null;
let sidecarHandle: FileSystemFileHandle | null = null;

function downloadYaml(body: string, filename: string) {
  const blob = new Blob([body], { type: "application/x-yaml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function writeViaFsa(handle: FileSystemFileHandle, body: string): Promise<void> {
  const w = await handle.createWritable();
  await w.write(body);
  await w.close();
}

async function pickHandle(suggestedName: string): Promise<FileSystemFileHandle> {
  const picker = (window as unknown as { showSaveFilePicker: ShowSaveFilePicker }).showSaveFilePicker;
  return picker({
    suggestedName,
    types: [{ description: "YAML config", accept: { "application/x-yaml": [".yaml", ".yml"] } }],
  });
}

/** Forget cached file handles. Called on Cmd-Shift-S (Save As) and when the
 *  user loads a new dataset, so the next save re-prompts. */
export function resetExportHandles(): void {
  mainHandle = null;
  sidecarHandle = null;
}

export interface RunExportOptions {
  /** Force the FSA picker even if a handle is already cached. Used by Save As. */
  forcePicker?: boolean;
}

/** Run pre-export validation, build the config payload, fetch main + sidecar
 *  YAML, write via FSA when supported (else fall back to blob download), and
 *  update the status banner. Returns true on success (warnings allowed). */
export async function runExport(opts: RunExportOptions = {}): Promise<boolean> {
  const state = useStore.getState();
  const setIkStatus = state.setIkStatus;

  const { errors, warnings } = validateMappings({
    mappings: state.mappings,
    bodyNames: state.bodyNames,
    acmKeypointNames: state.acmKeypointNames,
  });
  if (errors.length > 0) {
    setIkStatus(`Export blocked: ${errors.length} error(s). First: ${errors[0]}`);
    return false;
  }

  const pairs: Record<string, string> = {};
  for (const m of state.mappings) pairs[m.keypointName] = m.bodyName;
  const offsetMap: Record<string, [number, number, number]> = {};
  for (const o of state.offsets) offsetMap[o.keypointName] = [o.x, o.y, o.z];
  const config: Record<string, unknown> = {
    keypointModelPairs: pairs,
    keypointInitialOffsets: offsetMap,
    scaleFactor: state.scaleFactor,
    mocapScaleFactor: state.mocapScaleFactor,
    xmlPath: state.xmlPath || "",
    xmlBasename: state.xmlBasename,
    kpNames: state.acmKeypointNames,
    segmentScales: state.segmentScales,
  };
  if (state.rawTemplate) config._rawTemplate = state.rawTemplate;

  let mainBody: string;
  let sidecarBody: string | null;
  try {
    [mainBody, sidecarBody] = await Promise.all([
      api.exportConfig(config),
      api.exportUiSidecar(config),
    ]);
  } catch (e) {
    setIkStatus("Export error: " + (e as Error).message);
    return false;
  }

  if (opts.forcePicker) resetExportHandles();

  if (fsaSupported()) {
    try {
      if (!mainHandle) mainHandle = await pickHandle("stac_retarget_config.yaml");
      await writeViaFsa(mainHandle, mainBody);
      if (sidecarBody) {
        if (!sidecarHandle) sidecarHandle = await pickHandle("stac_retarget_config.ui.yaml");
        await writeViaFsa(sidecarHandle, sidecarBody);
      }
      const where = sidecarHandle
        ? `${mainHandle.name} + ${sidecarHandle.name}`
        : mainHandle.name;
      const base = `Saved to ${where}.`;
      setIkStatus(
        warnings.length > 0
          ? `${base} ${warnings.length} warning(s): ${warnings[0]}`
          : base,
      );
      return true;
    } catch (e) {
      // User cancelled the picker — not an error, just bail quietly.
      if ((e as Error).name === "AbortError") {
        setIkStatus("Save cancelled.");
        return false;
      }
      // Permission denied or write failed — fall through to download.
      setIkStatus("FSA write failed, falling back to download: " + (e as Error).message);
      resetExportHandles();
    }
  }

  downloadYaml(mainBody, "stac_retarget_config.yaml");
  if (sidecarBody) downloadYaml(sidecarBody, "stac_retarget_config.ui.yaml");
  const base = sidecarBody ? "Config + UI sidecar downloaded." : "Config downloaded.";
  setIkStatus(
    warnings.length > 0
      ? `${base} ${warnings.length} warning(s): ${warnings[0]}`
      : base,
  );
  return true;
}
