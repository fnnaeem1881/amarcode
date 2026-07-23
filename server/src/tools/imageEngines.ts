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
  video?: boolean;     // produces video instead of a still image
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

  // 🎬 Video — free paths: HF token (small free monthly credits) or local ComfyUI.
  { engine: "huggingface", id: "Lightricks/LTX-Video", label: "🎬 LTX-Video (HF · free credits)", needsKey: "hf", video: true },
  { engine: "huggingface", id: "Wan-AI/Wan2.1-T2V-1.3B", label: "🎬 Wan 2.1 T2V (HF · free credits)", needsKey: "hf", video: true },
  { engine: "huggingface", id: "genmo/mochi-1-preview", label: "🎬 Mochi 1 (HF · free credits)", needsKey: "hf", video: true },
  { engine: "comfyui", id: "video-workflow", label: "🎬 ComfyUI video (local) · your workflow", local: true, video: true },
];

/**
 * Generate (or edit, when `image` is given) an image.
 * `image` is a base image to modify: a data URI (upload) or a public URL
 * (a previously generated Pollinations image). Editing support:
 *  - pollinations : kontext model — needs a free account token (enter.pollinations.ai)
 *  - huggingface  : instruct-pix2pix via the free Inference API token
 *  - a1111        : /sdapi/v1/img2img (local, no key)
 *  - comfyui      : img2img workflow (local, no key)
 */
export async function generateImage(engine: ImageEngine, model: string, prompt: string, image?: string): Promise<string[]> {
  const isVideo = IMAGE_MODELS.some((m) => m.engine === engine && m.id === model && m.video);
  if (isVideo) {
    if (engine === "huggingface") return hfVideo(model, prompt);
    if (engine === "comfyui") return comfyVideo(prompt);
    throw new Error(`No video support for engine: ${engine}`);
  }
  switch (engine) {
    case "pollinations": return pollinations(model, prompt, image);
    case "huggingface": return huggingface(model, prompt, image);
    case "a1111": return automatic1111(prompt, image);
    case "comfyui": return comfyui(prompt, image);
    default: throw new Error(`Unknown image engine: ${engine}`);
  }
}

/**
 * Text-to-video through Hugging Face Inference Providers (fal.ai queue).
 * A free HF token includes small monthly inference credits — enough for a few
 * short clips per month, with no credit card.
 */
