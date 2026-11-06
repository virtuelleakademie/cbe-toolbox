/**
 * Shared model construction primitive — ADAPTER module (capability
 * `agent-harness`, Requirements: *Pi Runtime Is Hidden Behind a CBE-Owned Port*
 * and *Embedded Pi Runtime Configuration Is Explicit and Versioned*).
 *
 * Both session policies — the main conversation and the isolated atomization
 * session — build their model binding here: one public `ModelRuntime` per
 * session (auth file under the host's agent home, no `models.json`, no catalog
 * network), the BYO provider registered on it, and the resolved model. The SAME
 * runtime instance is passed to `createAgentSession` and used for a live
 * provider re-bind. Sharing the PRIMITIVE does not merge the policies: each
 * caller still decides its own tools, persistence and writable roots.
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerProvider } from "../provider.js";
import type { ProviderConfig } from "./contracts.js";
import { createPiModelRuntime } from "./pi-config.js";

type PiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

/** A session's model binding: what `createAgentSession` needs, plus a re-bind. */
export interface PiModelBinding {
  modelRuntime: ModelRuntime;
  model: PiModel;
  /** The registered provider name (constant `byo-llm`). */
  provider: string;
  modelId: string;
  /**
   * Re-register the provider with a new config on the SAME runtime and resolve
   * the new model. `registerProvider` validates the config before applying it,
   * so an invalid config throws without mutating the runtime.
   */
  resolve(next: ProviderConfig): PiModel;
}

export async function createPiModelBinding(config: ProviderConfig, agentDir: string): Promise<PiModelBinding> {
  const modelRuntime = await createPiModelRuntime(agentDir);
  const resolve = (next: ProviderConfig) => {
    const { provider, modelId } = registerProvider(modelRuntime, next);
    const model = modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error(`Model ${provider}/${modelId} not registered`);
    return model;
  };
  const model = resolve(config);
  return { modelRuntime, model, provider: model.provider, modelId: config.modelId, resolve };
}
