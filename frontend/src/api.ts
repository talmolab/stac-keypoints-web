/**
 * API module — standalone browser mode.
 * Re-exports all functions from localApi which run entirely in the browser.
 */
export {
  loadXml,
  loadAcmTrials,
  loadMatFile,
  loadConfig,
  exportConfig,
  alignToMujoco,
  suggestFrames,
  bodyTransforms,
  loadStacOutput,
  runQuickStac,
  setApiBase,
  getCurrentApiBase,
} from "./localApi";
