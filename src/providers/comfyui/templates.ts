import type { WorkflowGraph } from '../shared/comfy.js'

/**
 * Minimal SDXL text-to-image workflow. Substitute `$PROMPT`, `$NEGATIVE`,
 * `$WIDTH`, `$HEIGHT`, `$SEED` before use. This template assumes the user
 * has `sd_xl_base_1.0.safetensors` installed under their ComfyUI
 * checkpoints folder. Users with a different setup should pass
 * `--workflow <path.json>` with their own graph.
 */
export function defaultImageWorkflow(args: {
  prompt: string
  negative?: string
  width?: number
  height?: number
  seed?: number
  checkpoint?: string
}): WorkflowGraph {
  const width = args.width ?? 1024
  const height = args.height ?? 1024
  const seed = args.seed ?? Math.floor(Math.random() * 2 ** 31)
  const checkpoint = args.checkpoint ?? 'sd_xl_base_1.0.safetensors'
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: args.prompt, clip: ['4', 1] },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { text: args.negative ?? '', clip: ['4', 1] },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['4', 2] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'morphix', images: ['8', 0] },
    },
  }
}
