/**
 * `mx schema` — dump a machine-readable manifest of the entire CLI.
 * `mx list providers|models|capabilities` — focused lookups.
 *
 * Designed so an LLM agent can run `mx schema --json` once and build a
 * complete mental model of what commands, flags, providers, models, and
 * error codes exist without parsing help text.
 */
import { parseArgs, getString } from '../utils/args.js'
import type { RunContext } from '../utils/envelope.js'
import { emitResult } from '../utils/envelope.js'
import { MorphixError, ERROR_CODES } from '../utils/errors.js'
import {
  CAPABILITIES,
  PROVIDER_IDS,
  PROVIDER_DEFAULT_MODELS,
  isProviderId,
  needsApiKey,
  apiKeyEnvName,
} from '../config/schema.js'
import { GLOBAL_FLAGS, type CommandSpec } from './spec.js'

import { spec as textSpec } from './text.js'
import { spec as imageSpec } from './image.js'
import { spec as videoSpec } from './video.js'
import { spec as speechSpec } from './speech.js'
import { spec as musicSpec } from './music.js'
import { spec as visionSpec } from './vision.js'
import { spec as searchSpec } from './search.js'
import { spec as authSpec } from './auth.js'
import { spec as configSpec } from './config.js'
import { spec as quotaSpec } from './quota.js'
import { spec as updateSpec } from './update.js'

const VERSION = '0.1.0'

function allCommandSpecs(): CommandSpec[] {
  return [
    textSpec,
    imageSpec,
    videoSpec,
    speechSpec,
    musicSpec,
    visionSpec,
    searchSpec,
    authSpec,
    configSpec,
    quotaSpec,
    updateSpec,
    schemaSpec,
    listSpec,
  ]
}

export const schemaSpec: CommandSpec = {
  name: 'schema',
  summary: 'Print a JSON manifest of all commands, providers, and error codes.',
  outputs: [
    {
      kind: 'json',
      description: 'Full CLI manifest.',
      shape: '{version, commands, providers, capabilities, defaults, errorCodes, globalFlags}',
    },
  ],
  examples: ['mx schema', 'mx schema | jq .commands[].name'],
}

export const listSpec: CommandSpec = {
  name: 'list',
  summary: 'List providers, models, or capabilities.',
  subcommands: [
    {
      name: 'providers',
      summary: 'Enumerate supported provider ids.',
      outputs: [{ kind: 'json', description: 'Array of provider descriptors.' }],
    },
    {
      name: 'models',
      summary: 'Enumerate default models, optionally filtered by provider.',
      flags: [
        {
          name: 'provider',
          type: 'string',
          description: 'Limit to this provider.',
          enum: PROVIDER_IDS,
        },
        {
          name: 'capability',
          type: 'string',
          description: 'Limit to this capability.',
          enum: CAPABILITIES,
        },
      ],
      outputs: [{ kind: 'json', description: 'Array of {provider, capability, model}.' }],
    },
    {
      name: 'capabilities',
      summary: 'Enumerate content capabilities the CLI can drive.',
      outputs: [{ kind: 'json', description: 'Array of capability strings.' }],
    },
  ],
  examples: [
    'mx list providers',
    'mx list models --provider openai',
    'mx list capabilities',
  ],
}

function buildManifest(): Record<string, unknown> {
  return {
    version: VERSION,
    globalFlags: GLOBAL_FLAGS,
    commands: allCommandSpecs(),
    providers: PROVIDER_IDS.map((id) => ({
      id,
      needsApiKey: needsApiKey(id),
      apiKeyEnv: needsApiKey(id) ? apiKeyEnvName(id) : undefined,
      defaultModels: PROVIDER_DEFAULT_MODELS[id],
      capabilities: Object.keys(PROVIDER_DEFAULT_MODELS[id]),
    })),
    capabilities: CAPABILITIES,
    defaults: PROVIDER_DEFAULT_MODELS,
    errorCodes: ERROR_CODES,
  }
}

export async function schemaCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { flags } = parseArgs(argv)
  if (flags.help) {
    printSchemaHelp()
    return
  }
  const manifest = buildManifest()
  if (ctx.json) {
    emitResult(ctx, 'schema', manifest)
    return
  }
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n')
}

export async function listCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printListHelp()
    return
  }

  if (sub === 'providers') {
    const data = PROVIDER_IDS.map((id) => ({
      id,
      needsApiKey: needsApiKey(id),
      apiKeyEnv: needsApiKey(id) ? apiKeyEnvName(id) : undefined,
      capabilities: Object.keys(PROVIDER_DEFAULT_MODELS[id]),
    }))
    if (ctx.json) emitResult(ctx, 'list.providers', data)
    else printProvidersTable(data)
    return
  }

  if (sub === 'models') {
    const providerFilter = getString(flags, 'provider')
    const capabilityFilter = getString(flags, 'capability')
    const rows: Array<{ provider: string; capability: string; model: string }> = []
    for (const provider of PROVIDER_IDS) {
      if (providerFilter && provider !== providerFilter) continue
      const models = PROVIDER_DEFAULT_MODELS[provider]
      for (const [capability, model] of Object.entries(models)) {
        if (capabilityFilter && capability !== capabilityFilter) continue
        rows.push({ provider, capability, model: model as string })
      }
    }
    if (ctx.json) emitResult(ctx, 'list.models', rows)
    else {
      for (const r of rows) {
        console.log(`  ${r.provider.padEnd(10)} ${r.capability.padEnd(8)} ${r.model}`)
      }
    }
    return
  }

  if (sub === 'capabilities') {
    if (ctx.json) emitResult(ctx, 'list.capabilities', [...CAPABILITIES])
    else {
      for (const c of CAPABILITIES) console.log(`  ${c}`)
    }
    return
  }

  throw new MorphixError(`Unknown 'list' subcommand: '${sub}'`, {
    code: 'E_BAD_SUBCMD',
    exitCode: 64,
    hint: `Available: providers, models, capabilities`,
  })
}

function printSchemaHelp(): void {
  console.log(`Usage: mx schema [--json]

  Emit a machine-readable JSON manifest of the entire CLI: commands,
  subcommands, flags, providers, capabilities, default models, and the
  complete error-code catalog. Designed for LLM agents to bootstrap
  their knowledge of the CLI without parsing help text.
`)
}

function printListHelp(): void {
  console.log(`Usage: mx list <providers|models|capabilities> [options]

  providers                 Enumerate supported provider ids.
  models [--provider <id>] [--capability <c>]
                            Enumerate default models.
  capabilities              Enumerate content capabilities.

  --json                    Emit results as a single JSON line.
`)
}

function printProvidersTable(
  rows: Array<{ id: string; needsApiKey: boolean; apiKeyEnv?: string; capabilities: string[] }>,
): void {
  for (const r of rows) {
    const cred = r.needsApiKey ? `apiKey (${r.apiKeyEnv})` : 'endpoint-only'
    console.log(`  ${r.id.padEnd(10)}  ${cred.padEnd(24)}  ${r.capabilities.join(', ')}`)
  }
}

// Silence unused-warning for isProviderId; keep the import alive for future
// validation of --provider flag values in list subcommands.
void isProviderId
