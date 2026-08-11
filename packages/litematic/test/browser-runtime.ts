import { parseLitematic } from "@tomato-clock/litematic";

const files = [
  "a94f3c5d-b4ad-42e1-ba26-f474b204b0ea.litematic",
  "bd29cade-7000-42b7-adc1-0631ce512c30.litematic",
];

try {
  const results = [];
  for (const file of files) {
    const response = await fetch(`/litematic/${file}`);
    const result = await parseLitematic(new Uint8Array(await response.arrayBuffer()));
    results.push({ file, dataVersion: result.preview.minecraftDataVersion, blocks: result.preview.nonAirBlockCount });
  }
  document.body.dataset.status = "passed";
  document.body.textContent = JSON.stringify(results);
} catch (error) {
  document.body.dataset.status = "failed";
  document.body.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
