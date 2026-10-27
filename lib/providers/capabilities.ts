import { getSetting } from "@/lib/config"
import {
  getProviderMeta,
  parseModelSpec,
  type ModelCapabilities,
} from "@/lib/providers/catalog"

// What a model can actually do, asked of the runtime that serves it.
//
// Xiryn hands every agent a Linux desktop whose actions return screenshots, so
// a text-only model fails the moment an agent looks at its screen — after the
// turn has already spent tokens building up to it. Local runtimes know the
// answer (Ollama's /api/show, LM Studio's /api/v0/models); hosted providers
// don't expose it, so there we return null and the UI says nothing rather than
// guessing wrong.

const TTL = 5 * 60_000

const globalForCapabilities = globalThis as unknown as {
  xirynCapabilities?: Map<string, { at: number; value: ModelCapabilities }>
}
const cache = (globalForCapabilities.xirynCapabilities ??= new Map())

async function getJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

function localRoot(id: "ollama" | "lmstudio") {
  const meta = getProviderMeta(id)!
  return (getSetting(`provider.${id}.baseUrl`) ?? meta.defaultBaseUrl)
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "")
}

async function fromOllama(model: string): Promise<ModelCapabilities | null> {
  const json = (await getJson(`${localRoot("ollama")}/api/show`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model }),
  })) as {
    capabilities?: string[]
    model_info?: Record<string, unknown>
  }
  // Older Ollama builds have no capabilities list: report unknown, not "no"
  const caps = json.capabilities
  if (!Array.isArray(caps)) return null
  const info = json.model_info ?? {}
  const key = Object.keys(info).find((name) => name.endsWith(".context_length"))
  const context = key ? Number(info[key]) : null
  return {
    vision: caps.includes("vision"),
    tools: caps.includes("tools"),
    contextLength: Number.isFinite(context) && context ? context : null,
  }
}

async function fromLmStudio(model: string): Promise<ModelCapabilities | null> {
  const json = (await getJson(`${localRoot("lmstudio")}/api/v0/models`)) as {
    data?: {
      id: string
      type?: string
      capabilities?: string[]
      max_context_length?: number
    }[]
  }
  const found = json.data?.find((entry) => entry.id === model)
  if (!found) return null
  const caps = found.capabilities ?? []
  // LM Studio calls vision models "vlm" and lists tool use as "tool_use"
  return {
    vision: found.type === "vlm" || caps.includes("vision"),
    tools: caps.includes("tool_use") || caps.includes("tools"),
    contextLength: found.max_context_length ?? null,
  }
}

export async function modelCapabilities(spec: string) {
  const parsed = parseModelSpec(spec)
  if (!parsed) return null

  const hit = cache.get(spec)
  if (hit && Date.now() - hit.at < TTL) return hit.value

  let value: ModelCapabilities | null = null
  try {
    if (parsed.provider === "ollama") value = await fromOllama(parsed.model)
    else if (parsed.provider === "lmstudio") value = await fromLmStudio(parsed.model)
  } catch {
    // A local runtime that isn't running is not an error worth showing here
    value = null
  }
  if (value) cache.set(spec, { at: Date.now(), value })
  return value
}
