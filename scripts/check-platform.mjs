import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertConsumerPin } from "@dustwave/test-core/consumer-pin";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const platformPin = JSON.parse(
  readFileSync(new URL("./platform-pin.json", import.meta.url), "utf8"),
);
export function checkPlatform() {
  assertConsumerPin({
    root,
    expectedCommit: platformPin.commit,
    packages: platformPin.packages,
    lockfiles: [
      {
        path: "package-lock.json",
        packages: Object.fromEntries(
          Object.entries(platformPin.packages).map(([name, version]) => [
            `shared/dust-wave-platform/packages/${name}`,
            version,
          ]),
        ),
      },
    ],
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  checkPlatform();
  console.log("Platform commit and exact package versions verified.");
}
