import { spawnSync } from "node:child_process";
import { rcedit } from "rcedit";

const OUTFILE = "fortnite-festival-rpc.exe";
const APP_NAME = "Fortnite Festival RPC";
const PUBLISHER = "joritochip";
const ICON = "assets/app.ico";

function run(command: string, args: string[]): void {
    const res = spawnSync(command, args, { stdio: "inherit", shell: false });
    if (res.error) throw res.error;
    if (res.status !== 0) process.exit(res.status ?? 1);
}

run("bun", [
    "build",
    "--compile",
    "src/index.ts",
    "--minify",
    "--outfile", OUTFILE,
    `--windows-icon=${ICON}`,
    "--windows-hide-console" // doesnt seem to work
]);

await rcedit(OUTFILE, {
    "version-string": {
        ProductName: APP_NAME,
        FileDescription: APP_NAME,
        CompanyName: PUBLISHER
    }
});

console.log(`Built ${OUTFILE}`);
