import { parseArgs, getString } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { configPath, loadConfig, loadRawConfig, saveConfig, setByPath } from '../config/file.js'
import { maskSecret } from '../auth/keystore.js'
import { CAPABILITIES, PROVIDER_IDS } from '../config/schema.js'
import { emitResult, type RunContext } from '../utils/envelope.js'
import { CommandSpec } from './spec.js'

export const spec: CommandSpec = {
  name: 'config',
  summary: 'Read and write the on-disk Morphix config.',
  subcommands: [
    {
      name: 'show',
      summary: 'Print the merged config (secrets masked).',
      outputs: [{ kind: 'json', description: 'Merged MorphixConfig with masked api keys.' }],
    },
    {
      name: 'set',
      summary: 'Set a dot-path config value.',
      flags: [
        { name: 'key', type: 'string', required: true, description: 'Dot-path, e.g. defaults.text.provider.' },
        { name: 'value', type: 'string', required: true, description: 'New value.' },
      ],
    },
    {
      name: 'path',
      summary: 'Print the config file path.',
      outputs: [{ kind: 'text', description: 'Absolute path on stdout.' }],
    },
    {
      name: 'export-schema',
      summary: 'Emit a JSON Schema (Draft-07) describing MorphixConfig.',
      outputs: [{ kind: 'json', description: 'JSON Schema document for editor autocomplete.' }],
    },
  ],
}

export async function configCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printHelp()
    return
  }
  switch (sub) {
    case 'show':
      await doShow(ctx)
      return
    case 'set':
      await doSet(flags, ctx)
      return
    case 'path':
      if (ctx.json) emitResult(ctx, 'config.path', { path: configPath() })
      else console.log(configPath())
      return
    case 'export-schema':
      await doExportSchema(ctx)
      return
    default:
      throw new MorphixError(`Unknown 'config' subcommand: '${sub}'`, {
        code: 'E_BAD_SUBCMD',
        exitCode: 64,
        hint: `Available: show, set, path, export-schema`,
      })
  }
}

async function doShow(ctx: RunContext): Promise<void> {
  const config = await loadConfig()
  const clone = structuredClone(config)
  for (const id of Object.keys(clone.providers)) {
    const p = clone.providers[id]
    if (p?.apiKey) p.apiKey = maskSecret(p.apiKey)
  }
  if (ctx.json) emitResult(ctx, 'config.show', clone)
  else console.log(JSON.stringify(clone, null, 2))
}

async function doSet(flags: Record<string, unknown>, ctx: RunContext): Promise<void> {
  const key = getString(flags as Parameters<typeof getString>[0], 'key')
  const value = getString(flags as Parameters<typeof getString>[0], 'value')
  if (!key || value === undefined) {
    throw new MorphixError(`--key and --value are required.`, {
      code: 'E_BAD_ARGS',
      exitCode: 64,
      hint:
        `Examples:\n` +
        `  mx config set --key defaults.text.provider --value openai\n` +
        `  mx config set --key defaults.video.model --value veo-3.0\n` +
        `  mx config set --key providers.ollama.endpoint --value http://localhost:11434`,
    })
  }
  const raw = await loadRawConfig()
  setByPath(raw, key, value)
  const path = await saveConfig(raw)
  if (ctx.json) emitResult(ctx, 'config.set', { key, value: key.includes('apiKey') ? '(hidden)' : value, path })
  else {
    console.log(`Set ${key} = ${key.includes('apiKey') ? '(hidden)' : value}`)
    console.log(`  in ${path}`)
  }
}

async function doExportSchema(ctx: RunContext): Promise<void> {
  const schema = buildJsonSchema()
  if (ctx.json) emitResult(ctx, 'config.export-schema', schema)
  else console.log(JSON.stringify(schema, null, 2))
}

/**
 * Hand-rolled JSON Schema (Draft-07) for MorphixConfig. Kept colocated with
 * the actual TypeScript shape so drift is visible — when adding a field to
 * MorphixConfig, mirror it here too.
 */
function buildJsonSchema(): Record<string, unknown> {
  const featureDefault = {
    type: 'object',
    properties: {
      provider: { type: 'string', enum: [...PROVIDER_IDS] },
      model: { type: 'string' },
    },
    additionalProperties: false,
  }

  const providerConfig = {
    type: 'object',
    properties: {
      apiKey: { type: 'string' },
      endpoint: { type: 'string', format: 'uri' },
      extra: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
    },
    additionalProperties: false,
  }

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://morphix.dev/schemas/config.json',
    title: 'MorphixConfig',
    type: 'object',
    required: ['version'],
    properties: {
      version: { type: 'integer', const: 1 },
      defaults: {
        type: 'object',
        properties: Object.fromEntries(CAPABILITIES.map((c) => [c, featureDefault])),
        additionalProperties: false,
      },
      providers: {
        type: 'object',
        properties: Object.fromEntries(PROVIDER_IDS.map((p) => [p, providerConfig])),
        additionalProperties: providerConfig,
      },
      outputDir: { type: 'string' },
    },
    additionalProperties: false,
  }
}

function printHelp(): void {
  console.log(`Usage: mx config <show|set|path|export-schema> [options]

  show                       Print the merged config (secrets are masked).
  set --key <path> --value <v>
                             Set a dot-path value. Examples:
                               defaults.<feature>.provider
                               defaults.<feature>.model
                               providers.<id>.endpoint
                               providers.<id>.apiKey
                               providers.comfyui.extra.workflow
                               providers.comfyui.extra.coverWorkflow
                               outputDir
  path                       Print the path to the config file.
  export-schema              Emit JSON Schema (Draft-07) for the config file.
                             Useful for editor autocomplete.
`)
}