async function hfVideo(model: string, prompt: string): Promise<string[]> {
  const token = configStore.getSetting<string>("hfToken", "");
  if (!token) throw new Error("Video needs a free Hugging Face token (huggingface.co/settings/tokens — no credit card). Add it via ⚙ next to the model picker.");
  const auth = { authorization: `Bearer ${token}` };

  // Resolve which inference provider serves this model.
  const info = await fetch(`https://huggingface.co/api/models/${model}?expand[]=inferenceProviderMapping`, { headers: auth })
    .then((r) => r.json()).catch(() => ({})) as any;
  const mappings = Array.isArray(info.inferenceProviderMapping) ? info.inferenceProviderMapping : [];
  const fal = mappings.find((m: any) => m.provider === "fal-ai" && m.status === "live");
  if (!fal) throw new Error(`${model} isn't currently served by fal.ai on Hugging Face — pick another 🎬 model.`);

  // Submit to the fal queue through the HF router, then poll to completion.
  const basePath = `https://router.huggingface.co/fal-ai/${fal.providerId}`;
  const submit = await fetch(`${basePath}?_subdomain=queue`, {
    method: "POST", headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (submit.status === 402) throw new Error("Out of free Hugging Face inference credits for this month — try local ComfyUI video, or wait for the monthly reset.");
  if (!submit.ok) throw new Error(`Hugging Face video ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const { request_id: reqId, status_url: statusUrl, response_url: responseUrl } = await submit.json() as any;
  if (!reqId) throw new Error("fal.ai queue didn't return a request id.");

  const statusEndpoint = statusUrl?.includes("router.huggingface.co") ? statusUrl : `${basePath}/requests/${reqId}/status?_subdomain=queue`;
  const resultEndpoint = responseUrl?.includes("router.huggingface.co") ? responseUrl : `${basePath}/requests/${reqId}?_subdomain=queue`;
  for (let i = 0; i < 120; i++) { // up to ~6 minutes
    await new Promise((r) => setTimeout(r, 3000));
    const st = await fetch(statusEndpoint, { headers: auth }).then((r) => r.json()).catch(() => ({})) as any;
    if (st.status === "COMPLETED") {
      const out = await fetch(resultEndpoint, { headers: auth }).then((r) => r.json()) as any;
      const url = out?.video?.url ?? out?.videos?.[0]?.url ?? out?.output?.url;
      if (!url) throw new Error("Video finished but no URL came back.");
      const vid = await fetch(url);
      const buf = Buffer.from(await vid.arrayBuffer());
      const mime = vid.headers.get("content-type") || "video/mp4";
      return [`data:${mime};base64,${buf.toString("base64")}`];
    }
    if (st.status === "FAILED" || st.error) throw new Error(`Video generation failed: ${st.error ?? "unknown error"}`);
  }
  throw new Error("Video generation timed out (~6 min). Short prompts and LTX-Video are fastest.");
}

/**
 * Local ComfyUI video using the user's own API-format workflow JSON (set via ⚙),
 * with "{PROMPT}" inside it replaced by the chat prompt. Collects any videos,
 * gifs or animated images the workflow saves.
 */
async function comfyVideo(prompt: string): Promise<string[]> {
  const base = (configStore.getSetting<string>("comfyUrl", "http://127.0.0.1:8188") || "http://127.0.0.1:8188").replace(/\/$/, "");
  const wfRaw = configStore.getSetting<string>("comfyVideoWorkflow", "");
  if (!wfRaw) throw new Error('ComfyUI video needs a workflow: in ComfyUI, build any text-to-video flow (LTX-Video, Wan, AnimateDiff…), use "Export (API format)", put {PROMPT} where the prompt text goes, and paste the JSON via ⚙.');
  let workflow: any;
  try { workflow = JSON.parse(wfRaw.replaceAll("{PROMPT}", prompt.replaceAll('"', '\\"'))); }
  catch { throw new Error("The ComfyUI video workflow isn't valid JSON — re-export it in API format."); }

  const q = await fetch(`${base}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: workflow }) })
    .catch(() => { throw new Error(`Can't reach ComfyUI at ${base}.`); });
  if (!q.ok) throw new Error(`ComfyUI ${q.status}: ${(await q.text()).slice(0, 200)}`);
  const { prompt_id } = await q.json() as any;
  for (let i = 0; i < 200; i++) { // videos are slow — up to ~10 minutes
    await new Promise((r) => setTimeout(r, 3000));
    const h = await fetch(`${base}/history/${prompt_id}`).then((r) => r.json()).catch(() => ({})) as any;
    const outputs = h?.[prompt_id]?.outputs;
    if (outputs) {
      const media: string[] = [];
      for (const node of Object.values(outputs) as any[]) {
        for (const f of [...(node.gifs ?? []), ...(node.videos ?? []), ...(node.images ?? [])]) {
          const url = `${base}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || "")}&type=${f.type || "output"}`;
          const r = await fetch(url);
          const buf = Buffer.from(await r.arrayBuffer());
          const ext = String(f.filename).split(".").pop()?.toLowerCase() ?? "png";
          const mime = ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/png";
          media.push(`data:${mime};base64,${buf.toString("base64")}`);
        }
      }
      if (media.length) return media;
    }
  }
  throw new Error("ComfyUI video timed out (~10 min).");
}

async function pollinations(model: string, prompt: string, image?: string): Promise<string[]> {
  const seed = Math.floor(Math.random() * 1_000_000);
  const token = configStore.getSetting<string>("pollinationsToken", "");
  // Editing uses the kontext (FLUX.1 Kontext) model — anonymous flux ignores
  // the image parameter, so editing requires the (free, no-card) token.
  const effModel = image ? "kontext" : model;
  if (image && !token) {
    throw new Error("Editing on Pollinations needs a free token: sign up at enter.pollinations.ai (no credit card), then add it via ⚙ next to the image model. Local AUTOMATIC1111/ComfyUI can edit without any key.");
  }
  let url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${encodeURIComponent(effModel)}&width=1024&height=1024&nologo=true&seed=${seed}`;
  if (image) url += `&image=${encodeURIComponent(image)}`;
  if (token) url += `&token=${encodeURIComponent(token)}`;
  const res = await fetch(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  if (!res.ok) {
    if (image && (res.status === 413 || res.status === 414)) throw new Error("The base image is too large for Pollinations editing — try a smaller image, or use local AUTOMATIC1111/ComfyUI.");
    const body = (await res.text().catch(() => "")).slice(0, 300);
    const msg = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1];
    throw new Error(`Pollinations ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/jpeg";
  return [`data:${mime};base64,${buf.toString("base64")}`];
}

