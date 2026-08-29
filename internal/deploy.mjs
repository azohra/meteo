import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const dryRun = process.argv.slice(2).includes("--dry-run");

process.chdir(root);

function refuse(message) {
  console.error(`deploy: refusing — ${message}`);
  process.exit(1);
}

function capture(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    refuse(`${command} ${args[0] ?? ""} failed`);
  }
}

function run(command, args, options = {}) {
  try {
    execFileSync(command, args, { stdio: "inherit", ...options });
  } catch {
    refuse(`${command} ${args[0] ?? ""} failed`);
  }
}

if (!process.env.CLOUDFLARE_API_TOKEN) refuse("CLOUDFLARE_API_TOKEN is unset");
if (process.argv.slice(2).some((arg) => arg !== "--dry-run")) {
  refuse("the only supported option is --dry-run");
}

const repository = JSON.parse(
  capture("gh", ["repo", "view", "--json", "nameWithOwner,visibility"]),
);
if (repository.nameWithOwner !== "azohra/meteo" || repository.visibility !== "PUBLIC") {
  refuse(
    `expected azohra/meteo (PUBLIC), found ${repository.nameWithOwner} (${repository.visibility})`,
  );
}

if (capture("git", ["status", "--porcelain=v1", "--untracked-files=all"])) {
  refuse("the worktree is not clean");
}

run("git", ["fetch", "--quiet", "origin", "main"]);
const head = capture("git", ["rev-parse", "HEAD"]);
const main = capture("git", ["rev-parse", "origin/main"]);
if (head !== main) refuse(`HEAD ${head.slice(0, 7)} is not origin/main ${main.slice(0, 7)}`);

const workspace = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const config = JSON.parse(readFileSync(join(site, "wrangler.jsonc"), "utf8"));
const hostname = new URL(workspace.homepage).hostname;
const expectedWorker = hostname.replaceAll(".", "-");
const routes = config.routes ?? [];
if (
  config.name !== expectedWorker ||
  routes.length !== 1 ||
  routes[0].pattern !== hostname ||
  routes[0].custom_domain !== true ||
  config.workers_dev !== false ||
  config.assets?.directory !== "dist"
) {
  refuse(`site/wrangler.jsonc does not describe ${expectedWorker} at ${hostname}`);
}

const account = capture("pnpm", ["--dir", "site", "exec", "wrangler", "whoami"]);
if (!account.includes(config.account_id)) {
  refuse(`CLOUDFLARE_API_TOKEN cannot access account ${config.account_id}`);
}

console.log(`deploy: targeting ${config.name} at ${hostname} from ${head.slice(0, 7)}`);
run("mise", ["run", "check"]);

if (dryRun) {
  run("pnpm", ["--dir", "site", "exec", "wrangler", "deploy", "--dry-run"]);
  console.log("deploy: dry run complete");
  process.exit(0);
}

const subject = capture("git", ["log", "-1", "--pretty=%s"]);
run("pnpm", [
  "--dir",
  "site",
  "exec",
  "wrangler",
  "deploy",
  "--tag",
  head.slice(0, 12),
  "--message",
  subject,
]);

const deployments = JSON.parse(
  capture("pnpm", ["--dir", "site", "exec", "wrangler", "deployments", "list", "--json"]),
).sort((left, right) => Date.parse(right.created_on) - Date.parse(left.created_on));
const deployment = deployments[0];
const deployedVersion = deployment?.versions?.find((version) => version.percentage === 100);
if (!deployedVersion) refuse(`${config.name} does not have a 100% deployment`);

const version = JSON.parse(
  capture("pnpm", [
    "--dir",
    "site",
    "exec",
    "wrangler",
    "versions",
    "view",
    deployedVersion.version_id,
    "--json",
  ]),
);
if (
  version.annotations?.["workers/tag"] !== head.slice(0, 12) ||
  version.annotations?.["workers/message"] !== subject
) {
  refuse(`${deployedVersion.version_id} is not annotated for ${head.slice(0, 12)}`);
}

const liveUrl = new URL(workspace.homepage);
const built = readFileSync(join(site, "dist", "index.html"), "utf8");
const title = /<title>([^<]+)<\/title>/.exec(built)?.[1];
if (!title) refuse("site/dist/index.html has no title");

let verified = false;
for (let attempt = 0; attempt < 3; attempt += 1) {
  try {
    const response = await fetch(liveUrl, { redirect: "follow" });
    if (response.ok && (await response.text()).includes(`<title>${title}</title>`)) {
      verified = true;
      break;
    }
  } catch {
    // The bounded retry below handles propagation and transient network errors.
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
}
console.log(`deploy: Cloudflare version ${deployedVersion.version_id} is at 100%`);
if (verified) console.log(`deploy: ${liveUrl.href} serves the built site`);
else console.warn(`deploy: ${liveUrl.href} could not be probed from this network`);
