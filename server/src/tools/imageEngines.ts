import { configStore } from "../providers/configStore.js";

/**
 * Free image-generation engines that don't require a credit card:
 *  - pollinations : zero-key, instant (FLUX/turbo). https://pollinations.ai
 *  - huggingface  : free token (no card) — FLUX.1, SDXL, SD3.5, community XL models
 *  - a1111        : local AUTOMATIC1111 / Stable Diffusion Forge (/sdapi/v1/txt2img)
 *  - comfyui      : local ComfyUI (default SDXL workflow)
 * Returns image data URIs.
 */

export type ImageEngine = "pollinations" | "huggingface" | "a1111" | "comfyui";

export interface ImageModel {
  engine: ImageEngine;
  id: string;
  label: string;
  needsKey?: "hf";     // needs a Hugging Face token
  local?: boolean;     // needs a local server URL
}

export const IMAGE_MODELS: ImageModel[] = [
  // Pollinations — completely free, NO key, works immediately.
  { engine: "pollinations", id: "flux", label: "FLUX (Pollinations) · free, no key" },
  { engine: "pollinations", id: "flux-realism", label: "FLUX Realism (Pollinations) · free" },
  { engine: "pollinations", id: "flux-anime", label: "FLUX Anime (Pollinations) · free" },
  { engine: "pollinations", id: "flux-3d", label: "FLUX 3D (Pollinations) · free" },
  { engine: "pollinations", id: "turbo", label: "Turbo (Pollinations) · free" },

  // Hugging Face Inference — free token (no credit card): huggingface.co/settings/tokens
  { engine: "huggingface", id: "black-forest-labs/FLUX.1-schnell", label: "FLUX.1 Schnell", needsKey: "hf" },
  { engine: "huggingface", id: "black-forest-labs/FLUX.1-dev", label: "FLUX.1 Dev (gated)", needsKey: "hf" },
  { engine: "huggingface", id: "stabilityai/stable-diffusion-xl-base-1.0", label: "Stable Diffusion XL (SDXL)", needsKey: "hf" },
  { engine: "huggingface", id: "stabilityai/sdxl-turbo", label: "SDXL Turbo", needsKey: "hf" },
  { engine: "huggingface", id: "stabilityai/stable-diffusion-3.5-large", label: "SD 3.5 Large (gated)", needsKey: "hf" },
  { engine: "huggingface", id: "stabilityai/stable-diffusion-3.5-large-turbo", label: "SD 3.5 Large Turbo", needsKey: "hf" },
  { engine: "huggingface", id: "stabilityai/stable-diffusion-3-medium-diffusers", label: "SD 3 Medium (gated)", needsKey: "hf" },
  { engine: "huggingface", id: "playgroundai/playground-v2.5-1024px-aesthetic", label: "Playground v2.5", needsKey: "hf" },
  { engine: "huggingface", id: "RunDiffusion/Juggernaut-XL-v9", label: "Juggernaut XL", needsKey: "hf" },
  { engine: "huggingface", id: "SG161222/RealVisXL_V4.0", label: "RealVisXL", needsKey: "hf" },
  { engine: "huggingface", id: "Lykon/dreamshaper-xl-1-0", label: "DreamShaper XL", needsKey: "hf" },
  { engine: "huggingface", id: "John6666/pony-diffusion-v6-xl-for-anime-sdxl", label: "Pony Diffusion XL", needsKey: "hf" },
  { engine: "huggingface", id: "cagliostrolab/animagine-xl-3.1", label: "Animagine XL", needsKey: "hf" },
  { engine: "huggingface", id: "emilianJR/epiCRealism", label: "epiCRealism", needsKey: "hf" },
  { engine: "huggingface", id: "Efficient-Large-Model/Sana_1600M_1024px_diffusers", label: "Sana", needsKey: "hf" },

  // Local frameworks (run them yourself; set the URL).
  { engine: "a1111", id: "current", label: "AUTOMATIC1111 / Forge (local) · uses loaded checkpoint", local: true },
  { engine: "comfyui", id: "sdxl", label: "ComfyUI (local) · default SDXL workflow", local: true },
];

