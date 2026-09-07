import { readFile } from "node:fs/promises";
import { parseBundle } from "../src/selection.ts";
import { parseStrict } from "../src/util.ts";
parseBundle({
  selection: parseStrict(await readFile("config/scan.json", "utf8")),
  repos: parseStrict(await readFile("config/repos.json", "utf8")),
  dispositions: parseStrict(await readFile("config/dispositions.json", "utf8")),
});
console.log("Selection and context configuration valid.");
