import { parseArgs } from '../utils/args.js'
import { loadConfig } from '../config/file.js'
import { maskSecret } from '../auth/keystore.js'
import { needsApiKey, PROVIDER_IDS, type ProviderId } from '../config/schema.js'
import { providerConfigFromEnv } from '../config/env.js'
import { httpJson } from '../utils/http.js'
import { ProviderHttpError } from '../utils/errors.js'
import { emitResult, type RunContext } from '../utils/envelope.js'
import { CommandSpec } from './spec.js'

export const spec: CommandSpec = {
  name: 'quota',
  summary: 'Per-provider usage / readiness lookup.',
  outputs: [
    {
      kind: 'json',
      description:
        'Array of {provider, ready, supported, data?, reason?, source}. Calls real usage endpoints when an admin key is available; falls back to readiness only.',
    },
  ],
  examples: ['mx quota', 'mx quota --json | jq ".data[] | {provider, supported, reason}"'],
}

interface QuotaResult {
  provider: ProviderId
  ready: boolean
  supported: boolean
  source: 'env' | 'file' | 'none'
  key?: string
  endpoint?: string
  data?: Record<string, unknown>
  reason?: string
  hint?: string
}

export async function quotaCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { flags } = parseArgs(argv)
  if (flags.help) {
    printHelp()
    return
  }

  const config = await loadConfig()
  const results: QuotaResult[] = []

  for (const id of PROVIDER_IDS) {
    const file = config.providers[id] ?? {}
    const env = providerConfigFromEnv(id)
    const apiKey = env.apiKey ?? file.apiKey
    const endpoint = env.endpoint ?? file.endpoint
    const ready = needsApiKey(id) ? !!apiKey : !!endpoint
    const source: 'env' | 'file' | 'none' = env.apiKey || env.endpoint
      ? 'env'
      : file.apiKey || file.endpoint
        ? 'file'
        : 'none'

    const base: QuotaResult = {
      provider: id,
      ready,
      supported: false,
      source,
    }
    if (needsApiKey(id)) base.key = maskSecret(apiKey)
    else base.endpoint = endpoint ?? undefined

    if (!ready) {
      results.push({ ...base, reason: 'no_credential' })
      continue
    }

    try {
      const lookup = await fetchUsage(id, apiKey, endpoint)
      results.push({ ...base, ...lookup })
    } catch (err) {
      if (err instanceof ProviderHttpError) {
        const reason =
          err.status === 401 || err.status === 403 ? 'admin_key_required' : 'http_error'
        results.push({
          ...base,
          supported: false,
          reason,
          data: { httpStatus: err.status },
          hint:
            reason === 'admin_key_required'
              ? `${id} usage endpoint requires an organization Admin key (sk-admin-… style).`
              : undefined,
        })
        continue
      }
      results.push({ ...base, supported: false, reason: 'unknown_error' })
    }
  }

  if (ctx.json) {
    emitResult(ctx, 'quota', results)
    return
  }

  console.log('Provider readiness + usage:\n')
  for (const r of results) {
    const detail = needsApiKey(r.provider) ? `key=${r.key}` : `endpoint=${r.endpoint ?? '(none)'}`
    const summary = r.supported
      ? formatUsage(r.provider, r.data ?? {})
      : `unsupported (${r.reason ?? 'n/a'})`
    console.log(`  ${r.provider.padEnd(10)}  ready=${r.ready}  ${detail}`)
    console.log(`              ${summary}`)
  }
  console.log(
    `\nNote: real usage requires an organization Admin key for OpenAI/Anthropic.`,
  )
}

async function fetchUsage(
  id: ProviderId,
  apiKey: string | undefined,
  endpoint: string | undefined,
): Promise<Partial<QuotaResult>> {
  switch (id) {
    case 'openai':
      return await openAiUsage(apiKey)
    case 'anthropic':
      return await anthropicUsage(apiKey)
    case 'gemini':
      return {
        supported: false,
        reason: 'no_api',
        hint: 'Gemini does not expose a public usage API; check https://aistudio.google.com/app/usage',
      }
    case 'ollama':
    case 'comfyui':
      return await localPing(id, endpoint)
    case 'piapi':
      return {
        supported: false,
        reason: 'no_api',
        hint: 'PiAPI credits dashboard: https://piapi.ai/workspace',
      }
    case 'typecast':
      return {
        supported: false,
        reason: 'no_api',
        hint: 'Typecast usage dashboard: https://app.typecast.ai/',
      }
  }
}