export async function generateImage(engine: ImageEngine, model: string, prompt: string): Promise<string[]> {
  switch (engine) {
    case "pollinations": return pollinations(model, prompt);
    case "huggingface": return huggingface(model, prompt);
    case "a1111": return automatic1111(prompt);
    case "comfyui": return comfyui(prompt);
    default: throw new Error(`Unknown image engine: ${engine}`);
  }
}

async function pollinations(model: string, prompt: string): Promise<string[]> {
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${encodeURIComponent(model)}&width=1024&height=1024&nologo=true&seed=${seed}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pollinations ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/jpeg";
  return [`data:${mime};base64,${buf.toString("base64")}`];
}

async function huggingface(model: string, prompt: string): Promise<string[]> {
  const token = configStore.getSetting<string>("hfToken", "");
  if (!token) throw new Error("Add a free Hugging Face token in the Image settings (huggingface.co/settings/tokens — no credit card).");
  const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "image/png" },
    body: JSON.stringify({ inputs: prompt, options: { wait_for_model: true } }),
  });
  if (res.status === 503) throw new Error("Model is warming up on the free Hugging Face tier — try again in ~20–40s.");
  if (res.status === 403) throw new Error("This model is gated — accept its license on its Hugging Face page first, then retry.");
  if (!res.ok) throw new Error(`Hugging Face ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return [`data:image/png;base64,${buf.toString("base64")}`];
}

async function automatic1111(prompt: string): Promise<string[]> {
  const base = (configStore.getSetting<string>("a1111Url", "http://127.0.0.1:7860") || "http://127.0.0.1:7860").replace(/\/$/, "");
  const res = await fetch(`${base}/sdapi/v1/txt2img`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, steps: 25, width: 1024, height: 1024, cfg_scale: 7 }),
  }).catch(() => { throw new Error(`Can't reach AUTOMATIC1111 at ${base}. Start it with --api.`); });
  if (!res.ok) throw new Error(`AUTOMATIC1111 ${res.status}`);
  const json = await res.json() as any;
  return (json.images ?? []).map((b: string) => `data:image/png;base64,${b}`);
}

async function comfyui(prompt: string): Promise<string[]> {
  const base = (configStore.getSetting<string>("comfyUrl", "http://127.0.0.1:8188") || "http://127.0.0.1:8188").replace(/\/$/, "");
  const ckpt = configStore.getSetting<string>("comfyCkpt", "sd_xl_base_1.0.safetensors");
  // Minimal default SDXL text-to-image graph.
  const workflow = {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "low quality, blurry", clip: ["4", 1] } },
    "3": { class_type: "KSampler", inputs: { seed: Math.floor(Math.random() * 1e15), steps: 25, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "amarcode", images: ["8", 0] } },
  };
  const q = await fetch(`${base}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: workflow }) })
    .catch(() => { throw new Error(`Can't reach ComfyUI at ${base}.`); });
  if (!q.ok) throw new Error(`ComfyUI ${q.status}: ${(await q.text()).slice(0, 200)}`);
  const { prompt_id } = await q.json() as any;
  // Poll history for the result.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const h = await fetch(`${base}/history/${prompt_id}`).then((r) => r.json()).catch(() => ({})) as any;
    const outputs = h?.[prompt_id]?.outputs;
    if (outputs) {
      const imgs: string[] = [];
      for (const node of Object.values(outputs) as any[]) {
        for (const im of node.images ?? []) {
          const url = `${base}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder || "")}&type=${im.type || "output"}`;
          const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
          imgs.push(`data:image/png;base64,${buf.toString("base64")}`);
        }
      }
      if (imgs.length) return imgs;
    }
  }
  throw new Error("ComfyUI timed out generating the image.");
}