async function huggingface(model: string, prompt: string, image?: string): Promise<string[]> {
  const token = configStore.getSetting<string>("hfToken", "");
  if (!token) throw new Error("Add a free Hugging Face token in the Image settings (huggingface.co/settings/tokens — no credit card).");
  // Editing goes through an instruction-following image-to-image model.
  const effModel = image ? "timbrooks/instruct-pix2pix" : model;
  const body = image
    ? JSON.stringify({ inputs: image.replace(/^data:[^,]+,/, ""), parameters: { prompt }, options: { wait_for_model: true } })
    : JSON.stringify({ inputs: prompt, options: { wait_for_model: true } });
  const res = await fetch(`https://api-inference.huggingface.co/models/${effModel}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "image/png" },
    body,
  });
  if (res.status === 503) throw new Error("Model is warming up on the free Hugging Face tier — try again in ~20–40s.");
  if (res.status === 403) throw new Error("This model is gated — accept its license on its Hugging Face page first, then retry.");
  if (!res.ok) throw new Error(`Hugging Face ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return [`data:image/png;base64,${buf.toString("base64")}`];
}

async function automatic1111(prompt: string, image?: string): Promise<string[]> {
  const base = (configStore.getSetting<string>("a1111Url", "http://127.0.0.1:7860") || "http://127.0.0.1:7860").replace(/\/$/, "");
  const endpoint = image ? "img2img" : "txt2img";
  const payload: any = { prompt, steps: 25, width: 1024, height: 1024, cfg_scale: 7 };
  if (image) {
    payload.init_images = [await toBase64(image)];
    payload.denoising_strength = 0.55; // keep the original composition, apply the instruction
  }
  const res = await fetch(`${base}/sdapi/v1/${endpoint}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => { throw new Error(`Can't reach AUTOMATIC1111 at ${base}. Start it with --api.`); });
  if (!res.ok) throw new Error(`AUTOMATIC1111 ${res.status}`);
  const json = await res.json() as any;
  return (json.images ?? []).map((b: string) => `data:image/png;base64,${b}`);
}

/** Normalise a data URI or remote URL to raw base64 (fetching URLs as needed). */
async function toBase64(image: string): Promise<string> {
  if (image.startsWith("data:")) return image.replace(/^data:[^,]+,/, "");
  const res = await fetch(image);
  if (!res.ok) throw new Error(`Couldn't fetch the base image (${res.status}).`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

async function comfyui(prompt: string, image?: string): Promise<string[]> {
  const base = (configStore.getSetting<string>("comfyUrl", "http://127.0.0.1:8188") || "http://127.0.0.1:8188").replace(/\/$/, "");
  const ckpt = configStore.getSetting<string>("comfyCkpt", "sd_xl_base_1.0.safetensors");
  // Minimal SDXL graph — text-to-image, or image-to-image when a base image is given.
  const workflow: Record<string, any> = {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "low quality, blurry", clip: ["4", 1] } },
    "3": { class_type: "KSampler", inputs: { seed: Math.floor(Math.random() * 1e15), steps: 25, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "amarcode", images: ["8", 0] } },
  };
  if (image) {
    // Upload the base image, then swap the empty latent for its encoded version.
    const b64 = await toBase64(image);
    const form = new FormData();
    form.append("image", new Blob([Buffer.from(b64, "base64")], { type: "image/png" }), `amarcode-edit-${Date.now()}.png`);
    const up = await fetch(`${base}/upload/image`, { method: "POST", body: form })
      .catch(() => { throw new Error(`Can't reach ComfyUI at ${base}.`); });
    if (!up.ok) throw new Error(`ComfyUI upload ${up.status}`);
    const { name, subfolder } = await up.json() as any;
    workflow["10"] = { class_type: "LoadImage", inputs: { image: subfolder ? `${subfolder}/${name}` : name } };
    workflow["11"] = { class_type: "VAEEncode", inputs: { pixels: ["10", 0], vae: ["4", 2] } };
    workflow["3"].inputs.latent_image = ["11", 0];
    workflow["3"].inputs.denoise = 0.55; // keep composition, apply the instruction
    delete workflow["5"];
  }
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