async function openAiUsage(apiKey: string | undefined): Promise<Partial<QuotaResult>> {
  if (!apiKey) return { supported: false, reason: 'no_credential' }
  const now = Math.floor(Date.now() / 1000)
  const sevenDaysAgo = now - 7 * 24 * 60 * 60
  // Try the modern Admin Costs endpoint first; on auth failure fall back to
  // the legacy /v1/usage endpoint which some org keys can still reach.
  try {
    const json = (await httpJson({
      provider: 'openai',
      url: `https://api.openai.com/v1/organization/costs?start_time=${sevenDaysAgo}&limit=7`,
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
    })) as {
      data?: Array<{
        results?: Array<{ amount?: { value?: number; currency?: string } }>
      }>
    }
    let totalUsd = 0
    let currency = 'usd'
    for (const bucket of json.data ?? []) {
      for (const r of bucket.results ?? []) {
        totalUsd += r.amount?.value ?? 0
        if (r.amount?.currency) currency = r.amount.currency
      }
    }
    return {
      supported: true,
      data: { window: 'last_7_days', totalCost: totalUsd, currency, source: 'organization/costs' },
    }
  } catch (err) {
    if (err instanceof ProviderHttpError && (err.status === 401 || err.status === 403)) {
      // Legacy fallback (some accounts still allow it).
      const today = new Date().toISOString().slice(0, 10)
      const json = (await httpJson({
        provider: 'openai',
        url: `https://api.openai.com/v1/usage?date=${today}`,
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
      })) as Record<string, unknown>
      return { supported: true, data: { window: 'today', source: '/v1/usage', raw: json } }
    }
    throw err
  }
}

async function anthropicUsage(apiKey: string | undefined): Promise<Partial<QuotaResult>> {
  if (!apiKey) return { supported: false, reason: 'no_credential' }
  const startingAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const json = (await httpJson({
    provider: 'anthropic',
    url: `https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=${encodeURIComponent(startingAt)}`,
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  })) as { data?: Array<Record<string, unknown>> }
  let inputTokens = 0
  let outputTokens = 0
  for (const row of json.data ?? []) {
    const it = row.uncached_input_tokens
    const ot = row.output_tokens
    if (typeof it === 'number') inputTokens += it
    if (typeof ot === 'number') outputTokens += ot
  }
  return {
    supported: true,
    data: { window: 'last_7_days', inputTokens, outputTokens, source: 'organizations/usage_report/messages' },
  }
}

async function localPing(
  id: 'ollama' | 'comfyui',
  endpoint: string | undefined,
): Promise<Partial<QuotaResult>> {
  if (!endpoint) return { supported: false, reason: 'no_endpoint' }
  const url = id === 'ollama' ? `${endpoint}/api/tags` : `${endpoint}/system_stats`
  try {
    const res = await fetch(url, { method: 'GET' })
    return {
      supported: true,
      data: {
        kind: 'local',
        reachable: res.ok,
        httpStatus: res.status,
        endpoint,
      },
    }
  } catch (err) {
    return {
      supported: false,
      reason: 'unreachable',
      data: { endpoint, error: (err as Error).message },
    }
  }
}

function formatUsage(provider: string, data: Record<string, unknown>): string {
  if (provider === 'openai' && typeof data.totalCost === 'number') {
    return `cost=${(data.totalCost as number).toFixed(4)} ${data.currency} (${data.window})`
  }
  if (provider === 'anthropic' && typeof data.inputTokens === 'number') {
    return `tokens in=${data.inputTokens} out=${data.outputTokens} (${data.window})`
  }
  if (data.kind === 'local') {
    return `local: reachable=${data.reachable} status=${data.httpStatus}`
  }
  return JSON.stringify(data)
}

function printHelp(): void {
  console.log(`Usage: mx quota [--json]

  Show per-provider readiness AND real usage where the provider exposes an
  endpoint:
    openai     /v1/organization/costs (Admin key required) → fallback /v1/usage
    anthropic  /v1/organizations/usage_report/messages (Admin key required)
    gemini     no public API — check https://aistudio.google.com/app/usage
    ollama     local /api/tags ping
    comfyui    local /system_stats ping
`)
}
